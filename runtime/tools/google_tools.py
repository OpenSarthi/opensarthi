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

    tokens = load_tokens()
    access_token = tokens.get("access_token")
    refresh_token = tokens.get("refresh_token")
    expires_at = tokens.get("expires_at", 0)

    # Check if token is still valid (with 5 min buffer)
    if access_token and expires_at > (datetime.now().timestamp() + 300):
        return access_token

    # Try to refresh
    if refresh_token and settings.google_client_id and settings.google_client_secret:
        try:
            response = httpx.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
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


def get_auth_url() -> str:
    """Generate OAuth2 authorization URL."""
    from config import settings
    import urllib.parse

    scopes = " ".join(settings.google_scopes)
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": scopes,
        "access_type": "offline",
        "prompt": "consent",
    }
    return f"https://accounts.google.com/o/oauth2/v2/auth?{urllib.parse.urlencode(params)}"


async def exchange_code_for_tokens(code: str) -> bool:
    """Exchange authorization code for access/refresh tokens."""
    from config import settings
    import httpx

    try:
        response = httpx.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "code": code,
                "redirect_uri": settings.google_redirect_uri,
                "grant_type": "authorization_code",
            },
            timeout=10,
        )
        response.raise_for_status()
        tokens = response.json()
        tokens["expires_at"] = datetime.now().timestamp() + tokens.get("expires_in", 3600)
        save_tokens(tokens)
        return True
    except Exception as e:
        logger.error("Failed to exchange code for tokens", error=str(e))
        return False


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
        time_min = args.get("time_min", datetime.now().isoformat() + "Z")
        time_max = args.get("time_max", (datetime.now() + timedelta(days=7)).isoformat() + "Z")

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
                obs_parts.append(f"- {ev['summary']} ({ev['start']})")
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
                obs_parts.append(f"From: {m['from']}, Subject: {m['subject']}")
            return ToolResult(
                success=True,
                observation="\n".join(obs_parts) if obs_parts else "No messages",
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