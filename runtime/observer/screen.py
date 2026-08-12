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

async def capture_screenshot() -> Optional[bytes]:
    """Capture screen and return PNG bytes."""
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
            
            try:
                # Retrieve the last mouse coordinates from the agent window session
                from window_session import get_session
                session = get_session()
                source = "session"
                if session.last_mouse_x is not None and session.last_mouse_y is not None:
                    mx, my = session.last_mouse_x, session.last_mouse_y
                else:
                    # Fallback to pyautogui for X11/Windows/Mac
                    mx, my = pyautogui.position()
                    source = "pyautogui"
                    
                width, height = img.size
                if 0 <= mx < width and 0 <= my < height:
                    try:
                        import structlog
                        structlog.get_logger().info("Drawing cursor target highlight on screenshot", x=mx, y=my, source=source)
                    except Exception:
                        pass
                    draw = ImageDraw.Draw(pil_img)
                    r = 12
                    # Draw a bright red target ring
                    draw.ellipse([mx - r, my - r, mx + r, my + r], outline=(255, 0, 0), width=3)
                    # Draw inner dot
                    draw.ellipse([mx - 2, my - 2, mx + 2, my + 2], fill=(255, 0, 0))
                    # Draw crosshair lines extending slightly beyond the ring
                    draw.line([mx - r - 4, my, mx + r + 4, my], fill=(255, 0, 0), width=2)
                    draw.line([mx, my - r - 4, mx, my + r + 4], fill=(255, 0, 0), width=2)
            except Exception as e:
                try:
                    import structlog
                    structlog.get_logger().warning("Failed to draw cursor target on screenshot", error=str(e))
                except Exception:
                    pass
                
            # Convert back to PNG bytes
            output = io.BytesIO()
            pil_img.save(output, format="PNG")
            return output.getvalue()
    except Exception:
        return None

async def get_active_window() -> Optional[str]:
    """Retrieve active window title based on OS and display server."""
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
