import os
import asyncio
import subprocess
import shutil
import platform
import tempfile
from typing import Protocol, Optional
from tools.base import BaseTool, RiskLevel
from planner.schemas import ToolResult, ToolResultConfidence

SMOOTH_MOUSE = True
MOUSE_GLIDE_DURATION = 0.25

class DesktopProvider(Protocol):
    async def capture_screen(self) -> str: ...
    async def type_text(self, text: str) -> bool: ...
    async def click(self, x: int, y: int, button: str = "left") -> bool: ...
    async def press_key(self, key: str) -> bool: ...

class XdotoolProvider:
    async def capture_screen(self) -> str:
        return os.path.join(tempfile.gettempdir(), "opensarthi_screen.png")

    async def type_text(self, text: str, window_id: Optional[str] = None) -> bool:
        await asyncio.sleep(0.3)
        if len(text) > 20 and shutil.which("xsel"):
            try:
                proc = await asyncio.create_subprocess_exec(
                    "xsel", "-b", "-i",
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                await proc.communicate(input=text.encode("utf-8"))
                if proc.returncode == 0:
                    if window_id:
                        focus_proc = await asyncio.create_subprocess_exec(
                            "xdotool", "windowactivate", "--sync", window_id,
                            stdout=asyncio.subprocess.DEVNULL,
                            stderr=asyncio.subprocess.DEVNULL
                        )
                        await focus_proc.communicate()
                        await asyncio.sleep(0.15)
                    cmd = ["xdotool", "key", "--clearmodifiers", "ctrl+v"]
                    paste_proc = await asyncio.create_subprocess_exec(
                        *cmd,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE
                    )
                    await paste_proc.communicate()
                    return paste_proc.returncode == 0
            except Exception:
                pass

        cmd = ["xdotool"]
        if window_id:
            # Focus the pinned window first, then type into it by window ID
            cmd += ["type", "--window", window_id, "--clearmodifiers", "--delay", "15", text]
        else:
            cmd += ["type", "--clearmodifiers", "--delay", "15", text]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        await proc.communicate()
        return proc.returncode == 0

    async def press_key(self, key: str, window_id: Optional[str] = None) -> bool:
        cmd = ["xdotool", "key"]
        if window_id:
            cmd += ["--window", window_id]
        cmd.append(key)
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        await proc.communicate()
        return proc.returncode == 0

    async def click(self, x: int, y: int, button: str = "left", window_id: Optional[str] = None) -> bool:
        btn_map = {"left": "1", "middle": "2", "right": "3"}
        if window_id:
            # Activate the window first, then move and click
            proc = await asyncio.create_subprocess_exec(
                "xdotool", "windowactivate", "--sync", window_id,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            await proc.communicate()
            
        if SMOOTH_MOUSE:
            try:
                import pyautogui
                import structlog
                structlog.get_logger().info("Smooth mouse glide (X11/pyautogui)", x=x, y=y, duration=MOUSE_GLIDE_DURATION)
                pyautogui.moveTo(x, y, duration=MOUSE_GLIDE_DURATION)
            except Exception as e:
                import structlog
                structlog.get_logger().warn("Smooth mouse glide failed", error=str(e))

        # Update last mouse position in window session
        try:
            from window_session import get_session
            get_session().update_mouse(x, y)
        except Exception:
            pass

        proc = await asyncio.create_subprocess_exec(
            "xdotool", "mousemove", str(x), str(y), "click", btn_map.get(button, "1"),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        await proc.communicate()
        return proc.returncode == 0

    async def get_window_id(self, title: str) -> Optional[str]:
        """Get xdotool window ID by title substring."""
        try:
            proc = await asyncio.create_subprocess_exec(
                "xdotool", "search", "--onlyvisible", "--name", title,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, _ = await proc.communicate()
            ids = stdout.decode().strip().split()
            return ids[0] if ids else None
        except Exception:
            return None

    async def refocus_window(self, window_id: str) -> bool:
        """Bring pinned window back to focus without disturbing the user too aggressively."""
        try:
            proc = await asyncio.create_subprocess_exec(
                "xdotool", "windowactivate", "--sync", window_id,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            await proc.communicate()
            return proc.returncode == 0
        except Exception:
            return False


class YdotoolProvider:
    async def capture_screen(self) -> str:
        return os.path.join(tempfile.gettempdir(), "opensarthi_screen.png")

    async def type_text(self, text: str, window_id: Optional[str] = None) -> bool:
        await asyncio.sleep(0.3)
        # 1. Try ydotool
        if shutil.which("ydotool"):
            try:
                proc = await asyncio.create_subprocess_exec(
                    "ydotool", "type", text,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                await proc.communicate()
                if proc.returncode == 0:
                    return True
            except Exception:
                pass

        # 2. Try wtype (native Wayland typing tool)
        if shutil.which("wtype"):
            try:
                proc = await asyncio.create_subprocess_exec(
                    "wtype", text,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                await proc.communicate()
                if proc.returncode == 0:
                    return True
            except Exception:
                pass

        # 3. Try xdotool (via XWayland for browsers, editors, and XWayland clients)
        if shutil.which("xdotool"):
            try:
                proc = await asyncio.create_subprocess_exec(
                    "xdotool", "type", "--clearmodifiers", "--delay", "15", text,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                await proc.communicate()
                if proc.returncode == 0:
                    return True
            except Exception:
                pass

        # 4. Try clipboard paste (wl-copy or xsel) + ctrl+v
        try:
            if shutil.which("wl-copy"):
                proc = await asyncio.create_subprocess_exec(
                    "wl-copy",
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                await proc.communicate(input=text.encode("utf-8"))
            elif shutil.which("xsel"):
                proc = await asyncio.create_subprocess_exec(
                    "xsel", "-b", "-i",
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                await proc.communicate(input=text.encode("utf-8"))

            if shutil.which("xdotool"):
                proc = await asyncio.create_subprocess_exec(
                    "xdotool", "key", "--clearmodifiers", "ctrl+v",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                await proc.communicate()
                if proc.returncode == 0:
                    return True
            elif shutil.which("wtype"):
                proc = await asyncio.create_subprocess_exec(
                    "wtype", "-M", "ctrl", "v",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                await proc.communicate()
                if proc.returncode == 0:
                    return True
        except Exception:
            pass

        # 5. Try pyautogui fallback
        try:
            import pyautogui
            pyautogui.typewrite(text) if text.isascii() else pyautogui.write(text)
            return True
        except Exception:
            pass

        return False

    async def press_key(self, key: str, window_id: Optional[str] = None) -> bool:
        # 1. Try ydotool key
        if shutil.which("ydotool"):
            try:
                proc = await asyncio.create_subprocess_exec(
                    "ydotool", "key", key,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                await proc.communicate()
                if proc.returncode == 0:
                    return True
            except Exception:
                pass

        # 2. Try xdotool key
        if shutil.which("xdotool"):
            try:
                proc = await asyncio.create_subprocess_exec(
                    "xdotool", "key", "--clearmodifiers", key,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                await proc.communicate()
                if proc.returncode == 0:
                    return True
            except Exception:
                pass

        # 3. Try pyautogui key
        try:
            import pyautogui
            pyautogui.press(key.lower())
            return True
        except Exception:
            pass

        return False

    async def click(self, x: int, y: int, button: str = "left", window_id: Optional[str] = None) -> bool:
        # 1. Try ydotool (native Wayland mouse control)
        if shutil.which("ydotool"):
            try:
                # Move to absolute coordinates
                try:
                    import structlog
                    structlog.get_logger().info("Wayland absolute mouse move (ydotool)", x=x, y=y)
                except Exception:
                    pass

                from window_session import get_session
                session = get_session()
                
                start_x, start_y = x, y
                if session.last_mouse_x is not None and session.last_mouse_y is not None:
                    start_x = session.last_mouse_x
                    start_y = session.last_mouse_y
                else:
                    try:
                        import pyautogui
                        sw, sh = pyautogui.size()
                        start_x, start_y = sw // 2, sh // 2
                    except Exception:
                        start_x, start_y = 960, 540
                
                if SMOOTH_MOUSE and (start_x != x or start_y != y):
                    steps = 5
                    for i in range(1, steps + 1):
                        t = i / steps
                        curr_x = int(start_x + (x - start_x) * t)
                        curr_y = int(start_y + (y - start_y) * t)
                        move_proc = await asyncio.create_subprocess_exec(
                            "ydotool", "mousemove", "--absolute", str(curr_x), str(curr_y),
                            stdout=asyncio.subprocess.PIPE,
                            stderr=asyncio.subprocess.PIPE
                        )
                        await move_proc.communicate()
                        await asyncio.sleep(0.01)
                else:
                    move_proc = await asyncio.create_subprocess_exec(
                        "ydotool", "mousemove", "--absolute", str(x), str(y),
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE
                    )
                    await move_proc.communicate()
                
                # Small delay to ensure pointer has registered the position change
                await asyncio.sleep(0.05)
                
                # Update last mouse position in window session
                try:
                    from window_session import get_session
                    get_session().update_mouse(x, y)
                except Exception:
                    pass

                # Click the appropriate button code
                btn_map = {"left": "0xC0", "right": "0xC1", "middle": "0xC2"}
                btn_code = btn_map.get(button, "0xC0")
                try:
                    import structlog
                    structlog.get_logger().info("Wayland click (ydotool)", button=button, btn_code=btn_code)
                except Exception:
                    pass
                click_proc = await asyncio.create_subprocess_exec(
                    "ydotool", "click", btn_code,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                await click_proc.communicate()
                if click_proc.returncode == 0:
                    return True
            except Exception:
                pass

        # 2. Fallback: try xdotool
        if shutil.which("xdotool"):
            try:
                proc = await asyncio.create_subprocess_exec(
                    "xdotool", "mousemove", str(x), str(y), "click", "1",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                await proc.communicate()
                if proc.returncode == 0:
                    return True
            except Exception:
                pass
        try:
            import pyautogui
            pyautogui.click(x, y, button=button)
            return True
        except Exception:
            return True

    async def get_window_id(self, title: str) -> Optional[str]:
        if shutil.which("xdotool"):
            try:
                proc = await asyncio.create_subprocess_exec(
                    "xdotool", "search", "--onlyvisible", "--name", title,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                stdout, _ = await proc.communicate()
                ids = stdout.decode().strip().split()
                return ids[0] if ids else None
            except Exception:
                pass
        return None

    async def refocus_window(self, window_id: str) -> bool:
        if shutil.which("xdotool") and window_id:
            try:
                proc = await asyncio.create_subprocess_exec(
                    "xdotool", "windowactivate", "--sync", window_id,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                await proc.communicate()
                return proc.returncode == 0
            except Exception:
                pass
        return True


class PyAutoGUIProvider:
    """Windows desktop automation provider using pyautogui."""
    async def capture_screen(self) -> str:
        import pyautogui
        path = os.path.join(tempfile.gettempdir(), "opensarthi_screen.png")
        screenshot = pyautogui.screenshot()
        screenshot.save(path)
        return path

    async def type_text(self, text: str, window_id: Optional[str] = None) -> bool:
        await asyncio.sleep(0.3)
        import pyautogui
        pyautogui.typewrite(text, interval=0.05) if text.isascii() else pyautogui.write(text)
        return True

    async def press_key(self, key: str, window_id: Optional[str] = None) -> bool:
        import pyautogui
        key_map = {
            "Return": "enter", "Enter": "enter", "Tab": "tab",
            "Escape": "escape", "BackSpace": "backspace",
            "Delete": "delete", "space": "space",
            "Up": "up", "Down": "down", "Left": "left", "Right": "right",
            "super": "win", "Super_L": "win", "Super_R": "win",
            "ctrl+c": ["ctrl", "c"], "ctrl+v": ["ctrl", "v"],
            "ctrl+a": ["ctrl", "a"], "ctrl+z": ["ctrl", "z"],
        }
        mapped = key_map.get(key, key.lower())
        if isinstance(mapped, list):
            pyautogui.hotkey(*mapped)
        else:
            pyautogui.press(mapped)
        return True

    async def click(self, x: int, y: int, button: str = "left", window_id: Optional[str] = None) -> bool:
        import pyautogui
        if SMOOTH_MOUSE:
            try:
                import structlog
                structlog.get_logger().info("Smooth mouse glide (pyautogui)", x=x, y=y, duration=MOUSE_GLIDE_DURATION)
                pyautogui.moveTo(x, y, duration=MOUSE_GLIDE_DURATION)
            except Exception as e:
                import structlog
                structlog.get_logger().warn("Smooth mouse glide failed", error=str(e))
        
        # Update last mouse position in window session
        try:
            from window_session import get_session
            get_session().update_mouse(x, y)
        except Exception:
            pass

        pyautogui.click(x, y, button=button)
        return True

    async def get_window_id(self, title: str) -> Optional[str]:
        return None

    async def refocus_window(self, window_id: str) -> bool:
        return True


class MacOSProvider:
    """macOS desktop automation using osascript (AppleScript) + pyautogui."""

    # Map X11/xdotool key names to AppleScript key names / codes
    _KEY_MAP = {
        "Return": "return", "Enter": "return",
        "Tab": "tab", "Escape": "escape", "escape": "escape",
        "BackSpace": "delete", "Delete": "forwarddelete",
        "space": "space",
        "Up": "up arrow", "Down": "down arrow",
        "Left": "left arrow", "Right": "right arrow",
        "F1": "f1", "F2": "f2", "F3": "f3", "F4": "f4",
        "F5": "f5", "F6": "f6", "F7": "f7", "F8": "f8",
        "F9": "f9", "F10": "f10", "F11": "f11", "F12": "f12",
        "super": "command", "Super_L": "command", "Super_R": "command",
    }

    async def capture_screen(self) -> str:
        path = os.path.join(tempfile.gettempdir(), "opensarthi_screen.png")
        try:
            import pyautogui
            screenshot = pyautogui.screenshot()
            screenshot.save(path)
        except Exception:
            proc = await asyncio.create_subprocess_exec(
                "screencapture", "-x", path,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL
            )
            await proc.communicate()
        return path

    async def type_text(self, text: str, window_id: Optional[str] = None) -> bool:
        await asyncio.sleep(0.2)
        # For long text, use clipboard paste (cmd+v) — faster and handles unicode
        if len(text) > 20:
            try:
                proc = await asyncio.create_subprocess_exec(
                    "pbcopy",
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                await proc.communicate(input=text.encode("utf-8"))
                # Paste with Cmd+V
                paste_script = 'tell application "System Events" to keystroke "v" using command down'
                paste_proc = await asyncio.create_subprocess_exec(
                    "osascript", "-e", paste_script,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                await paste_proc.communicate()
                return paste_proc.returncode == 0
            except Exception:
                pass
        # Short text: keystroke via osascript
        try:
            # Escape double-quotes and backslashes for AppleScript
            escaped = text.replace("\\", "\\\\").replace('"', '\\"')
            script = f'tell application "System Events" to keystroke "{escaped}"'
            proc = await asyncio.create_subprocess_exec(
                "osascript", "-e", script,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            await proc.communicate()
            if proc.returncode == 0:
                return True
        except Exception:
            pass
        # Fallback: pyautogui typewrite
        try:
            import pyautogui
            pyautogui.typewrite(text, interval=0.05) if text.isascii() else None
            return True
        except Exception:
            return False

    async def press_key(self, key: str, window_id: Optional[str] = None) -> bool:
        # Handle combos like ctrl+c -> command+c on macOS
        parts = [p.strip() for p in key.split("+")]
        modifiers = []
        main_key = parts[-1]
        mod_map = {
            "ctrl": "command", "control": "command",
            "cmd": "command", "command": "command",
            "alt": "option", "option": "option",
            "shift": "shift",
            "super": "command",
        }
        for p in parts[:-1]:
            if p.lower() in mod_map:
                modifiers.append(f"{mod_map[p.lower()]} down")
        mapped_key = self._KEY_MAP.get(main_key, main_key.lower())
        try:
            if modifiers:
                using_clause = " using {" + ", ".join(modifiers) + "}"
                script = f'tell application "System Events" to keystroke "{mapped_key}"{using_clause}'
            else:
                # Use key code for special keys without quotes
                special_keys = {"up arrow", "down arrow", "left arrow", "right arrow",
                                "return", "tab", "escape", "delete", "forwarddelete",
                                "space", "f1","f2","f3","f4","f5","f6",
                                "f7","f8","f9","f10","f11","f12"}
                if mapped_key in special_keys:
                    script = f'tell application "System Events" to key code (key code of key "{mapped_key}")'
                    # Simpler: use keystroke for non-arrows, key code for arrows
                    script = f'tell application "System Events" to keystroke (ASCII character {ord(mapped_key[0])})' if len(mapped_key) == 1 else f'tell application "System Events" to key code 36'  # return
                    # Use the pyautogui fallback for special keys
                    raise ValueError("use pyautogui fallback")
                else:
                    script = f'tell application "System Events" to keystroke "{mapped_key}"'
            proc = await asyncio.create_subprocess_exec(
                "osascript", "-e", script,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            await proc.communicate()
            if proc.returncode == 0:
                return True
        except Exception:
            pass
        # Fallback: pyautogui
        try:
            import pyautogui
            pyautogui_key_map = {
                "return": "enter", "tab": "tab", "escape": "escape",
                "delete": "backspace", "forwarddelete": "delete",
                "up arrow": "up", "down arrow": "down",
                "left arrow": "left", "right arrow": "right",
                "space": "space",
                **{f"f{i}": f"f{i}" for i in range(1, 13)},
            }
            pg_key = pyautogui_key_map.get(mapped_key, mapped_key)
            pg_mods = [mod_map.get(p.lower(), p.lower()) for p in parts[:-1]]
            # pyautogui uses 'command', 'option', 'shift'
            pg_mod_map = {"command": "command", "option": "option", "shift": "shift"}
            pg_mods_final = [pg_mod_map.get(m, m) for m in pg_mods]
            if pg_mods_final:
                pyautogui.hotkey(*pg_mods_final, pg_key)
            else:
                pyautogui.press(pg_key)
            return True
        except Exception:
            return False

    async def click(self, x: int, y: int, button: str = "left", window_id: Optional[str] = None) -> bool:
        try:
            from window_session import get_session
            get_session().update_mouse(x, y)
        except Exception:
            pass
        try:
            import pyautogui
            if SMOOTH_MOUSE:
                pyautogui.moveTo(x, y, duration=MOUSE_GLIDE_DURATION)
            pyautogui.click(x, y, button=button)
            return True
        except Exception:
            pass
        # Fallback: osascript click
        try:
            script = f'tell application "System Events" to click at {{{x}, {y}}}'
            proc = await asyncio.create_subprocess_exec(
                "osascript", "-e", script,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            await proc.communicate()
            return proc.returncode == 0
        except Exception:
            return False

    async def get_window_id(self, title: str) -> Optional[str]:
        """On macOS we don't use numeric window IDs; return app name as identifier."""
        try:
            script = 'tell application "System Events" to get name of every process whose visible is true'
            proc = await asyncio.create_subprocess_exec(
                "osascript", "-e", script,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, _ = await proc.communicate()
            apps = stdout.decode().strip().split(", ")
            title_lower = title.lower()
            for app in apps:
                if title_lower in app.lower():
                    return app.strip()
        except Exception:
            pass
        return None

    async def refocus_window(self, window_id: str) -> bool:
        """Activate application by name."""
        if not window_id:
            return True
        try:
            script = f'tell application "{window_id}" to activate'
            proc = await asyncio.create_subprocess_exec(
                "osascript", "-e", script,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            await proc.communicate()
            return proc.returncode == 0
        except Exception:
            return False


# Helper to check display environment and select provider
def get_desktop_provider():
    if platform.system() == "Darwin":
        return MacOSProvider()
    if platform.system() == "Windows":
        return PyAutoGUIProvider()
    wayland_display = os.environ.get("WAYLAND_DISPLAY")
    if wayland_display:
        return YdotoolProvider()
    else:
        return XdotoolProvider()

_provider = get_desktop_provider()


def _get_pinned_window_id() -> Optional[str]:
    """Retrieve the session-pinned window ID."""
    from window_session import get_session
    return get_session().pinned_window_id


async def _ensure_window_focus(window_id: str) -> bool:
    """Ensure the target window is active/focused before executing actions.
        Skip xdotool calls when running on Wayland (YdotoolProvider).
    """
    if not window_id:
        return True
    # Wayland: xdotool getactivewindow is unsupported — skip silently
    if isinstance(_provider, YdotoolProvider):
        return True
    try:
        proc = await asyncio.create_subprocess_exec(
            "xdotool", "getactivewindow",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, _ = await proc.communicate()
        active_id = stdout.decode().strip()
        if active_id == window_id:
            return True

        # Activate window if focus drifted
        proc = await asyncio.create_subprocess_exec(
            "xdotool", "windowactivate", "--sync", window_id,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        await proc.communicate()
        await asyncio.sleep(0.2)
        return proc.returncode == 0
    except Exception:
        return False


class ClickTool(BaseTool):
    name = "click"
    description = "Click at (x, y) coordinates. Automatically re-focuses the pinned task window before clicking."
    risk_level = RiskLevel.MODERATE
    schema = {
        "type": "object",
        "properties": {
            "x": {"type": "number", "description": "X coordinate to click"},
            "y": {"type": "number", "description": "Y coordinate to click"},
            "button": {"type": "string", "enum": ["left", "right", "middle"], "description": "Mouse button (default: left)"},
        },
        "required": ["x", "y"],
    }

    async def execute(self, args: dict, permission_manager=None) -> ToolResult:
        x = args.get("x")
        y = args.get("y")
        button = args.get("button", "left")

        if x is None or y is None:
            return ToolResult.fail("Missing x or y coordinate", retryable=False)

        try:
            window_id = _get_pinned_window_id()
            if window_id:
                await _ensure_window_focus(window_id)
                
            if permission_manager:
                try:
                    await permission_manager.send_message("click_event", {"x": int(x), "y": int(y), "button": button})
                except Exception:
                    pass

            success = await _provider.click(int(x), int(y), button, window_id=window_id)
            if not success:
                return ToolResult.fail("Provider click failed", retryable=True)

            return ToolResult.ok(
                observation=f"Clicked at ({x}, {y}) with {button} button" + (f" in window {window_id}" if window_id else ""),
                confidence=ToolResultConfidence.MEDIUM,
                suggested_next="Observe the desktop to verify the click had the intended effect"
            )
        except Exception as e:
            return ToolResult.fail(str(e), retryable=True)


class TypeTextTool(BaseTool):
    name = "type_text"
    description = (
        "Type text into the active input focus of the pinned window. "
        "IMPORTANT: This does NOT click or focus the specific input field automatically. "
        "You MUST click the input field first, or send the appropriate keyboard shortcut "
        "(like ctrl+l to focus browser address bar, or '/' to focus YouTube search) before using this tool."
    )
    risk_level = RiskLevel.MODERATE
    schema = {
        "type": "object",
        "properties": {
            "text": {"type": "string", "description": "Text to type"},
        },
        "required": ["text"],
    }

    async def execute(self, args: dict) -> ToolResult:
        text = args.get("text", "")
        if not text:
            return ToolResult.fail("No text provided", retryable=False)

        try:
            window_id = _get_pinned_window_id()
            if window_id:
                await _ensure_window_focus(window_id)
            success = await _provider.type_text(text, window_id=window_id)
            if not success:
                return ToolResult.fail("Provider typing failed", retryable=True)

            return ToolResult.ok(
                observation=f"Typed: '{text[:50]}{'...' if len(text) > 50 else ''}'" + (f" into window {window_id}" if window_id else ""),
                confidence=ToolResultConfidence.HIGH
            )
        except Exception as e:
            return ToolResult.fail(str(e))


class PressKeyTool(BaseTool):
    name = "press_key"
    description = "Press a keyboard key in the pinned task window (e.g., 'Return', 'Tab', 'Escape', 'ctrl+c')."
    risk_level = RiskLevel.MODERATE
    schema = {
        "type": "object",
        "properties": {
            "key": {"type": "string", "description": "Key to press, e.g. 'Return', 'Tab', 'Escape', 'ctrl+c'"},
        },
        "required": ["key"],
    }

    async def execute(self, args: dict) -> ToolResult:
        key = args.get("key", "")
        if not key:
            return ToolResult.fail("No key provided", retryable=False)

        try:
            window_id = _get_pinned_window_id()
            if window_id:
                await _ensure_window_focus(window_id)
            success = await _provider.press_key(key, window_id=window_id)
            if not success:
                return ToolResult.fail("Provider press_key failed", retryable=True)

            return ToolResult.ok(
                observation=f"Pressed key: '{key}'" + (f" in window {window_id}" if window_id else ""),
                confidence=ToolResultConfidence.HIGH
            )
        except Exception as e:
            return ToolResult.fail(str(e))


class OpenAppTool(BaseTool):
    name = "open_app"
    description = "Launch a desktop application by name (e.g. 'firefox', 'dolphin', 'konsole'). Aliases like 'file manager' → 'dolphin' are resolved automatically."
    risk_level = RiskLevel.MODERATE
    schema = {
        "type": "object",
        "properties": {
            "app": {"type": "string", "description": "Application name or alias, e.g. 'firefox', 'dolphin', 'file manager', 'vlc'"},
        },
        "required": ["app"],
    }

    async def execute(self, args: dict) -> ToolResult:
        app = (args.get("app") or "").strip()
        if not app:
            return ToolResult.fail("No app name provided", retryable=False)

        # Common app name aliases — LLMs often use display names, not binary names
        ALIASES = {
            # Browsers
            "google-chrome": ["google-chrome-stable --force-renderer-accessibility", "google-chrome --force-renderer-accessibility", "chromium --force-renderer-accessibility", "chromium-browser --force-renderer-accessibility"],
            "chrome": ["google-chrome-stable --force-renderer-accessibility", "google-chrome --force-renderer-accessibility", "chromium --force-renderer-accessibility"],
            "chromium": ["chromium --force-renderer-accessibility", "chromium-browser --force-renderer-accessibility", "google-chrome-stable --force-renderer-accessibility"],
            "firefox": ["firefox", "firefox-esr", "firefox-beta"],
            "brave": ["brave", "brave-browser", "brave-browser-stable"],
            "brave browser": ["brave", "brave-browser", "brave-browser-stable"],
            "edge": ["microsoft-edge", "microsoft-edge-stable", "msedge"],
            "microsoft edge": ["microsoft-edge", "microsoft-edge-stable"],
            # Code editors
            "vscode": ["code", "code-oss", "codium"],
            "vs code": ["code", "code-oss"],
            "visual studio code": ["code", "code-oss"],
            "code": ["code", "code-oss", "codium"],
            "cursor": ["cursor"],
            "zed": ["zed"],
            "codium": ["codium", "vscodium"],
            "vscodium": ["vscodium", "codium"],
            "sublime": ["subl", "sublime_text"],
            "sublime text": ["subl", "sublime_text"],
            "neovide": ["neovide"],
            # Terminals
            "terminal": ["konsole", "gnome-terminal", "xterm", "alacritty", "kitty", "wezterm"],
            "konsole": ["konsole"],
            "alacritty": ["alacritty"],
            "kitty": ["kitty"],
            "wezterm": ["wezterm"],
            # File managers
            "file manager": ["dolphin", "nautilus", "thunar", "nemo"],
            "dolphin": ["dolphin"],
            "nautilus": ["nautilus"],
            "thunar": ["thunar"],
            "nemo": ["nemo"],
            # KDE apps
            "kate": ["kate"],
            "okular": ["okular"],
            "ark": ["ark"],
            "spectacle": ["spectacle"],
            "kcalc": ["kcalc"],
            "gwenview": ["gwenview"],
            "kamoso": ["kamoso"],
            "krunner": ["krunner"],
            # Media
            "vlc": ["vlc"],
            "vlc media player": ["vlc"],
            "mpv": ["mpv"],
            "spotify": ["spotify"],
            "rhythmbox": ["rhythmbox"],
            "kdenlive": ["kdenlive"],
            "obs": ["obs", "obs-studio"],
            "obs studio": ["obs", "obs-studio"],
            # Communication
            "discord": ["discord"],
            "telegram": ["telegram-desktop", "telegram"],
            "slack": ["slack"],
            "zoom": ["zoom"],
            "teams": ["teams", "teams-for-linux"],
            "microsoft teams": ["teams", "teams-for-linux"],
            "signal": ["signal-desktop"],
            "whatsapp": ["whatsapp-for-linux", "whatsapp"],
            "skype": ["skype"],
            # Productivity & notes
            "libreoffice": ["libreoffice", "soffice"],
            "libreoffice writer": ["libreoffice --writer"],
            "libreoffice calc": ["libreoffice --calc"],
            "libreoffice impress": ["libreoffice --impress"],
            "obsidian": ["obsidian"],
            "notion": ["notion-app", "notion"],
            "logseq": ["logseq"],
            "joplin": ["joplin"],
            "marktext": ["marktext"],
            # Design & creative
            "gimp": ["gimp"],
            "inkscape": ["inkscape"],
            "krita": ["krita"],
            "figma": ["figma-linux", "figma"],
            "blender": ["blender"],
            "darktable": ["darktable"],
            # Gaming & misc
            "steam": ["steam"],
            "lutris": ["lutris"],
            "heroic": ["heroic"],
            "garuda-update": ["garuda-update"],
            "garuda": ["garuda-welcome"],
            "timeshift": ["timeshift-gtk", "timeshift"],
            # System tools
            "system monitor": ["gnome-system-monitor", "ksysguard", "plasma-systemmonitor"],
            "task manager": ["gnome-system-monitor", "ksysguard", "plasma-systemmonitor"],
        }

        # Flatpak bundle ID guesses for common apps (used in fallback)
        FLATPAK_IDS = {
            "spotify": "com.spotify.Client",
            "discord": "com.discordapp.Discord",
            "obs": "com.obsproject.Studio",
            "obs studio": "com.obsproject.Studio",
            "vlc": "org.videolan.VLC",
            "obsidian": "md.obsidian.Obsidian",
            "slack": "com.slack.Slack",
            "zoom": "us.zoom.Zoom",
            "figma": "io.github.Figma_linux",
            "blender": "org.blender.Blender",
            "krita": "org.kde.krita",
            "inkscape": "org.inkscape.Inkscape",
            "gimp": "org.gimp.GIMP",
            "steam": "com.valvesoftware.Steam",
            "lutris": "net.lutris.Lutris",
            "signal": "org.signal.Signal",
            "telegram": "org.telegram.desktop",
            "notion": "so.notion.Notion",
            "logseq": "com.logseq.Logseq",
        }

        app_lower = app.lower().strip()
        candidates = ALIASES.get(app_lower, [app])
        if app not in candidates:
            candidates = [app] + candidates

        # Only reset window session when switching to a different app
        from window_session import get_session, reset_session
        current_session = get_session()
        if not current_session.is_pinned or (
            current_session.pinned_window_title and
            app_lower not in (current_session.pinned_window_title or "").lower()
        ):
            reset_session()

        # ── macOS: launch .app bundles with `open -a` ──────────────────────────
        if platform.system() == "Darwin":
            # Map common names → exact macOS .app bundle names
            MAC_APP_NAMES = {
                # Browsers
                "safari": "Safari",
                "chrome": "Google Chrome",
                "google chrome": "Google Chrome",
                "google-chrome": "Google Chrome",
                "firefox": "Firefox",
                "brave": "Brave Browser",
                "brave browser": "Brave Browser",
                "edge": "Microsoft Edge",
                "microsoft edge": "Microsoft Edge",
                "arc": "Arc",
                "opera": "Opera",
                # Editors / IDEs
                "vscode": "Visual Studio Code",
                "vs code": "Visual Studio Code",
                "visual studio code": "Visual Studio Code",
                "code": "Visual Studio Code",
                "cursor": "Cursor",
                "zed": "Zed",
                "xcode": "Xcode",
                "sublime": "Sublime Text",
                "sublime text": "Sublime Text",
                "nova": "Nova",
                "bbedit": "BBEdit",
                "textmate": "TextMate",
                # Terminals
                "terminal": "Terminal",
                "iterm": "iTerm",
                "iterm2": "iTerm",
                "wezterm": "WezTerm",
                "kitty": "kitty",
                "alacritty": "Alacritty",
                "ghostty": "Ghostty",
                # File manager
                "finder": "Finder",
                "file manager": "Finder",
                # Productivity
                "notes": "Notes",
                "pages": "Pages",
                "numbers": "Numbers",
                "keynote": "Keynote",
                "calendar": "Calendar",
                "reminders": "Reminders",
                "mail": "Mail",
                "messages": "Messages",
                "facetime": "FaceTime",
                "maps": "Maps",
                "photos": "Photos",
                "preview": "Preview",
                "quicktime": "QuickTime Player",
                "quicktime player": "QuickTime Player",
                "music": "Music",
                "podcasts": "Podcasts",
                "tv": "TV",
                "books": "Books",
                "app store": "App Store",
                "system preferences": "System Preferences",
                "system settings": "System Settings",
                "activity monitor": "Activity Monitor",
                "task manager": "Activity Monitor",
                "system monitor": "Activity Monitor",
                "disk utility": "Disk Utility",
                "terminal": "Terminal",
                "calculator": "Calculator",
                "textedit": "TextEdit",
                "automator": "Automator",
                "script editor": "Script Editor",
                # Communication
                "slack": "Slack",
                "discord": "Discord",
                "zoom": "Zoom",
                "teams": "Microsoft Teams",
                "microsoft teams": "Microsoft Teams",
                "telegram": "Telegram",
                "signal": "Signal",
                "whatsapp": "WhatsApp",
                "skype": "Skype",
                # Media / Creative
                "vlc": "VLC",
                "vlc media player": "VLC",
                "spotify": "Spotify",
                "obs": "OBS",
                "obs studio": "OBS",
                "final cut": "Final Cut Pro",
                "final cut pro": "Final Cut Pro",
                "logic pro": "Logic Pro",
                "garageband": "GarageBand",
                "garage band": "GarageBand",
                "gimp": "GIMP",
                "inkscape": "Inkscape",
                "blender": "Blender",
                "figma": "Figma",
                "sketch": "Sketch",
                "affinity designer": "Affinity Designer",
                "affinity photo": "Affinity Photo",
                "affinity publisher": "Affinity Publisher",
                "pixelmator": "Pixelmator Pro",
                # Dev tools
                "docker": "Docker",
                "tableplus": "TablePlus",
                "sequel pro": "Sequel Pro",
                "postman": "Postman",
                "insomnia": "Insomnia",
                "proxyman": "Proxyman",
                "simulator": "Simulator",
                # Notes
                "obsidian": "Obsidian",
                "notion": "Notion",
                "logseq": "Logseq",
                "bear": "Bear",
                "craft": "Craft",
                "ulysses": "Ulysses",
                "devonthink": "DEVONthink 3",
                # Other
                "1password": "1Password 7 - Password Manager",
                "bitwarden": "Bitwarden",
                "raycast": "Raycast",
                "alfred": "Alfred",
                "bartender": "Bartender 4",
                "cleanmymac": "CleanMyMac X",
            }
            mac_app_name = MAC_APP_NAMES.get(app_lower, app)
            try:
                proc = await asyncio.create_subprocess_exec(
                    "open", "-a", mac_app_name,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.PIPE,
                )
                _, stderr_bytes = await proc.communicate()
                if proc.returncode == 0:
                    return ToolResult.ok(
                        observation=f"Launched '{mac_app_name}' on macOS",
                        confidence=ToolResultConfidence.MEDIUM,
                        suggested_next="Use wait_for_window to confirm it opened"
                    )
            except Exception:
                pass
            # Also try with the original user-supplied name (may already be exact bundle name)
            if mac_app_name != app:
                try:
                    proc = await asyncio.create_subprocess_exec(
                        "open", "-a", app,
                        stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.PIPE,
                    )
                    _, _ = await proc.communicate()
                    if proc.returncode == 0:
                        return ToolResult.ok(
                            observation=f"Launched '{app}' on macOS",
                            confidence=ToolResultConfidence.MEDIUM,
                            suggested_next="Use wait_for_window to confirm it opened"
                        )
                except Exception:
                    pass
            # Fallback: try as CLI binary (Homebrew tools) — fall through to binary search below


        tried = []
        for binary in candidates:
            # Handle binaries with args (e.g. "libreoffice --writer")
            parts = binary.split()
            binary_name = parts[0]
            binary_args = parts[1:]
            if shutil.which(binary_name):
                try:
                    cmd = [binary_name] + binary_args
                    await asyncio.create_subprocess_exec(
                        *cmd,
                        stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.DEVNULL
                    )
                    # Don't wait — app launches in background
                    return ToolResult.ok(
                        observation=f"Launched '{binary}'",
                        confidence=ToolResultConfidence.MEDIUM,
                        suggested_next=f"Use wait_for_window to confirm it opened and pin the window"
                    )
                except FileNotFoundError:
                    tried.append(binary)
                    continue
                except Exception as e:
                    return ToolResult.fail(str(e))
            tried.append(binary)

        # Stage 1: Try gtk-launch with <app-name>.desktop
        if shutil.which("gtk-launch"):
            desktop_name = app_lower.replace(" ", "-")
            for suffix in [desktop_name, app_lower.replace(" ", ""), app]:
                try:
                    proc = await asyncio.create_subprocess_exec(
                        "gtk-launch", f"{suffix}.desktop",
                        stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.PIPE,
                    )
                    _, stderr_out = await proc.communicate()
                    if proc.returncode == 0:
                        return ToolResult.ok(
                            observation=f"Launched '{app}' via gtk-launch",
                            confidence=ToolResultConfidence.MEDIUM,
                            suggested_next="Use wait_for_window to confirm it opened",
                        )
                except Exception:
                    pass

        # Stage 2: Try flatpak run with known bundle ID
        if shutil.which("flatpak"):
            flatpak_id = FLATPAK_IDS.get(app_lower)
            if flatpak_id:
                try:
                    await asyncio.create_subprocess_exec(
                        "flatpak", "run", flatpak_id,
                        stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.DEVNULL,
                    )
                    return ToolResult.ok(
                        observation=f"Launched '{app}' via Flatpak ({flatpak_id})",
                        confidence=ToolResultConfidence.MEDIUM,
                        suggested_next="Use wait_for_window to confirm it opened",
                    )
                except Exception:
                    pass

        # Stage 3: xdg-open fallback (opens associated app for an app URI)
        if shutil.which("xdg-open"):
            try:
                await asyncio.create_subprocess_exec(
                    "xdg-open", app,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                return ToolResult.ok(
                    observation=f"Attempted to open '{app}' via xdg-open",
                    confidence=ToolResultConfidence.LOW,
                    suggested_next="Use observe_desktop to verify what opened",
                )
            except Exception:
                pass

        return ToolResult.fail(
            f"App '{app}' not found. Tried binaries: {tried}. "
            "Also tried gtk-launch, flatpak, and xdg-open fallbacks. "
            "Verify the app is installed with 'which <appname>' or 'flatpak list'.",
            retryable=False
        )



class FocusWindowTool(BaseTool):
    name = "focus_window"
    description = "Bring a window to the foreground by its title and pin it as the target for future type/click actions."
    risk_level = RiskLevel.MODERATE
    schema = {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Window title substring to search for"},
        },
        "required": ["title"],
    }

    async def execute(self, args: dict) -> ToolResult:
        title = (args.get("title") or "").strip()
        if not title:
            return ToolResult.fail("No window title provided", retryable=False)

        window_id = None

        # 1. Try wmctrl -a
        if shutil.which("wmctrl"):
            try:
                proc = await asyncio.create_subprocess_exec(
                    "wmctrl", "-a", title,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                await proc.communicate()
                if proc.returncode == 0:
                    # Also get window ID for pinning
                    if hasattr(_provider, "get_window_id"):
                        window_id = await _provider.get_window_id(title)
                    if window_id:
                        from window_session import get_session
                        get_session().pin(window_id, title)
                    return ToolResult.ok(
                        observation=f"Focused and pinned window '{title}'" + (f" (ID: {window_id})" if window_id else ""),
                        confidence=ToolResultConfidence.HIGH
                    )
            except Exception:
                pass

        # 2. Try xdotool windowactivate
        if shutil.which("xdotool"):
            try:
                proc = await asyncio.create_subprocess_exec(
                    "xdotool", "search", "--onlyvisible", "--name", title,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                stdout, _ = await proc.communicate()
                window_ids = stdout.decode().strip().split()
                if window_ids:
                    window_id = window_ids[0]
                    proc = await asyncio.create_subprocess_exec(
                        "xdotool", "windowactivate", "--sync", window_id,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE
                    )
                    await proc.communicate()
                    if proc.returncode == 0:
                        from window_session import get_session
                        get_session().pin(window_id, title)
                        return ToolResult.ok(
                            observation=f"Focused and pinned window '{title}' (ID: {window_id})",
                            confidence=ToolResultConfidence.HIGH
                        )
            except Exception as e:
                return ToolResult.fail(f"Failed to focus window: {e}", retryable=True)

        return ToolResult.fail(
            f"Could not focus window with title '{title}'. Make sure the window is open and wmctrl/xdotool is installed.",
            retryable=True
        )


class ClickElementTool(BaseTool):
    name = "click_element"
    description = (
        "Click a UI element by its accessibility role and name. More reliable than coordinate clicking. "
        "Use role='push button' name='OK' or role='list item' name='Music'. "
        "Call observe_desktop first to see what elements are available."
    )
    risk_level = RiskLevel.MODERATE
    schema = {
        "type": "object",
        "properties": {
            "role": {"type": "string", "description": "AT-SPI role, e.g. 'push button', 'list item', 'menu item', 'check box'"},
            "name": {"type": "string", "description": "Visible element label or text, e.g. 'OK', 'Music', 'Play'"},
        },
        # Require at least name to prevent zero-arg LLM calls
        "required": ["name"],
    }

    async def execute(self, args: dict, permission_manager=None) -> ToolResult:
        if platform.system() == "Darwin":
            from providers.macos.accessibility import AccessibilityProvider
        else:
            from providers.linux.accessibility import AccessibilityProvider
        role = args.get("role", "")
        name = args.get("name", "")

        if not role and not name:
            return ToolResult.fail("Provide at least one of: role, name", retryable=False)

        provider = AccessibilityProvider()
        elements = []
        if provider.available:
            try:
                elements = provider.find_elements(
                    role=role or None,
                    name=name or None,
                    name_contains=name or None,
                    max_results=5
                )
            except Exception:
                pass

        if not elements and name:
            # Fallback to OCR text detection and clicking
            try:
                from PIL import Image
                import io
                import pytesseract
                from observer.screen import capture_screenshot
                
                screenshot_bytes = await capture_screenshot()
                if screenshot_bytes:
                    img = Image.open(io.BytesIO(screenshot_bytes))
                    data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
                    
                    query = name.lower().strip()
                    words = []
                    n = len(data['text'])
                    for i in range(n):
                        text_val = str(data['text'][i]).strip()
                        if text_val:
                            words.append({
                                'text': text_val.lower(),
                                'left': data['left'][i],
                                'top': data['top'][i],
                                'width': data['width'][i],
                                'height': data['height'][i],
                                'line': (data.get('page_num', [0])[i], data.get('block_num', [0])[i], data.get('par_num', [0])[i], data.get('line_num', [0])[i])
                            })
                    
                    lines = {}
                    for w in words:
                        line_id = w['line']
                        if line_id not in lines:
                            lines[line_id] = []
                        lines[line_id].append(w)
                        
                    ocr_center = None
                    for line_id, line_words in lines.items():
                        line_text = " ".join([w['text'] for w in line_words])
                        if query in line_text:
                            best_range = None
                            min_len = float('inf')
                            for i in range(len(line_words)):
                                for j in range(i, len(line_words)):
                                    sub_text = " ".join([line_words[k]['text'] for k in range(i, j+1)])
                                    if query in sub_text:
                                        if (j - i) < min_len:
                                            min_len = j - i
                                            best_range = (i, j)
                                        break
                            if best_range:
                                i, j = best_range
                                matching_words = line_words[i:j+1]
                                min_x = min(w['left'] for w in matching_words)
                                min_y = min(w['top'] for w in matching_words)
                                max_x = max(w['left'] + w['width'] for w in matching_words)
                                max_y = max(w['top'] + w['height'] for w in matching_words)
                                ocr_center = ((min_x + max_x) // 2, (min_y + max_y) // 2)
                                break
                    
                    if ocr_center:
                        x, y = ocr_center
                        window_id = _get_pinned_window_id()
                        if window_id:
                            await _ensure_window_focus(window_id)
                            
                        if permission_manager:
                            try:
                                await permission_manager.send_message("click_event", {"x": int(x), "y": int(y), "button": "left"})
                            except Exception:
                                pass

                        success = await _provider.click(x, y, button="left")
                        if success:
                            return ToolResult.ok(
                                observation=f"Clicked OCR-detected text '{name}' at ({x}, {y})",
                                confidence=ToolResultConfidence.HIGH,
                                ui_changed=True
                            )
            except Exception:
                pass

        if not elements:
            if not provider.available:
                return ToolResult.fail(
                    f"AT-SPI not available and text '{name}' not found via OCR",
                    retryable=False
                )
            return ToolResult.fail(
                f"No element found via AT-SPI or OCR: role={role!r} name={name!r}",
                retryable=True,
                suggested_next="Try a coordinate click or check element names with observe_desktop"
            )

        target = elements[0]
        cx, cy = target.center
        
        if permission_manager:
            try:
                await permission_manager.send_message("click_event", {"x": int(cx), "y": int(cy), "button": "left"})
            except Exception:
                pass

        success = await _provider.click(cx, cy, button="left")

        if success:
            return ToolResult.ok(
                observation=f"Clicked [{target.role}] '{target.name}' at {target.center}",
                confidence=ToolResultConfidence.HIGH,
                ui_changed=True
            )
        else:
            return ToolResult.fail("Provider click failed", retryable=True)


class ObserveDesktopTool(BaseTool):
    """Get current desktop state: open windows, active window, focused element."""
    name = "observe_desktop"
    description = (
        "Inspect the current desktop: open windows, active window title, focused AT-SPI element. "
        "Always call this before click_element when unsure of element names or roles."
    )
    risk_level = RiskLevel.SAFE
    schema = {
        "type": "object",
        "properties": {},
        "required": [],
    }

    async def execute(self, args: dict) -> ToolResult:
        lines = []

        # Get open windows via wmctrl
        if shutil.which("wmctrl"):
            try:
                proc = await asyncio.create_subprocess_exec(
                    "wmctrl", "-l",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                stdout, _ = await proc.communicate()
                windows = stdout.decode().strip().split("\n")
                if windows and windows[0]:
                    lines.append("OPEN WINDOWS:")
                    for w in windows[:15]:
                        lines.append(f"  {w}")
            except Exception:
                pass

        # Get active window via xdotool
        if shutil.which("xdotool"):
            try:
                proc = await asyncio.create_subprocess_exec(
                    "xdotool", "getactivewindow", "getwindowname",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                stdout, _ = await proc.communicate()
                active = stdout.decode().strip()
                if active:
                    lines.append(f"\nACTIVE WINDOW: {active}")

                # Also get active window ID for pinning hint
                proc2 = await asyncio.create_subprocess_exec(
                    "xdotool", "getactivewindow",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                stdout2, _ = await proc2.communicate()
                wid = stdout2.decode().strip()
                if wid:
                    lines.append(f"ACTIVE WINDOW ID: {wid}")
            except Exception:
                pass

        # Get focused element via platform accessibility provider
        try:
            if platform.system() == "Darwin":
                from providers.macos.accessibility import AccessibilityProvider
            else:
                from providers.linux.accessibility import AccessibilityProvider
            a11y = AccessibilityProvider()
            if a11y.available:
                focused = a11y.get_focused_element()
                if focused:
                    lines.append(f"\nFOCUSED ELEMENT: [{focused.role}] '{focused.name}'")
        except Exception:
            pass

        # Current pinned window
        from window_session import get_session
        sess = get_session()
        if sess.is_pinned:
            lines.append(f"\nCURRENTLY PINNED WINDOW: '{sess.pinned_window_title}' (ID: {sess.pinned_window_id})")

        if not lines:
            return ToolResult.fail("Could not observe desktop state", retryable=True)

        return ToolResult.ok(
            observation="\n".join(lines),
            confidence=ToolResultConfidence.HIGH
        )
