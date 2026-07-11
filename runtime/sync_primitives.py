import asyncio
import time
import platform
from typing import Callable, Optional, Any

class TimeoutError(Exception):
    pass

class WaitConditionError(Exception):
    pass


async def poll_until(
    condition: Callable[[], Any],
    timeout: float = 10.0,
    interval: float = 0.5,
    description: str = "condition"
) -> Any:
    """
    Poll a callable until it returns a truthy value or timeout expires.
    """
    deadline = time.monotonic() + timeout
    last_error = None

    while time.monotonic() < deadline:
        try:
            result = condition()
            if asyncio.iscoroutine(result):
                result = await result
            if result:
                return result
        except Exception as e:
            last_error = e

        await asyncio.sleep(interval)

    raise TimeoutError(
        f"Timed out after {timeout}s waiting for: {description}. "
        f"Last error: {last_error}"
    )


async def wait_for_window(
    title_contains: str,
    timeout: float = 10.0,
    observer=None
) -> bool:
    """
    Wait until a window with a matching title appears.
    """
    import shutil
    async def check():
        try:
            if platform.system() == "Windows":
                proc = await asyncio.create_subprocess_exec(
                    "powershell", "-Command",
                    f"Get-Process | Where-Object {{$_.MainWindowTitle -like '*{title_contains}*'}} | Select-Object -First 1 -ExpandProperty MainWindowTitle",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.DEVNULL
                )
                stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=2)
                return bool(stdout.decode().strip())
            else:
                # Let's check using wmctrl if available for robust title normalization matching
                found = False
                if shutil.which("wmctrl"):
                    proc = await asyncio.create_subprocess_exec(
                        "wmctrl", "-l",
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.DEVNULL
                    )
                    stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=2)
                    lines = stdout.decode("utf-8", errors="ignore").strip().split("\n")
                    
                    # Normalize helper: lowercase, strip extra spaces/special chars, replace dashes
                    def normalize(s: str) -> str:
                        s = s.lower().replace("—", "-").replace("–", "-")
                        return "".join(c for c in s if c.isalnum() or c in " -")

                    target_norm = normalize(title_contains)
                    for line in lines:
                        parts = line.split(None, 3)
                        if len(parts) >= 4:
                            w_title = parts[3]
                            if target_norm in normalize(w_title) or title_contains.lower() in w_title.lower():
                                found = True
                                break

                # AT-SPI accessibility tree query fallback (works on Wayland native clients)
                if not found:
                    try:
                        import gi
                        gi.require_version("Atspi", "2.0")
                        from gi.repository import Atspi
                        desktop = Atspi.get_desktop(0)
                        if desktop:
                            target = title_contains.lower()
                            for i in range(desktop.get_child_count()):
                                app = desktop.get_child_at_index(i)
                                if not app:
                                    continue
                                app_name = app.get_name() or ""
                                if target in app_name.lower():
                                    found = True
                                    break
                                for j in range(app.get_child_count()):
                                    win = app.get_child_at_index(j)
                                    if not win:
                                        continue
                                    win_name = win.get_name() or ""
                                    if target in win_name.lower():
                                        found = True
                                        break
                                if found:
                                    break
                    except Exception:
                        pass

                if found:
                    return True

                # Fallback to xdotool search
                if shutil.which("xdotool"):
                    proc = await asyncio.create_subprocess_exec(
                        "xdotool", "search", "--name", title_contains,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.DEVNULL
                    )
                    stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=2)
                    return bool(stdout.decode().strip())
                return False
        except Exception:
            return False

    return await poll_until(
        check,
        timeout=timeout,
        description=f"window containing '{title_contains}'"
    )


async def wait_for_text_visible(
    text: str,
    timeout: float = 10.0,
    observer=None
) -> bool:
    """
    Wait until specific text appears on screen (via OCR or AT-SPI).
    """
    if observer is None:
        from observation import DesktopObserver
        observer = DesktopObserver()

    async def check():
        snap = await observer.snapshot()
        # Check in AT-SPI focused/visible elements if available
        if snap.accessibility_tree and snap.accessibility_tree.get("summary"):
            summary = snap.accessibility_tree["summary"]
            if text.lower() in summary.lower():
                return True

        screen_text = snap.screen_text_summary or ""
        return text.lower() in screen_text.lower()

    return await poll_until(
        check,
        timeout=timeout,
        interval=1.0,
        description=f"text '{text}' to appear on screen"
    )


async def wait_for_process(
    process_name: str,
    timeout: float = 15.0
) -> bool:
    """
    Wait until a process with the given name is running.
    """
    async def check():
        if platform.system() == "Windows":
            proc = await asyncio.create_subprocess_exec(
                "tasklist", "/FI", f"IMAGENAME eq {process_name}.exe",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL
            )
        else:
            proc = await asyncio.create_subprocess_exec(
                "pgrep", "-x", process_name,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL
            )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=2)
        return bool(stdout.decode().strip())

    return await poll_until(
        check,
        timeout=timeout,
        description=f"process '{process_name}' to start"
    )


async def wait_for_network_idle(
    timeout: float = 10.0,
    check_interval: float = 1.0
) -> bool:
    """
    Wait until no significant network activity (heuristic: no new TCP connections).
    """
    import psutil

    async def check():
        connections_before = len(psutil.net_connections(kind="tcp"))
        await asyncio.sleep(check_interval)
        connections_after = len(psutil.net_connections(kind="tcp"))
        return abs(connections_after - connections_before) <= 2

    return await poll_until(
        check,
        timeout=timeout,
        description="network to become idle"
    )
