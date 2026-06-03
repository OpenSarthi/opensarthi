import os
import asyncio
import subprocess
import shutil
import platform
import tempfile
from typing import Protocol, Optional
from tools.base import BaseTool, RiskLevel
from planner.schemas import ToolResult, ToolResultConfidence

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
        cmd = ["xdotool"]
        if window_id:
            # Focus the pinned window first, then type into it by window ID
            cmd += ["type", "--window", window_id, "--clearmodifiers", "--delay", "50", text]
        else:
            cmd += ["type", "--clearmodifiers", "--delay", "50", text]
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
        proc = await asyncio.create_subprocess_exec(
            "ydotool", "type", text,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        await proc.communicate()
        return proc.returncode == 0

    async def press_key(self, key: str, window_id: Optional[str] = None) -> bool:
        proc = await asyncio.create_subprocess_exec(
            "ydotool", "key", key,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        await proc.communicate()
        return proc.returncode == 0

    async def click(self, x: int, y: int, button: str = "left", window_id: Optional[str] = None) -> bool:
        return True

    async def get_window_id(self, title: str) -> Optional[str]:
        return None  # Wayland does not expose window IDs the same way

    async def refocus_window(self, window_id: str) -> bool:
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
        pyautogui.click(x, y, button=button)
        return True

    async def get_window_id(self, title: str) -> Optional[str]:
        return None

    async def refocus_window(self, window_id: str) -> bool:
        return True


# Helper to check display environment and select provider
def get_desktop_provider():
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
    """Ensure the target window is active/focused before executing actions."""
    if not window_id:
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
    description = "Click at (x, y) coordinates. Automatically re-focuses the pinned task window before clicking. Args: x (number), y (number), button (string, optional: 'left', 'right', 'middle', default 'left')"
    risk_level = RiskLevel.MODERATE

    async def execute(self, args: dict) -> ToolResult:
        x = args.get("x")
        y = args.get("y")
        button = args.get("button", "left")

        if x is None or y is None:
            return ToolResult.fail("Missing x or y coordinate", retryable=False)

        try:
            window_id = _get_pinned_window_id()
            if window_id:
                await _ensure_window_focus(window_id)
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
    description = "Type text into the currently pinned task window. Automatically re-focuses the target window before typing so user focus-changes do not interfere. Args: text (string)"
    risk_level = RiskLevel.MODERATE

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
    description = "Presses a specific keyboard key in the pinned task window (e.g., 'Return', 'Enter', 'Tab', 'Escape'). Args: key (string)"
    risk_level = RiskLevel.MODERATE

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
    description = "Open an application by name (e.g. 'firefox', 'konsole', 'dolphin'). Args: app (string)"
    risk_level = RiskLevel.MODERATE

    async def execute(self, args: dict) -> ToolResult:
        app = args.get("app", "").strip()
        if not app:
            return ToolResult.fail("No app name provided", retryable=False)

        # Common app name aliases — LLMs often use display names, not binary names
        ALIASES = {
            "google-chrome": ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser"],
            "chrome": ["google-chrome-stable", "google-chrome", "chromium"],
            "chromium": ["chromium", "chromium-browser", "google-chrome-stable"],
            "firefox": ["firefox", "firefox-esr", "firefox-beta"],
            "vscode": ["code", "code-oss", "codium"],
            "vs code": ["code", "code-oss"],
            "visual studio code": ["code", "code-oss"],
            "terminal": ["konsole", "gnome-terminal", "xterm", "alacritty", "kitty"],
            "file manager": ["dolphin", "nautilus", "thunar"],
            "dolphin": ["dolphin"],
            "konsole": ["konsole"],
            "kate": ["kate"],
            "vlc": ["vlc"],
            "spotify": ["spotify"],
            "discord": ["discord"],
            "telegram": ["telegram-desktop", "telegram"],
            "slack": ["slack"],
            "zoom": ["zoom"],
            "libreoffice": ["libreoffice", "soffice"],
            "gimp": ["gimp"],
            "inkscape": ["inkscape"],
            "obs": ["obs", "obs-studio"],
            "steam": ["steam"],
            "garuda-update": ["garuda-update"],
            "garuda": ["garuda-welcome"],
        }

        app_lower = app.lower().strip()
        candidates = ALIASES.get(app_lower, [app])
        if app not in candidates:
            candidates = [app] + candidates

        # Reset window session when opening a new app — new task target
        from window_session import reset_session
        reset_session()

        tried = []
        for binary in candidates:
            if shutil.which(binary):
                try:
                    proc = await asyncio.create_subprocess_exec(
                        binary,
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

        return ToolResult.fail(
            f"App '{app}' not found. Tried: {tried}. Check if it's installed.",
            retryable=False
        )


class FocusWindowTool(BaseTool):
    name = "focus_window"
    description = "Focus/bring a window to the foreground by its title and pin it as the target for future type/click actions. Args: title (string)"
    risk_level = RiskLevel.MODERATE

    async def execute(self, args: dict) -> ToolResult:
        title = args.get("title", "").strip()
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
        "Click a UI element by its role and name using AT-SPI accessibility tree. "
        "More reliable than coordinate clicking — works regardless of window position. "
        "Args: role (string), name (string)"
    )
    risk_level = RiskLevel.MODERATE

    async def execute(self, args: dict) -> ToolResult:
        from providers.linux.accessibility import AccessibilityProvider
        role = args.get("role", "")
        name = args.get("name", "")

        if not role and not name:
            return ToolResult.fail("Provide at least one of: role, name", retryable=False)

        provider = AccessibilityProvider()
        if not provider.available:
            return ToolResult.fail(
                "AT-SPI not available — use coordinate click instead",
                retryable=False
            )

        elements = provider.find_elements(
            role=role or None,
            name=name or None,
            name_contains=name or None,
            max_results=5
        )

        if not elements:
            return ToolResult.fail(
                f"No element found: role={role!r} name={name!r}",
                retryable=True,
                suggested_next="Try a coordinate click or check element names with observe_desktop"
            )

        target = elements[0]
        success = provider.click_element(target)

        if success:
            return ToolResult.ok(
                observation=f"Clicked [{target.role}] '{target.name}' at {target.center}",
                confidence=ToolResultConfidence.HIGH,
                ui_changed=True
            )
        else:
            return ToolResult.fail("xdotool click failed", retryable=True)


class ObserveDesktopTool(BaseTool):
    """Get current desktop state: open windows, active window, focused element."""
    name = "observe_desktop"
    description = (
        "Observe the current desktop state: list of open windows, active window title, "
        "focused element role and name. Use this when you are unsure about the current state "
        "before taking action. Args: (none)"
    )
    risk_level = RiskLevel.SAFE

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

        # Get AT-SPI focused element
        try:
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
