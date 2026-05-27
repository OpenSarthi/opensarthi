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
        self._platform = platform.system()
        if self._platform == "Linux":
            self._display = self._detect_display()
        else:
            self._display = "windows"
        self._a11y = AccessibilityProvider()

    def _detect_display(self) -> str:
        import os
        if os.environ.get("WAYLAND_DISPLAY"):
            return "wayland"
        return "x11"

    async def snapshot(self) -> DesktopSnapshot:
        snap = DesktopSnapshot()

        # 1. Active window
        try:
            snap.active_window_title = await self._get_active_window_title()
        except Exception as e:
            snap.error = f"window_title: {e}"

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

        # 3. OCR fallback (only if AT-SPI gave us nothing useful and tesseract is available)
        if not snap.focused_element_text:
            try:
                snap.screen_text_summary = await self._ocr_active_region()
            except Exception:
                pass

        return snap

    async def _get_active_window_title(self) -> Optional[str]:
        if self._platform == "Windows":
            # Use PowerShell to get active window title
            try:
                proc = await asyncio.create_subprocess_exec(
                    "powershell", "-Command",
                    "(Get-Process | Where-Object {$_.MainWindowHandle -eq "
                    "(Add-Type -MemberDefinition '[DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();' "
                    "-Name Win32 -Namespace Temp -PassThru)::GetForegroundWindow()}).MainWindowTitle",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.DEVNULL
                )
                stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=3)
                return stdout.decode().strip() or None
            except Exception:
                return None
        elif self._display == "x11":
            proc = await asyncio.create_subprocess_exec(
                "xdotool", "getactivewindow", "getwindowname",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=2)
            return stdout.decode().strip() or None
        return None  # Wayland: implement via D-Bus portal later

    async def _ocr_active_region(self) -> Optional[str]:
        """Capture center 800x600 of screen and run OCR."""
        if not shutil.which("tesseract"):
            return None # Tesseract is not installed

        try:
            import pytesseract
        except ImportError:
            return None

        with mss.mss() as sct:
            monitor = sct.monitors[1]  # Primary display
            # Capture center region only (faster than full screen)
            region = {
                "left": monitor["left"] + monitor["width"] // 4,
                "top": monitor["top"] + monitor["height"] // 4,
                "width": monitor["width"] // 2,
                "height": monitor["height"] // 2,
            }
            img = sct.grab(region)
            pil_img = Image.frombytes("RGB", img.size, img.bgra, "raw", "BGRX")

        # Run OCR in thread pool to avoid blocking
        loop = asyncio.get_event_loop()
        text = await loop.run_in_executor(
            None,
            pytesseract.image_to_string,
            pil_img,
            "eng"  # language
        )
        # Clean up whitespace and truncate
        cleaned = " ".join(text.split())[:500]
        return cleaned if cleaned else None
