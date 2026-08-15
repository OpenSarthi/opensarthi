"""
Instant Vision Acknowledgment — Mark-L Parity Feature

Provides immediate "looking" state acknowledgment when user asks about screen content.
Captures screenshot immediately, emits "looking" state, then performs async analysis.
"""
import asyncio
import structlog
import base64
from typing import Optional, Dict, Any, List
from dataclasses import dataclass

from tools.registry import get
from observation import DesktopObserver, DesktopSnapshot

logger = structlog.get_logger()


@dataclass
class VisionResult:
    """Result of screen analysis."""
    screenshot_b64: str
    description: str
    ui_elements: List[Dict[str, Any]]
    timestamp: float


class InstantVision:
    """
    Instant Vision Acknowledgment system.

    Flow:
    1. User asks "what's on my screen" or similar
    2. Immediately capture screenshot
    3. Emit "voice_state": "looking" (instant acknowledgment)
    4. Async: Analyze screenshot with vision model
    5. Emit "screen_analysis" with results
    """

    def __init__(self, ws_handler, settings, thread_id: str = None):
        self.ws = ws_handler
        self.settings = settings
        self.thread_id = thread_id
        self.observer = DesktopObserver()
        self._analysis_task: Optional[asyncio.Task] = None

    async def acknowledge_and_analyze(self, prompt: str = "What's on my screen?"):
        """
        Main entry point: capture screenshot, emit "looking" state,
        then analyze asynchronously.
        """
        # Step 1: Capture screenshot immediately
        snapshot = await self._capture_screenshot()
        if not snapshot or not snapshot.screenshot_base64:
            await self.ws.send_message("assistant_response", {
                "text": "I couldn't capture the screen. Please try again.",
                "thread_id": self.thread_id,
            })
            return

        # Step 2: Emit "looking" state INSTANTLY (<100ms)
        await self.ws.send_message("voice_state", {"state": "looking"})
        logger.info("Instant vision acknowledgment: looking state emitted", thread_id=self.thread_id)

        # Step 3: Send screenshot to frontend for immediate display
        await self.ws.send_message("screen_analysis", {
            "screenshot_b64": snapshot.screenshot_base64,
            "description": "Analyzing screen...",
            "ui_elements": [],
            "thread_id": self.thread_id,
        })

        # Step 4: Start async analysis
        self._analysis_task = asyncio.create_task(
            self._analyze_screenshot(snapshot, prompt)
        )

    async def _capture_screenshot(self) -> Optional[DesktopSnapshot]:
        """Capture desktop screenshot."""
        try:
            snapshot = await self.observer.snapshot()
            return snapshot
        except Exception as e:
            logger.error("Screenshot capture failed", error=str(e))
            return None

    async def _analyze_screenshot(self, snapshot: DesktopSnapshot, prompt: str):
        """Analyze screenshot with vision model (async, non-blocking)."""
        try:
            # Try to use vision model for analysis
            description, ui_elements = await self._call_vision_model(
                snapshot.screenshot_b64,
                prompt
            )

            # Emit final analysis
            await self.ws.send_message("screen_analysis", {
                "screenshot_b64": snapshot.screenshot_base64,
                "description": description,
                "ui_elements": ui_elements,
                "thread_id": self.thread_id,
            })

            # Also send as content_update for Content Panel
            await self.ws.send_message("content_update", {
                "content_type": "screen_analysis",
                "data": {
                    "title": "Screen Analysis",
                    "screenshot_b64": snapshot.screenshot_base64,
                    "description": description,
                    "ui_elements": ui_elements,
                },
                "thread_id": self.thread_id,
            })

            logger.info("Screen analysis completed", thread_id=self.thread_id)

        except Exception as e:
            logger.error("Screen analysis failed", error=str(e))
            await self.ws.send_message("screen_analysis", {
                "screenshot_b64": snapshot.screenshot_base64,
                "description": "I can see your screen but couldn't analyze it in detail.",
                "ui_elements": [],
                "thread_id": self.thread_id,
            })

    async def _call_vision_model(self, image_b64: str, prompt: str) -> tuple[str, List[Dict]]:
        """Call vision model (Gemini Vision, GPT-4V, or local)."""
        provider = self.settings.ai_provider.lower()
        api_key = None

        if provider == "google":
            from config import settings
            api_key = settings.gemini_api_key
            return await self._call_gemini_vision(api_key, image_b64, prompt)
        elif provider == "openai":
            from config import settings
            api_key = settings.openai_api_key
            return await self._call_openai_vision(api_key, image_b64, prompt)
        elif provider == "anthropic":
            from config import settings
            api_key = settings.anthropic_api_key
            return await self._call_anthropic_vision(api_key, image_b64, prompt)
        else:
            # Fallback: basic description without vision model
            return self._fallback_analysis(prompt), []

    async def _call_gemini_vision(self, api_key: str, image_b64: str, prompt: str) -> tuple[str, List[Dict]]:
        """Call Gemini Vision API."""
        import httpx
        import json

        if not api_key:
            return self._fallback_analysis(prompt), []

        # Convert base64 to inline data
        image_data = image_b64

        # Build request
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"
        payload = {
            "contents": [{
                "parts": [
                    {"text": f"{prompt}\nDescribe what you see in 2-3 sentences. List any clickable UI elements (buttons, links, inputs) with their approximate locations."},
                    {
                        "inline_data": {
                            "mime_type": "image/jpeg",
                            "data": image_data
                        }
                    }
                ]
            }],
            "generationConfig": {
                "temperature": 0.3,
                "maxOutputTokens": 500,
            }
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                url,
                params={"key": api_key},
                json=payload,
                timeout=30,
            )
            response.raise_for_status()
            data = response.json()
            text = data["candidates"][0]["content"]["parts"][0]["text"]

        # Parse UI elements from text (best effort)
        ui_elements = self._extract_ui_elements(text)
        return text, ui_elements

    async def _call_openai_vision(self, api_key: str, image_b64: str, prompt: str) -> tuple[str, List[Dict]]:
        """Call OpenAI GPT-4V API."""
        import httpx

        if not api_key:
            return self._fallback_analysis(prompt), []

        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": "gpt-4o",
                    "messages": [{
                        "role": "user",
                        "content": [
                            {"type": "text", "text": f"{prompt}\nDescribe what you see in 2-3 sentences. List any clickable UI elements."},
                            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}}
                        ]
                    }],
                    "max_tokens": 500,
                },
                timeout=30,
            )
            response.raise_for_status()
            data = response.json()
            text = data["choices"][0]["message"]["content"]

        ui_elements = self._extract_ui_elements(text)
        return text, ui_elements

    async def _call_anthropic_vision(self, api_key: str, image_b64: str, prompt: str) -> tuple[str, List[Dict]]:
        """Call Anthropic Claude Vision API."""
        import httpx

        if not api_key:
            return self._fallback_analysis(prompt), []

        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-3-5-sonnet-20241022",
                    "max_tokens": 500,
                    "messages": [{
                        "role": "user",
                        "content": [
                            {"type": "text", "text": f"{prompt}\nDescribe what you see in 2-3 sentences. List any clickable UI elements."},
                            {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": image_b64}}
                        ]
                    }]
                },
                timeout=30,
            )
            response.raise_for_status()
            data = response.json()
            text = data["content"][0]["text"]

        ui_elements = self._extract_ui_elements(text)
        return text, ui_elements

    def _extract_ui_elements(self, text: str) -> List[Dict]:
        """Extract UI elements from vision model output (best effort)."""
        elements = []
        # Simple heuristic: look for lines mentioning buttons, links, inputs
        lines = text.split("\n")
        for line in lines:
            line_lower = line.lower()
            if any(keyword in line_lower for keyword in ["button", "link", "input", "field", "click", "menu", "icon"]):
                elements.append({
                    "type": "detected",
                    "description": line.strip(),
                    "bounds": None,  # Would need OCR/vision for precise bounds
                })
        return elements[:10]  # Limit to 10

    def _fallback_analysis(self, prompt: str) -> str:
        """Fallback when no vision model available."""
        return "I can see your screen. It shows your current desktop with open windows. For detailed analysis, please configure a vision-capable AI provider (Google Gemini, OpenAI GPT-4V, or Anthropic Claude)."


# Global instance cache
_vision_instances: Dict[str, InstantVision] = {}

def get_instant_vision(ws_handler, settings, thread_id: str = None) -> InstantVision:
    """Get or create instant vision instance."""
    key = thread_id or "default"
    if key not in _vision_instances:
        _vision_instances[key] = InstantVision(ws_handler, settings, thread_id)
    return _vision_instances[key]