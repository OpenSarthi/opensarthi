import asyncio
import time
from dataclasses import dataclass
from typing import Optional
from observer.screen import capture_screenshot, get_active_window
from observer.ocr import extract_text
from observer.vision import describe_screen

@dataclass
class ObservationResult:
    screenshot_bytes: Optional[bytes] = None
    ocr_text: Optional[str] = None
    vision_description: Optional[str] = None
    active_window: Optional[str] = None
    ui_elements: Optional[str] = None

class ObserverPipeline:
    """
    Pluggable observation pipeline.
    Fast path: screenshot and active window name (always runs).
    Slow path: OCR and optional vision description.

    Performance: snapshot results are cached for up to `cache_ttl` seconds.
    Pass force_fresh=True to bypass cache (e.g. after a tool executes and mutates the screen).
    """

    CACHE_TTL = 2.0  # seconds — skip re-capture if screen hasn't changed

    def __init__(self, use_ocr: bool = True, use_vision: bool = False):
        self.use_ocr = use_ocr
        self.use_vision = use_vision
        self._last_result: Optional[ObservationResult] = None
        self._last_capture_time: float = 0.0

    async def observe(self, force_fresh: bool = False) -> ObservationResult:
        now = time.monotonic()
        age = now - self._last_capture_time

        # Return cached result if it's still fresh and not forced
        if (
            not force_fresh
            and self._last_result is not None
            and age < self.CACHE_TTL
        ):
            return self._last_result

        result = ObservationResult()

        # Fast path — always capture active window; screenshot only if needed
        result.active_window = await get_active_window()
        result.screenshot_bytes = await capture_screenshot()

        # Slow path — OCR (expensive, pytesseract is CPU-intensive)
        if self.use_ocr and result.screenshot_bytes:
            try:
                result.ocr_text = await extract_text(result.screenshot_bytes)
            except Exception:
                pass

        if self.use_vision and result.screenshot_bytes:
            result.vision_description = await describe_screen(result.screenshot_bytes)

        self._last_result = result
        self._last_capture_time = now
        return result

    def invalidate_cache(self):
        """Force the next observe() call to re-capture, regardless of TTL."""
        self._last_capture_time = 0.0
