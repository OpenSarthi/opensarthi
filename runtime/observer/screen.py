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
        with mss.mss() as sct:
            monitor = sct.monitors[1]  # Primary monitor
            img = sct.grab(monitor)
            return mss.tools.to_png(img.rgb, img.size)
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
    # Placeholder for compositor-specific window active title tracking.
    # On GNOME Wayland, standard portal or extension queries may be needed.
    return None
