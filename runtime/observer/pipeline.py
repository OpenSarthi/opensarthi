import asyncio
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
    """

    def __init__(self, use_ocr: bool = True, use_vision: bool = False):
        self.use_ocr = use_ocr
        self.use_vision = use_vision

    async def observe(self) -> ObservationResult:
        result = ObservationResult()

        # Fast path
        result.active_window = await get_active_window()
        result.screenshot_bytes = await capture_screenshot()

        # Slow path
        if self.use_ocr and result.screenshot_bytes:
            result.ocr_text = await extract_text(result.screenshot_bytes)

        if self.use_vision and result.screenshot_bytes:
            result.vision_description = await describe_screen(result.screenshot_bytes)

        return result
