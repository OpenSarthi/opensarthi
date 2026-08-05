from fastapi import APIRouter, HTTPException, Query
from typing import Optional
import httpx

router = APIRouter()

@router.get("/health")
async def health_check():
    return {"status": "ok", "service": "opensarthi-runtime"}


@router.get("/models")
async def list_models(
    provider: str = Query(..., description="Provider: ollama | openai | openrouter"),
    api_key: Optional[str] = Query(None, description="API key (required for openai/openrouter)"),
):
    """
    Proxy model discovery for supported providers.
    Allows the frontend to fetch model lists without hitting external URLs
    directly (avoids CSP issues in the AppImage).
    """
    provider = provider.lower()

    if provider == "ollama":
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get("http://127.0.0.1:11434/api/tags")
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

    else:
        raise HTTPException(status_code=400, detail=f"Unsupported provider for model discovery: {provider}")

