import asyncio
import time
import subprocess
import shutil
import platform
import os
import tempfile
from dataclasses import dataclass, field
from typing import Optional

# Platform-conditional accessibility provider
# NOTE: Android reports itself as "Linux" to Python's platform.system(),
# so we must also gate on OPENSARTHI_PLATFORM.
if platform.system() == "Linux" and os.environ.get("OPENSARTHI_PLATFORM") != "android":
    from providers.linux.accessibility import AccessibilityProvider
else:
    # Stub for non-Linux platforms (and Android)
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
    screenshot_base64: Optional[str] = None      # Base64 representation of desktop screenshot (downscaled ≤1280px wide)
    screenshot_size: Optional[tuple] = None      # (width, height) of the encoded screenshot
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

    def invalidate_cache(self):
        """Invalidate the observer cache — call after a tool mutates screen state."""
        self._pipeline.invalidate_cache()

    async def snapshot(self, force_fresh: bool = False) -> DesktopSnapshot:
        snap = DesktopSnapshot()

        # Execute unified observer pipeline
        obs_res = await self._pipeline.observe(force_fresh=force_fresh)
        snap.active_window_title = obs_res.active_window

        # Encode screenshot to base64 if available.
        # Downscale wide/multi-monitor captures before encoding: the base64 sits
        # in LangGraph checkpoint state and goes to the vision model, and a full
        # 8K capture would be several MB. 1280px wide is ample for GUI context.
        if obs_res.screenshot_bytes:
            import base64
            import io
            encoded = obs_res.screenshot_bytes
            size = None
            try:
                from PIL import Image
                img = Image.open(io.BytesIO(obs_res.screenshot_bytes))
                width, height = img.size
                size = (width, height)
                max_w = 1280
                if width > max_w:
                    new_height = int(height * (max_w / width))
                    img = img.resize((max_w, new_height), Image.LANCZOS)
                    buf = io.BytesIO()
                    img.save(buf, format="PNG")
                    encoded = buf.getvalue()
                    size = img.size
            except Exception:
                pass
            snap.screenshot_base64 = base64.b64encode(encoded).decode("utf-8")
            snap.screenshot_size = size

            # Save to temporary path
            try:
                temp_dir = tempfile.gettempdir()
                screenshot_file = os.path.join(temp_dir, f"opensarthi_snap_{int(time.time())}.png")
                with open(screenshot_file, "wb") as f:
                    f.write(encoded)
                snap.screenshot_path = screenshot_file
            except Exception:
                pass

        # 2. AT-SPI focused element (primary — fast, Linux only)
        if self._a11y.available:
            try:
                focused = self._a11y.get_focused_element()
                if focused:
                    snap.focused_element_role = focused.role
                    snap.focused_element_text = focused.name

                # Include scoped, hierarchical accessibility tree for the LLM —
                # the active window's DOM-like structure, not a 30-element skim.
                if hasattr(self._a11y, "get_window_tree_summary"):
                    tree_text, total, truncated = self._a11y.get_window_tree_summary(
                        max_depth=8, max_elements=300
                    )
                else:
                    tree_text = self._a11y.get_tree_summary(max_elements=120)
                    total, truncated = None, False
                snap.accessibility_tree = {
                    "summary": tree_text,
                    "total": total,
                    "truncated": truncated,
                }
            except Exception:
                pass

        # 2b. Android: build the UI structure tree from the AccessibilityService.
        #     This is the on-screen "page state" the planner uses instead of
        #     AT-SPI/OCR (which don't exist on Android).
        if os.environ.get("OPENSARTHI_PLATFORM") == "android":
            try:
                from dev.opensarthi.android import SarthiAccessibilityService
                if SarthiAccessibilityService.isServiceRunning():
                    structure_json = SarthiAccessibilityService.getScreenStructure()
                    import json
                    data = json.loads(structure_json)
                    nodes = []

                    def _walk(node):
                        text = (node.get("text") or "").strip()
                        desc = (node.get("desc") or "").strip()
                        bounds = node.get("bounds", "")
                        clickable = node.get("clickable", False)
                        if text or desc:
                            click_ind = " [Clickable]" if clickable else ""
                            nodes.append(f"- {text or desc} at {bounds}{click_ind}")
                        for child in node.get("children", []):
                            _walk(child)

                    _walk(data)
                    snap.accessibility_tree = {
                        "summary": "\n".join(nodes) if nodes else "(no labeled UI elements)",
                        "total": len(nodes),
                        "truncated": False,
                    }
            except Exception:
                pass

        # 3. Screen text summary (OCR)
        snap.screen_text_summary = obs_res.ocr_text

        return snap
