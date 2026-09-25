from fastapi import APIRouter, HTTPException, Query, Request
from typing import Optional
import httpx

router = APIRouter()

@router.get("/health")
async def health_check():
    return {"status": "ok", "service": "opensarthi-runtime"}


@router.get("/models")
async def list_models(
    provider: str = Query(..., description="Provider: ollama | openai | openrouter | google | anthropic | groq | custom_openai"),
    api_key: Optional[str] = Query(None, description="API key (required for cloud providers)"),
    base_url: Optional[str] = Query(None, description="Base URL (for custom_openai / ollama)"),
):
    """
    Proxy model discovery for supported providers.
    Allows the frontend to fetch model lists without hitting external URLs
    directly (avoids CSP issues in the AppImage).
    """
    provider = provider.lower()

    if provider == "ollama":
        ollama_url = (base_url or "http://127.0.0.1:11434").rstrip("/")
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(f"{ollama_url}/api/tags")
            resp.raise_for_status()
            data = resp.json()
            models = [
                {"value": m["name"], "label": m["name"]}
                for m in (data.get("models") or [])
            ]
            return {"provider": "ollama", "models": models, "source": "live"}
        except Exception:
            return {"provider": "ollama", "models": [], "source": "offline"}

    elif provider == "openai":
        if not api_key:
            raise HTTPException(status_code=400, detail="api_key required for OpenAI")
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(
                    "https://api.openai.com/v1/models",
                    headers={"Authorization": f"Bearer {api_key}"},
                )
            resp.raise_for_status()
            data = resp.json()
            # Filter to chat-relevant models only
            chat_ids = sorted([
                m["id"] for m in (data.get("data") or [])
                if any(m["id"].startswith(p) for p in ("gpt-", "o1", "o3", "o4", "chatgpt-"))
            ])
            models = [{"value": mid, "label": mid} for mid in chat_ids]
            return {"provider": "openai", "models": models, "source": "live"}
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"OpenAI fetch failed: {e}")

    elif provider == "openrouter":
        if not api_key:
            raise HTTPException(status_code=400, detail="api_key required for OpenRouter")
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                resp = await client.get(
                    "https://openrouter.ai/api/v1/models",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "HTTP-Referer": "https://opensarthi.app",
                    },
                )
            resp.raise_for_status()
            data = resp.json()
            models = sorted(
                [
                    {"value": m["id"], "label": m.get("name") or m["id"]}
                    for m in (data.get("data") or [])
                    if m.get("id")
                ],
                key=lambda m: m["value"],
            )
            return {"provider": "openrouter", "models": models, "source": "live"}
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"OpenRouter fetch failed: {e}")

    elif provider == "google":
        if not api_key:
            raise HTTPException(status_code=400, detail="api_key required for Google")
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(
                    "https://generativelanguage.googleapis.com/v1beta/models",
                    params={"key": api_key},
                )
            resp.raise_for_status()
            data = resp.json()
            models = [
                {"value": m["name"].replace("models/", ""), "label": m.get("displayName", m["name"].replace("models/", ""))}
                for m in (data.get("models") or [])
                if "generateContent" in m.get("supportedGenerationMethods", [])
            ]
            models.sort(key=lambda m: m["value"])
            return {"provider": "google", "models": models, "source": "live"}
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Google fetch failed: {e}")

    elif provider == "anthropic":
        if not api_key:
            raise HTTPException(status_code=400, detail="api_key required for Anthropic")
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(
                    "https://api.anthropic.com/v1/models",
                    headers={
                        "x-api-key": api_key,
                        "anthropic-version": "2023-06-01",
                    },
                )
            resp.raise_for_status()
            data = resp.json()
            models = [
                {"value": m["id"], "label": m.get("display_name", m["id"])}
                for m in (data.get("data") or [])
            ]
            return {"provider": "anthropic", "models": models, "source": "live"}
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Anthropic fetch failed: {e}")

    elif provider == "groq":
        if not api_key:
            raise HTTPException(status_code=400, detail="api_key required for Groq")
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(
                    "https://api.groq.com/openai/v1/models",
                    headers={"Authorization": f"Bearer {api_key}"},
                )
            resp.raise_for_status()
            data = resp.json()
            models = [
                {"value": m["id"], "label": m.get("id", m["id"])}
                for m in sorted(data.get("data") or [], key=lambda x: x.get("id", ""))
                if not m.get("id", "").startswith("whisper") and not m.get("id", "").startswith("distil")
            ]
            return {"provider": "groq", "models": models, "source": "live"}
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Groq fetch failed: {e}")

    elif provider == "custom_openai":
        if not base_url:
            raise HTTPException(status_code=400, detail="base_url required for custom_openai")
        effective_url = base_url.rstrip("/")
        headers = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.get(f"{effective_url}/models", headers=headers)
            resp.raise_for_status()
            data = resp.json()
            if isinstance(data, dict):
                raw = data.get("data") or data.get("models") or []
            elif isinstance(data, list):
                raw = data
            else:
                raw = []
            models = [
                {"value": m.get("id") or m.get("name") or str(m), "label": m.get("name") or m.get("id") or str(m)}
                for m in raw if (isinstance(m, dict) and (m.get("id") or m.get("name"))) or isinstance(m, str)
            ]
            return {"provider": "custom_openai", "models": models, "source": "live"}
        except Exception as e:
            return {"provider": "custom_openai", "models": [], "source": "offline", "error": str(e)}

    else:
        raise HTTPException(status_code=400, detail=f"Unsupported provider for model discovery: {provider}")


@router.get("/validate_key")
async def validate_api_key(
    provider: str = Query(..., description="Provider name"),
    api_key: Optional[str] = Query(None, description="API key to validate"),
    base_url: Optional[str] = Query(None, description="Base URL (for custom_openai)"),
):
    """
    Validate an API key by making a minimal request to the provider.
    Returns { valid: bool, message: str, models: [...] }
    """
    provider = provider.lower()

    if provider == "google":
        if not api_key:
            return {"valid": False, "message": "API key is required", "models": []}
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.get(
                    "https://generativelanguage.googleapis.com/v1beta/models",
                    params={"key": api_key},
                )
            if resp.status_code == 200:
                data = resp.json()
                models = [
                    {"value": m["name"].replace("models/", ""), "label": m.get("displayName", m["name"].replace("models/", ""))}
                    for m in (data.get("models") or [])
                    if "generateContent" in m.get("supportedGenerationMethods", [])
                ]
                models.sort(key=lambda m: m["value"])
                return {"valid": True, "message": f"✅ Google API key valid! {len(models)} models available.", "models": models}
            elif resp.status_code == 400:
                return {"valid": False, "message": "❌ Invalid API key", "models": []}
            else:
                return {"valid": False, "message": f"❌ HTTP {resp.status_code}", "models": []}
        except Exception as e:
            return {"valid": False, "message": f"❌ Connection failed: {str(e)[:80]}", "models": []}

    elif provider == "openai":
        if not api_key:
            return {"valid": False, "message": "API key is required", "models": []}
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.get(
                    "https://api.openai.com/v1/models",
                    headers={"Authorization": f"Bearer {api_key}"},
                )
            if resp.status_code == 200:
                data = resp.json()
                chat_ids = sorted([
                    m["id"] for m in (data.get("data") or [])
                    if any(m["id"].startswith(p) for p in ("gpt-", "o1", "o3", "o4", "chatgpt-"))
                ])
                models = [{"value": mid, "label": mid} for mid in chat_ids]
                return {"valid": True, "message": f"✅ OpenAI API key valid! {len(models)} models available.", "models": models}
            elif resp.status_code == 401:
                return {"valid": False, "message": "❌ Invalid API key", "models": []}
            else:
                return {"valid": False, "message": f"❌ HTTP {resp.status_code}", "models": []}
        except Exception as e:
            return {"valid": False, "message": f"❌ Connection failed: {str(e)[:80]}", "models": []}

    elif provider == "anthropic":
        if not api_key:
            return {"valid": False, "message": "API key is required", "models": []}
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.get(
                    "https://api.anthropic.com/v1/models",
                    headers={
                        "x-api-key": api_key,
                        "anthropic-version": "2023-06-01",
                    },
                )
            if resp.status_code == 200:
                data = resp.json()
                models = [
                    {"value": m["id"], "label": m.get("display_name", m["id"])}
                    for m in (data.get("data") or [])
                ]
                return {"valid": True, "message": f"✅ Anthropic API key valid! {len(models)} models available.", "models": models}
            elif resp.status_code == 401:
                return {"valid": False, "message": "❌ Invalid API key", "models": []}
            else:
                return {"valid": False, "message": f"❌ HTTP {resp.status_code}", "models": []}
        except Exception as e:
            return {"valid": False, "message": f"❌ Connection failed: {str(e)[:80]}", "models": []}

    elif provider == "groq":
        if not api_key:
            return {"valid": False, "message": "API key is required", "models": []}
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.get(
                    "https://api.groq.com/openai/v1/models",
                    headers={"Authorization": f"Bearer {api_key}"},
                )
            if resp.status_code == 200:
                data = resp.json()
                models = [
                    {"value": m["id"], "label": m["id"]}
                    for m in sorted(data.get("data") or [], key=lambda x: x.get("id", ""))
                    if not m.get("id", "").startswith("whisper") and not m.get("id", "").startswith("distil")
                ]
                return {"valid": True, "message": f"✅ Groq API key valid! {len(models)} models available.", "models": models}
            elif resp.status_code == 401:
                return {"valid": False, "message": "❌ Invalid API key", "models": []}
            else:
                return {"valid": False, "message": f"❌ HTTP {resp.status_code}", "models": []}
        except Exception as e:
            return {"valid": False, "message": f"❌ Connection failed: {str(e)[:80]}", "models": []}

    elif provider == "openrouter":
        if not api_key:
            return {"valid": False, "message": "API key is required", "models": []}
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.get(
                    "https://openrouter.ai/api/v1/models",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "HTTP-Referer": "https://opensarthi.app",
                    },
                )
            if resp.status_code == 200:
                data = resp.json()
                models = sorted(
                    [
                        {"value": m["id"], "label": m.get("name") or m["id"]}
                        for m in (data.get("data") or [])
                        if m.get("id")
                    ],
                    key=lambda m: m["value"],
                )
                return {"valid": True, "message": f"✅ OpenRouter API key valid! {len(models)} models available.", "models": models}
            elif resp.status_code == 401:
                return {"valid": False, "message": "❌ Invalid API key", "models": []}
            else:
                return {"valid": False, "message": f"❌ HTTP {resp.status_code}", "models": []}
        except Exception as e:
            return {"valid": False, "message": f"❌ Connection failed: {str(e)[:80]}", "models": []}

    elif provider == "ollama":
        ollama_url = (base_url or "http://127.0.0.1:11434").rstrip("/")
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                resp = await client.get(f"{ollama_url}/api/tags")
            if resp.status_code == 200:
                data = resp.json()
                models = [
                    {"value": m["name"], "label": m["name"]}
                    for m in (data.get("models") or [])
                ]
                return {"valid": True, "message": f"✅ Ollama running at {ollama_url} with {len(models)} models.", "models": models}
            else:
                return {"valid": False, "message": f"❌ Ollama returned HTTP {resp.status_code}", "models": []}
        except Exception:
            return {"valid": False, "message": f"❌ Ollama not reachable at {ollama_url}. Is it running?", "models": []}

    elif provider == "custom_openai":
        if not base_url:
            return {"valid": False, "message": "❌ Base URL is required for custom endpoint", "models": []}
        effective_url = base_url.rstrip("/")
        headers = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.get(f"{effective_url}/models", headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, dict):
                    raw = data.get("data") or data.get("models") or []
                elif isinstance(data, list):
                    raw = data
                else:
                    raw = []
                models = [
                    {"value": m.get("id") or m.get("name") or str(m), "label": m.get("name") or m.get("id") or str(m)}
                    for m in raw if (isinstance(m, dict) and (m.get("id") or m.get("name"))) or isinstance(m, str)
                ]
                return {"valid": True, "message": f"✅ Custom endpoint reachable! {len(models)} models found.", "models": models}
            elif resp.status_code == 401:
                return {"valid": False, "message": "❌ Unauthorized (401): Check your API key", "models": []}
            elif resp.status_code == 404:
                return {"valid": False, "message": "❌ Endpoint returned 404 Not Found (is base URL correct?)", "models": []}
            else:
                return {"valid": False, "message": f"❌ Endpoint returned HTTP {resp.status_code}", "models": []}
        except Exception as e:
            return {"valid": False, "message": f"❌ Connection failed: {str(e)[:80]}", "models": []}

    else:
        return {"valid": False, "message": f"Unknown provider: {provider}", "models": []}


# ─── Google OAuth & Integrations Endpoints ─────────────────────────────────────

@router.get("/oauth/google/start")
async def google_oauth_start(
    client_id: Optional[str] = None,
    client_secret: Optional[str] = None,
    redirect_uri: Optional[str] = None,
):
    """Initiates Google OAuth 2.0 flow by redirecting to Google authorization URL."""
    from fastapi.responses import HTMLResponse, RedirectResponse
    from config import settings, save_settings_to_env
    from tools.google_tools import get_auth_url
    import os

    # If credentials were provided in request query parameters, update in-memory settings & environment
    if client_id and client_id.strip():
        settings.google_client_id = client_id.strip()
        os.environ["GOOGLE_CLIENT_ID"] = client_id.strip()
    if client_secret and client_secret.strip():
        settings.google_client_secret = client_secret.strip()
        os.environ["GOOGLE_CLIENT_SECRET"] = client_secret.strip()

    if (client_id and client_id.strip()) or (client_secret and client_secret.strip()):
        save_settings_to_env(
            google_client_id=settings.google_client_id,
            google_client_secret=settings.google_client_secret,
        )

    effective_client_id = getattr(settings, "google_client_id", None) or os.environ.get("GOOGLE_CLIENT_ID")
    if not effective_client_id:
        return HTMLResponse("""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>OpenSarthi — Google OAuth Configuration Needed</title>
    <style>
        body { background: #07090f; color: #00ffcc; font-family: monospace; padding: 40px; text-align: center; }
        .card { max-width: 540px; margin: 40px auto; background: rgba(0, 255, 204, 0.05); border: 1px solid #00ffcc; padding: 30px; border-radius: 8px; box-shadow: 0 0 20px rgba(0,255,204,0.15); }
        h2 { color: #ff3b30; letter-spacing: 0.1em; }
        p { color: #a0aec0; line-height: 1.6; }
        code { background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; color: #fff; }
    </style>
</head>
<body>
    <div class="card">
        <h2>// GOOGLE CLIENT ID REQUIRED</h2>
        <p>To connect Google Workspace (Calendar & Gmail), please enter your <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> in OpenSarthi <strong>Settings &rarr; Integrations & Sources</strong>.</p>
        <p>Once entered, click <strong>"Authorize with Google"</strong> again to authenticate.</p>
    </div>
</body>
</html>""", status_code=400)

    auth_url = get_auth_url(client_id=effective_client_id, redirect_uri=redirect_uri)
    return RedirectResponse(url=auth_url)


@router.get("/oauth2callback")
@router.get("/oauth/google/callback")
async def google_oauth_callback(code: Optional[str] = None, error: Optional[str] = None):
    """Handles Google OAuth 2.0 redirect callback, exchanging code for tokens."""
    from fastapi.responses import HTMLResponse
    from tools.google_tools import exchange_code_for_tokens
    from config import settings, save_settings_to_env

    if error:
        return HTMLResponse(f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>OpenSarthi — OAuth Cancelled</title>
<style>body {{ background: #07090f; color: #ff3b30; font-family: monospace; padding: 40px; text-align: center; }}
.card {{ max-width: 480px; margin: 40px auto; background: rgba(255,59,48,0.08); border: 1px solid #ff3b30; padding: 30px; border-radius: 8px; }}</style></head>
<body><div class="card"><h2>// AUTHORIZATION FAILED</h2><p>{error}</p><p>You can close this tab and try again.</p></div></body></html>""", status_code=400)

    if not code:
        return HTMLResponse("""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>OpenSarthi — OAuth Missing Code</title>
<style>body { background: #07090f; color: #ff3b30; font-family: monospace; padding: 40px; text-align: center; }
.card { max-width: 480px; margin: 40px auto; background: rgba(255,59,48,0.08); border: 1px solid #ff3b30; padding: 30px; border-radius: 8px; }</style></head>
<body><div class="card"><h2>// NO AUTH CODE RECEIVED</h2><p>No authorization code was returned by Google.</p></div></body></html>""", status_code=400)

    success = await exchange_code_for_tokens(code)
    if success:
        settings.google_oauth_enabled = True
        save_settings_to_env(google_oauth_enabled=True)
        return HTMLResponse("""<!DOCTYPE html>
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
</html>""")
    else:
        return HTMLResponse("""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>OpenSarthi — Token Exchange Failed</title>
<style>body { background: #07090f; color: #ff3b30; font-family: monospace; padding: 40px; text-align: center; }
.card { max-width: 500px; margin: 40px auto; background: rgba(255,59,48,0.08); border: 1px solid #ff3b30; padding: 30px; border-radius: 8px; }</style></head>
<body><div class="card"><h2>// TOKEN EXCHANGE ERROR</h2><p>Failed to exchange code for access token. Verify your Client Secret in OpenSarthi Integrations Settings.</p></div></body></html>""", status_code=500)


@router.get("/integrations/status")
async def get_integrations_status():
    """Returns current integration connection states and client configuration."""
    from config import settings
    from tools.google_tools import load_tokens
    import os

    tokens = load_tokens()
    has_google = bool(tokens.get("access_token") or tokens.get("refresh_token"))
    client_id = getattr(settings, "google_client_id", "") or os.environ.get("GOOGLE_CLIENT_ID", "")
    has_secret = bool(getattr(settings, "google_client_secret", None) or os.environ.get("GOOGLE_CLIENT_SECRET"))

    return {
        "google_calendar": has_google,
        "google_gmail": has_google,
        "google_client_id": client_id,
        "google_client_secret_configured": has_secret,
        "twitter": bool(getattr(settings, "twitter_api_key", None)),
        "telegram": bool(getattr(settings, "telegram_bot_token", None)),
        "discord": bool(getattr(settings, "discord_webhook_url", None)),
        "smtp": bool(getattr(settings, "smtp_host", None)),
        "linkedin": bool(getattr(settings, "linkedin_access_token", None)),
    }


@router.post("/integrations/social")
async def save_social_integration(req: Request):
    """Save integration credentials (Google OAuth or social media)."""
    from fastapi.responses import JSONResponse
    from config import settings, save_settings_to_env
    import os

    try:
        body = await req.json()
    except Exception:
        return JSONResponse({"ok": False, "error": "Invalid JSON"}, status_code=400)

    integration = body.get("integration", "")

    if integration == "google" or "google_client_id" in body or "google_client_secret" in body:
        if "google_client_id" in body and body["google_client_id"] is not None:
            val = str(body["google_client_id"]).strip()
            settings.google_client_id = val
            os.environ["GOOGLE_CLIENT_ID"] = val
        if "google_client_secret" in body and body["google_client_secret"] is not None:
            val = str(body["google_client_secret"]).strip()
            settings.google_client_secret = val
            os.environ["GOOGLE_CLIENT_SECRET"] = val
    elif integration == "twitter":
        settings.twitter_api_key = body.get("twitter_api_key")
        settings.twitter_api_secret = body.get("twitter_api_secret")
        settings.twitter_access_token = body.get("twitter_access_token")
        settings.twitter_access_token_secret = body.get("twitter_access_token_secret")
    elif integration == "telegram":
        settings.telegram_bot_token = body.get("telegram_bot_token")
        settings.telegram_chat_id = body.get("telegram_chat_id")
    elif integration == "discord":
        settings.discord_webhook_url = body.get("discord_webhook_url")
    elif integration == "smtp":
        settings.smtp_host = body.get("smtp_host")
        settings.smtp_port = int(body.get("smtp_port", 587))
        settings.smtp_user = body.get("smtp_user")
        settings.smtp_password = body.get("smtp_password")
    elif integration == "linkedin":
        settings.linkedin_access_token = body.get("linkedin_access_token")

    # Persist all settings
    save_settings_to_env(
        google_client_id=getattr(settings, "google_client_id", None),
        google_client_secret=getattr(settings, "google_client_secret", None),
        twitter_api_key=getattr(settings, "twitter_api_key", None),
        twitter_api_secret=getattr(settings, "twitter_api_secret", None),
        twitter_access_token=getattr(settings, "twitter_access_token", None),
        twitter_access_token_secret=getattr(settings, "twitter_access_token_secret", None),
        telegram_bot_token=getattr(settings, "telegram_bot_token", None),
        telegram_chat_id=getattr(settings, "telegram_chat_id", None),
        discord_webhook_url=getattr(settings, "discord_webhook_url", None),
        smtp_host=getattr(settings, "smtp_host", None),
        smtp_port=getattr(settings, "smtp_port", 587),
        smtp_user=getattr(settings, "smtp_user", None),
        smtp_password=getattr(settings, "smtp_password", None),
        linkedin_access_token=getattr(settings, "linkedin_access_token", None),
    )

    return {"ok": True, "integration": integration}


@router.post("/integrations/revoke")
async def revoke_integration(req: Request):
    """Revoke and delete credentials/tokens for an integration."""
    from fastapi.responses import JSONResponse
    from config import settings, save_settings_to_env
    from tools.google_tools import TOKEN_FILE, save_tokens

    try:
        body = await req.json()
    except Exception:
        return JSONResponse({"ok": False, "error": "Invalid JSON"}, status_code=400)

    integration = body.get("integration", "")
    if integration in ("google", "google_calendar", "google_gmail"):
        save_tokens({})
        if TOKEN_FILE.exists():
            try:
                TOKEN_FILE.unlink()
            except Exception:
                pass
        settings.google_oauth_enabled = False
        save_settings_to_env(google_oauth_enabled=False)

    return {"ok": True, "revoked": integration}

