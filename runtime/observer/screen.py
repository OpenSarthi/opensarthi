import asyncio
import platform
import os
import shutil
from typing import Optional

def _detect_display() -> str:
    """Detect display server on Linux."""
    if os.environ.get("WAYLAND_DISPLAY"):
        return "wayland"
    return "x11"

def _sync_capture_desktop(max_width: int = 1280) -> Optional[tuple[bytes, tuple[int, int]]]:
    """Synchronous desktop capture and resize run in worker thread to prevent event loop blocking."""
    try:
        import mss
        import mss.tools
        import pyautogui
        from PIL import Image, ImageDraw
        import io

        with mss.mss() as sct:
            # Capture all monitors combined (virtual monitor 0) to support multi-monitor setups
            monitor = sct.monitors[0]
            img = sct.grab(monitor)
            
            # Convert raw RGB to PIL Image
            pil_img = Image.frombytes("RGB", img.size, img.rgb)
            orig_w, orig_h = img.size
            
            try:
                # Retrieve the last mouse coordinates from the agent window session
                from window_session import get_session
                session = get_session()
                source = "session"
                if session.last_mouse_x is not None and session.last_mouse_y is not None:
                    mx, my = session.last_mouse_x, session.last_mouse_y
                else:
                    mx, my = pyautogui.position()
                    source = "pyautogui"
                    
                if 0 <= mx < orig_w and 0 <= my < orig_h:
                    draw = ImageDraw.Draw(pil_img)
                    r = 12
                    # Draw a bright red target ring
                    draw.ellipse([mx - r, my - r, mx + r, my + r], outline=(255, 0, 0), width=3)
                    # Draw inner dot
                    draw.ellipse([mx - 2, my - 2, mx + 2, my + 2], fill=(255, 0, 0))
                    # Draw crosshair lines extending slightly beyond the ring
                    draw.line([mx - r - 4, my, mx + r + 4, my], fill=(255, 0, 0), width=2)
                    draw.line([mx, my - r - 4, mx, my + r + 4], fill=(255, 0, 0), width=2)
            except Exception:
                pass

            # Downscale wide captures directly before PNG compression to avoid redundant compress/decompress
            if orig_w > max_width:
                new_h = int(orig_h * (max_width / orig_w))
                pil_img = pil_img.resize((max_width, new_h), Image.Resampling.BILINEAR)

            final_size = pil_img.size
            # Convert back to PNG bytes
            output = io.BytesIO()
            pil_img.save(output, format="PNG")
            return output.getvalue(), final_size
    except Exception:
        return None

async def capture_screenshot(max_width: int = 1280) -> Optional[bytes]:
    """Capture screen non-blockingly and return PNG bytes."""
    # Android: mss/pyautogui/PIL are unavailable. Use the accessibility-service
    # takeScreenshot (API 30+) when possible, else fall back to the screencap
    # shell utility.
    if os.environ.get("OPENSARTHI_PLATFORM") == "android":
        return await _android_screenshot()
    res = await asyncio.to_thread(_sync_capture_desktop, max_width)
    return res[0] if res else None

async def capture_screenshot_with_size(max_width: int = 1280) -> Optional[tuple[bytes, tuple[int, int]]]:
    """Capture screen non-blockingly and return (PNG bytes, (width, height))."""
    if os.environ.get("OPENSARTHI_PLATFORM") == "android":
        bytes_data = await _android_screenshot()
        return (bytes_data, (1080, 2400)) if bytes_data else None
    return await asyncio.to_thread(_sync_capture_desktop, max_width)

async def _android_screenshot() -> Optional[bytes]:
    """Capture the Android screen to PNG bytes.

    Order of preference:
      1. AccessibilityService.takeScreenshot() (API 30+, no shell/root needed).
      2. `screencap -p` shell utility (needs shell/root on most devices).
    """
    # 1. Accessibility-service screenshot — works in the app's own process.
    try:
        from dev.opensarthi.android import SarthiAccessibilityService
        if SarthiAccessibilityService.isServiceRunning():
            data = SarthiAccessibilityService.takeScreenshot()
            if data is not None:
                return bytes(data)
    except Exception:
        pass

    # 2. Fallback: screencap to a temp file.
    try:
        import tempfile
        path = os.path.join(tempfile.gettempdir(), "opensarthi_screencap.png")
        proc = await asyncio.create_subprocess_exec(
            "sh", "-c", f"screencap -p {path}",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(proc.wait(), timeout=10)
        with open(path, "rb") as f:
            return f.read()
    except Exception:
        return None


async def get_active_window() -> Optional[str]:
    """Retrieve active window title based on OS and display server."""
    # Android has no X11/Wayland window manager.
    if os.environ.get("OPENSARTHI_PLATFORM") == "android":
        return None
    system = platform.system()
    if system == "Windows":
        return await _windows_active_window()
    elif system == "Linux":
        display = _detect_display()
        if display == "x11":
            return await _x11_active_window()
        elif display == "wayland":
            return await _wayland_active_window()
    return None

async def _windows_active_window() -> Optional[str]:
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

async def _x11_active_window() -> Optional[str]:
    try:
        proc = await asyncio.create_subprocess_exec(
            "xdotool", "getactivewindow", "getwindowname",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=2)
        return stdout.decode().strip() or None
    except Exception:
        return None

async def _wayland_active_window() -> Optional[str]:
    try:
        import gi
        gi.require_version("Atspi", "2.0")
        from gi.repository import Atspi
        desktop = Atspi.get_desktop(0)
        if desktop:
            for i in range(desktop.get_child_count()):
                app = desktop.get_child_at_index(i)
                if not app:
                    continue
                for j in range(app.get_child_count()):
                    win = app.get_child_at_index(j)
                    if not win:
                        continue
                    try:
                        states = win.get_state_set()
                        if states.contains(Atspi.StateType.ACTIVE):
                            return win.get_name() or None
                    except Exception:
                        pass
    except Exception:
        pass
    return None
