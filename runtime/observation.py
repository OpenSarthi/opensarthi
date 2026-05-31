import asyncio
import time
import subprocess
import shutil
import platform
from dataclasses import dataclass, field
from typing import Optional
import mss
from PIL import Image

# Platform-conditional accessibility provider
if platform.system() == "Linux":
    from providers.linux.accessibility import AccessibilityProvider
else:
    # Stub for non-Linux platforms
    class AccessibilityProvider:
        available = False
        def get_focused_element(self): return None
        def get_tree_summary(self, max_elements=30): return ""

@dataclass
class DesktopSnapshot:
    """A point-in-time snapshot of the desktop state."""
    timestamp: float = field(default_factory=time.time)
    active_window_title: Optional[str] = None
    active_window_pid: Optional[int] = None
    focused_element_role: Optional[str] = None
    focused_element_text: Optional[str] = None
    screen_text_summary: Optional[str] = None   # OCR on visible area
    accessibility_tree: Optional[dict] = None    # AT-SPI tree (when available)
    screenshot_path: Optional[str] = None        # Saved to temp dir for LLM vision
    error: Optional[str] = None

    def to_prompt_context(self) -> str:
        """Format snapshot as a text block for the LLM prompt."""
        lines = [
            f"DESKTOP STATE (at {self.timestamp:.1f}):",
            f"  Active Window: {self.active_window_title or 'unknown'}",
            f"  Focused Element: {self.focused_element_role or 'none'} — '{self.focused_element_text or ''}'",
        ]
        if self.screen_text_summary:
            lines.append(f"  Visible Text (OCR): {self.screen_text_summary[:300]}")
        return "\n".join(lines)


class DesktopObserver:
    """
    Collects desktop state snapshots. Uses:
    - Linux: wmctrl/xdotool for active window info (X11), AT-SPI for accessibility tree
    - Windows: PowerShell for active window info
    - All: mss + pytesseract for screenshot OCR (fallback)
    """

    def __init__(self):
        from observer.pipeline import ObserverPipeline
        self._a11y = AccessibilityProvider()
        self._pipeline = ObserverPipeline(use_ocr=True, use_vision=False)

    async def snapshot(self) -> DesktopSnapshot:
        snap = DesktopSnapshot()

        # Execute unified observer pipeline
        obs_res = await self._pipeline.observe()
        snap.active_window_title = obs_res.active_window

        # 2. AT-SPI focused element (primary — fast, Linux only)
        if self._a11y.available:
            try:
                focused = self._a11y.get_focused_element()
                if focused:
                    snap.focused_element_role = focused.role
                    snap.focused_element_text = focused.name
                
                # Include UI tree summary for LLM
                snap.accessibility_tree = {
                    "summary": self._a11y.get_tree_summary(max_elements=30)
                }
            except Exception:
                pass

        # 3. OCR fallback (only if AT-SPI gave us nothing useful)
        if not snap.focused_element_text:
            snap.screen_text_summary = obs_res.ocr_text

        return snap
