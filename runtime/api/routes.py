from fastapi import APIRouter, HTTPException, Query
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
