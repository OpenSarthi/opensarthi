"""
Platform Capability Discovery for OpenSarthi.

Detects operating system, display server (Wayland vs X11), input simulation support,
and screen capture capabilities. Enables the planner and tools to fail fast on
unsupported actions rather than entering repetitive healing/replanning loops.
"""
from __future__ import annotations

import os
import platform
import shutil
from dataclasses import dataclass, field
from functools import lru_cache
from typing import List


@dataclass
class PlatformSupport:
    """Current machine OS capabilities and restrictions."""
    os_name: str
    display_server: str = ""           # 'wayland', 'x11', or ''
    can_control_input: bool = True     # click, type, press_key
    can_capture_screen: bool = True    # screenshot, vision
    can_focus_windows: bool = True     # focus_window
    notes: List[str] = field(default_factory=list)

    @property
    def is_wayland(self) -> bool:
        return self.display_server == "wayland"


def _detect_linux_display() -> str:
    """Detect Linux display server type ('wayland', 'x11', or '')."""
    session = (os.environ.get("XDG_SESSION_TYPE") or "").strip().lower()
    if session in ("wayland", "x11"):
        return session
    if os.environ.get("WAYLAND_DISPLAY"):
        return "wayland"
    if os.environ.get("DISPLAY"):
        return "x11"
    return ""


@lru_cache(maxsize=1)
def get_platform_support() -> PlatformSupport:
    """
    Detect operating system capabilities once and cache the result.
    Never blocks, never raises.
    """
    sys_name = platform.system()

    # Android environment
    if os.environ.get("OPENSARTHI_PLATFORM") == "android":
        return PlatformSupport(
            os_name="Android",
            display_server="surfaceflinger",
            can_control_input=True,     # Delegated to SarthiAccessibilityService
            can_capture_screen=True,    # Via AccessibilityService.takeScreenshot()
            can_focus_windows=False,
            notes=["Android execution managed via AccessibilityService and Android Bridge."]
        )

    if sys_name == "Windows":
        return PlatformSupport(
            os_name="Windows",
            display_server="win32",
            can_control_input=True,
            can_capture_screen=True,
            can_focus_windows=True,
        )

    if sys_name == "Darwin":
        return PlatformSupport(
            os_name="macOS",
            display_server="quartz",
            can_control_input=True,
            can_capture_screen=True,
            can_focus_windows=True,
            notes=["Requires Accessibility and Screen Recording permissions in System Settings."]
        )

    # Linux detection
    display = _detect_linux_display()
    support = PlatformSupport(os_name="Linux", display_server=display)

    if not display:
        support.can_control_input = False
        support.can_capture_screen = False
        support.can_focus_windows = False
        support.notes.append("No graphical session found. Desktop automation disabled.")
        return support

    if display == "wayland":
        # Check if ydotool is installed
        has_ydotool = shutil.which("ydotool") is not None
        ydotool_socket = os.path.exists(os.environ.get("YDOTOOL_SOCKET", "/tmp/.ydotool_socket"))

        if not (has_ydotool and ydotool_socket):
            support.can_control_input = False
            support.notes.append(
                "Wayland session active without ydotoold socket. Synthetic input (clicking, typing) "
                "into native Wayland windows is restricted by compositor security policy."
            )

        # Check window focus helpers
        if not (shutil.which("wmctrl") or shutil.which("xdotool")):
            support.can_focus_windows = False

    elif display == "x11":
        if not (shutil.which("xdotool") or shutil.which("wmctrl")):
            support.can_focus_windows = False
            support.notes.append("xdotool or wmctrl is required to refocus existing application windows.")

    return support


def get_platform_prompt_notes() -> List[str]:
    """Returns human-readable machine capability limitations to inject into planner prompt."""
    support = get_platform_support()
    limits = []
    if not support.can_control_input:
        limits.append(
            "- OS LIMITATION: Direct mouse/keyboard synthetic input is disabled in this session "
            f"({support.display_server or support.os_name}). Prefer terminal commands or URL navigation over GUI clicks."
        )
    if not support.can_capture_screen:
        limits.append(
            "- OS LIMITATION: Desktop screen capture is unavailable in this session."
        )
    return limits
