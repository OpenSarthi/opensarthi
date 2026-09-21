"""
Google OAuth Tools for OpenSarthi — Mark-L Parity Feature

Read-only access to Google Calendar and Gmail via OAuth2.
Scopes: calendar.readonly, gmail.readonly
"""
import asyncio
import json
import structlog
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta
from pathlib import Path

from tools.base import BaseTool, RiskLevel, ToolResult, ToolDomain

logger = structlog.get_logger()

# Global OAuth token storage (in production, use secure storage)
_oauth_tokens: Dict[str, Dict] = {}

# Token file path
TOKEN_FILE = Path.home() / ".config" / "opensarthi" / "google_tokens.json"


def load_tokens() -> Dict[str, Any]:
    """Load OAuth tokens from file."""
    global _oauth_tokens
    if TOKEN_FILE.exists():
        try:
            with open(TOKEN_FILE, "r") as f:
                _oauth_tokens = json.load(f)
        except Exception as e:
            logger.warning("Failed to load Google tokens", error=str(e))
    return _oauth_tokens


def save_tokens(tokens: Dict[str, Any]):
    """Save OAuth tokens to file."""
    global _oauth_tokens
    _oauth_tokens = tokens
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(TOKEN_FILE, "w") as f:
            json.dump(tokens, f)
    except Exception as e:
        logger.warning("Failed to save Google tokens", error=str(e))


def get_access_token() -> Optional[str]:
    """Get valid access token, refreshing if needed."""
    from config import settings
    import httpx
    import os

    tokens = load_tokens()
    access_token = tokens.get("access_token")
    refresh_token = tokens.get("refresh_token")
    expires_at = tokens.get("expires_at", 0)

    # Check if token is still valid (with 5 min buffer)
    if access_token and expires_at > (datetime.now().timestamp() + 300):
        return access_token

    client_id = getattr(settings, "google_client_id", None) or os.environ.get("GOOGLE_CLIENT_ID")
    client_secret = getattr(settings, "google_client_secret", None) or os.environ.get("GOOGLE_CLIENT_SECRET")

    # Try to refresh
    if refresh_token and client_id and client_secret:
        try:
            response = httpx.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "refresh_token": refresh_token,
                    "grant_type": "refresh_token",
                },
                timeout=10,
            )
            response.raise_for_status()
            new_tokens = response.json()
            tokens["access_token"] = new_tokens["access_token"]
            tokens["expires_at"] = datetime.now().timestamp() + new_tokens.get("expires_in", 3600)
            save_tokens(tokens)
            return tokens["access_token"]
        except Exception as e:
            logger.error("Failed to refresh Google token", error=str(e))

    return None


def get_auth_url(client_id: Optional[str] = None, redirect_uri: Optional[str] = None) -> str:
    """Generate OAuth2 authorization URL."""
    from config import settings
    import urllib.parse
    import os

    effective_client_id = client_id or getattr(settings, "google_client_id", None) or os.environ.get("GOOGLE_CLIENT_ID")
    effective_redirect_uri = redirect_uri or getattr(settings, "google_redirect_uri", None) or "http://localhost:8765/oauth2callback"
    scopes = " ".join(getattr(settings, "google_scopes", ["https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/gmail.readonly"]))
    params = {
        "client_id": effective_client_id,
        "redirect_uri": effective_redirect_uri,
        "response_type": "code",
        "scope": scopes,
        "access_type": "offline",
        "prompt": "consent",
    }
    return f"https://accounts.google.com/o/oauth2/v2/auth?{urllib.parse.urlencode(params)}"


async def exchange_code_for_tokens(
    code: str,
    client_id: Optional[str] = None,
    client_secret: Optional[str] = None,
    redirect_uri: Optional[str] = None,
) -> bool:
    """Exchange authorization code for access/refresh tokens."""
    from config import settings
    import httpx
    import os

    effective_client_id = client_id or getattr(settings, "google_client_id", None) or os.environ.get("GOOGLE_CLIENT_ID")
    effective_client_secret = client_secret or getattr(settings, "google_client_secret", None) or os.environ.get("GOOGLE_CLIENT_SECRET")
    effective_redirect_uri = redirect_uri or getattr(settings, "google_redirect_uri", None) or "http://localhost:8765/oauth2callback"

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": effective_client_id,
                    "client_secret": effective_client_secret,
                    "code": code,
                    "redirect_uri": effective_redirect_uri,
                    "grant_type": "authorization_code",
                },
            )
            response.raise_for_status()
            tokens = response.json()
            tokens["expires_at"] = datetime.now().timestamp() + tokens.get("expires_in", 3600)
            save_tokens(tokens)
            return True
    except Exception as e:
        logger.error("Failed to exchange code for tokens", error=str(e))
        return False


# ─── Port 8765 OAuth Callback Server ──────────────────────────────────────────
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.parse

class _OAuthCallbackHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Quiet logs

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path in ("/oauth2callback", "/oauth/google/callback"):
            qs = urllib.parse.parse_qs(parsed.query)
            code = qs.get("code", [None])[0]
            error = qs.get("error", [None])[0]

            if error:
                self.send_response(400)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>OpenSarthi — OAuth Cancelled</title>
<style>body {{ background: #07090f; color: #ff3b30; font-family: monospace; padding: 40px; text-align: center; }}
.card {{ max-width: 480px; margin: 40px auto; background: rgba(255,59,48,0.08); border: 1px solid #ff3b30; padding: 30px; border-radius: 8px; }}</style></head>
<body><div class="card"><h2>// AUTHORIZATION FAILED</h2><p>{error}</p><p>You can close this tab and try again.</p></div></body></html>""".encode("utf-8"))
                return

            if code:
                from config import settings, save_settings_to_env
                import asyncio
                import httpx
                import os

                effective_client_id = getattr(settings, "google_client_id", None) or os.environ.get("GOOGLE_CLIENT_ID")
                effective_client_secret = getattr(settings, "google_client_secret", None) or os.environ.get("GOOGLE_CLIENT_SECRET")
                effective_redirect_uri = getattr(settings, "google_redirect_uri", None) or "http://localhost:8765/oauth2callback"

                success = False
                try:
                    resp = httpx.post(
                        "https://oauth2.googleapis.com/token",
                        data={
                            "client_id": effective_client_id,
                            "client_secret": effective_client_secret,
                            "code": code,
                            "redirect_uri": effective_redirect_uri,
                            "grant_type": "authorization_code",
                        },
                        timeout=15.0,
                    )
                    resp.raise_for_status()
                    toks = resp.json()
                    toks["expires_at"] = datetime.now().timestamp() + toks.get("expires_in", 3600)
                    save_tokens(toks)
                    success = True
                except Exception as ex:
                    logger.error("OAuth callback sync exchange failed", error=str(ex))

                if success:
                    settings.google_oauth_enabled = True
                    save_settings_to_env(google_oauth_enabled=True)
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.end_headers()
                    self.wfile.write("""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>OpenSarthi — Google Authentication Successful</title>
    <style>
        body { background: #07090f; color: #22c55e; font-family: monospace; padding: 40px; text-align: center; }
        .card { max-width: 520px; margin: 50px auto; background: rgba(34,197,94,0.06); border: 1px solid #22c55e; padding: 35px; border-radius: 8px; box-shadow: 0 0 30px rgba(34,197,94,0.2); }
        h1 { font-size: 20px; letter-spacing: 0.12em; color: #22c55e; }
        p { color: #cbd5e1; font-size: 14px; line-height: 1.6; }
        .success-icon { font-size: 40px; margin-bottom: 12px; }
        .hint { color: #64748b; font-size: 12px; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="card">
        <div class="success-icon">✨</div>
        <h1>// GOOGLE AUTHENTICATION SUCCESSFUL</h1>
        <p>OpenSarthi is now connected to <strong>Google Calendar</strong> and <strong>Gmail</strong> (read-only).</p>
        <p class="hint">You can safely close this browser tab and return to OpenSarthi.</p>
    </div>
</body>
</html>""".encode("utf-8"))
                    return
                else:
                    self.send_response(500)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.end_headers()
                    self.wfile.write("""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>OpenSarthi — Token Exchange Failed</title>
<style>body { background: #07090f; color: #ff3b30; font-family: monospace; padding: 40px; text-align: center; }
.card { max-width: 500px; margin: 40px auto; background: rgba(255,59,48,0.08); border: 1px solid #ff3b30; padding: 30px; border-radius: 8px; }</style></head>
<body><div class="card"><h2>// TOKEN EXCHANGE ERROR</h2><p>Failed to exchange code for access token. Verify your Client Secret in OpenSarthi Integrations Settings.</p></div></body></html>""".encode("utf-8"))
                    return

        self.send_response(404)
        self.end_headers()


_oauth_server: Optional[HTTPServer] = None
_oauth_thread: Optional[threading.Thread] = None

def start_oauth_callback_server(port: int = 8765):
    """Start loopback HTTP listener on port 8765 for OAuth redirect callbacks."""
    global _oauth_server, _oauth_thread
    if _oauth_server is not None:
        return
    try:
        _oauth_server = HTTPServer(("127.0.0.1", port), _OAuthCallbackHandler)
        _oauth_thread = threading.Thread(target=_oauth_server.serve_forever, daemon=True)
        _oauth_thread.start()
        logger.info("OAuth redirect callback listener started", port=port)
    except Exception as e:
        logger.warning("Could not bind OAuth callback server to port (might already be bound)", port=port, error=str(e))

def stop_oauth_callback_server():
    """Stop the loopback OAuth callback listener."""
    global _oauth_server
    if _oauth_server:
        try:
            _oauth_server.shutdown()
            _oauth_server.server_close()
        except Exception:
            pass
        _oauth_server = None


def _ensure_rfc3339(val: Any, default_dt: datetime) -> str:
    if not val:
        return default_dt.isoformat() + "Z"
    val_str = str(val).strip()
    if val_str.endswith("Z"):
        return val_str
    import re
    if re.search(r'[+-]\d{2}:?\d{2}$', val_str):
        return val_str
    try:
        dt = datetime.fromisoformat(val_str)
        if dt.tzinfo is None:
            return dt.isoformat() + "Z"
        return dt.isoformat().replace("+00:00", "Z")
    except Exception:
        return f"{val_str}Z"


class CalendarReadTool(BaseTool):
    """Read calendar events (read-only)."""

    name = "calendar_read"
    description = "Read upcoming Google Calendar events. Read-only access."
    schema = {
        "type": "object",
        "properties": {
            "max_results": {"type": "integer", "default": 10, "description": "Maximum number of events to return"},
            "time_min": {"type": "string", "description": "ISO format start time (default: now)"},
            "time_max": {"type": "string", "description": "ISO format end time (default: 7 days from now)"},
        },
        "required": [],
    }
    risk_level = RiskLevel.SAFE
    domain = ToolDomain.CALENDAR

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        import httpx

        access_token = get_access_token()
        if not access_token:
            return ToolResult(
                success=False,
                result="Google OAuth not authenticated. Please authenticate first.",
                error="no_google_auth",
            )

        max_results = args.get("max_results", 10)
        now = datetime.utcnow()
        time_min = _ensure_rfc3339(args.get("time_min"), now)
        time_max = _ensure_rfc3339(args.get("time_max"), now + timedelta(days=7))

        try:
            response = httpx.get(
                "https://www.googleapis.com/calendar/v3/calendars/primary/events",
                headers={"Authorization": f"Bearer {access_token}"},
                params={
                    "maxResults": max_results,
                    "timeMin": time_min,
                    "timeMax": time_max,
                    "singleEvents": True,
                    "orderBy": "startTime",
                },
                timeout=10,
            )
            response.raise_for_status()
            data = response.json()
            events = data.get("items", [])

            # Format events for briefing
            formatted_events = []
            for event in events:
                start = event.get("start", {})
                start_time = start.get("dateTime", start.get("date", ""))
                formatted_events.append({
                    "id": event.get("id"),
                    "summary": event.get("summary", "No title"),
                    "start": start_time,
                    "end": event.get("end", {}).get("dateTime", event.get("end", {}).get("date", "")),
                    "location": event.get("location", ""),
                    "description": event.get("description", ""),
                })
            obs_parts = []
            for ev in formatted_events:
                loc_str = f" [Location: {ev['location']}]" if ev.get("location") else ""
                desc_str = f" - {ev['description']}" if ev.get("description") else ""
                obs_parts.append(f"- {ev['summary']} (Start: {ev['start']}, End: {ev['end']}){loc_str}{desc_str}")
            return ToolResult(
                success=True,
                observation="\n".join(obs_parts) if obs_parts else "No events",
                raw_output={"events": formatted_events},
            )

        except Exception as e:
            logger.error("Calendar read failed", error=str(e))
            return ToolResult(success=False, error=str(e))


class GmailReadTool(BaseTool):
    """Read Gmail messages (read-only)."""

    name = "gmail_read"
    description = "Read Gmail messages (unread, recent, or search). Read-only access."
    schema = {
        "type": "object",
        "properties": {
            "max_results": {"type": "integer", "default": 10},
            "query": {"type": "string", "default": "label:UNREAD", "description": "Gmail search query"},
            "include_snippets": {"type": "boolean", "default": True},
        },
        "required": [],
    }
    risk_level = RiskLevel.SAFE
    domain = ToolDomain.MAIL

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        import httpx

        access_token = get_access_token()
        if not access_token:
            return ToolResult(
                success=False,
                observation="Google OAuth not authenticated. Please authenticate first.",
                error="no_google_auth",
            )

        max_results = args.get("max_results", 10)
        query = args.get("query", "label:UNREAD")
        include_snippets = args.get("include_snippets", True)

        try:
            # Get list of messages matching query
            response = httpx.get(
                "https://gmail.googleapis.com/gmail/v1/users/me/messages",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"maxResults": max_results, "q": query},
                timeout=10,
            )
            response.raise_for_status()
            messages_data = response.json()
            messages = messages_data.get("messages", [])

            formatted_messages = []
            for msg in messages:
                msg_id = msg.get("id")
                # Fetch detailed message data
                msg_detail_resp = httpx.get(
                    f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}",
                    headers={"Authorization": f"Bearer {access_token}"},
                    timeout=10,
                )
                msg_detail_resp.raise_for_status()
                msg_data = msg_detail_resp.json()

                # Parse headers
                payload = msg_data.get("payload", {})
                headers_list = payload.get("headers", [])
                headers = {h.get("name"): h.get("value") for h in headers_list}

                formatted = {
                    "id": msg_id,
                    "threadId": msg_data.get("threadId"),
                    "subject": headers.get("Subject", "No Subject"),
                    "from": headers.get("From", "Unknown"),
                    "date": headers.get("Date", ""),
                    "snippet": msg_data.get("snippet", "") if include_snippets else "",
                }
                formatted_messages.append(formatted)

            obs_parts = []
            for m in formatted_messages:
                date_str = f" ({m['date']})" if m.get("date") else ""
                snippet_str = f"\n  Preview: {m['snippet']}" if m.get("snippet") else ""
                obs_parts.append(f"• From: {m['from']}{date_str}\n  Subject: {m['subject']}{snippet_str}")
            return ToolResult(
                success=True,
                observation="\n".join(obs_parts) if obs_parts else "No messages found matching query",
                raw_output={"messages": formatted_messages},
            )

        except Exception as e:
            logger.error("Gmail read failed", error=str(e))
            return ToolResult(success=False, error=str(e))


class CalendarSearchTool(BaseTool):
    """Search calendar events."""

    name = "calendar_search"
    description = "Search Google Calendar events by query."
    schema = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search query"},
            "max_results": {"type": "integer", "default": 10},
        },
        "required": ["query"],
    }
    risk_level = RiskLevel.SAFE
    domain = ToolDomain.CALENDAR

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        # Reuse calendar_read with broader time range
        tool = CalendarReadTool()
        return await tool.execute({
            "max_results": args.get("max_results", 10),
            "time_min": (datetime.now() - timedelta(days=365)).isoformat() + "Z",
        })


class GmailSearchTool(BaseTool):
    """Search Gmail messages."""

    name = "gmail_search"
    description = "Search Gmail messages by query."
    schema = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Gmail search query"},
            "max_results": {"type": "integer", "default": 10},
        },
        "required": ["query"],
    }
    risk_level = RiskLevel.SAFE
    domain = ToolDomain.MAIL

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        tool = GmailReadTool()
        return await tool.execute({
            "max_results": args.get("max_results", 10),
            "query": args["query"],
        })


# Tool instances for registry
calendar_read_tool = CalendarReadTool()
gmail_read_tool = GmailReadTool()
calendar_search_tool = CalendarSearchTool()
gmail_search_tool = GmailSearchTool()