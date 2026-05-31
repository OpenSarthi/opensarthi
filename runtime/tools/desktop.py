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

    async def type_text(self, text: str) -> bool:
        await asyncio.sleep(0.3)
        proc = await asyncio.create_subprocess_exec(
            "xdotool", "type", "--clearmodifiers", "--delay", "50", text,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        await proc.communicate()
        return proc.returncode == 0

    async def press_key(self, key: str) -> bool:
        proc = await asyncio.create_subprocess_exec(
            "xdotool", "key", key,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        await proc.communicate()
        return proc.returncode == 0

    async def click(self, x: int, y: int, button: str = "left") -> bool:
        btn_map = {"left": "1", "middle": "2", "right": "3"}
        proc = await asyncio.create_subprocess_exec(
            "xdotool", "mousemove", str(x), str(y), "click", btn_map.get(button, "1"),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        await proc.communicate()
        return proc.returncode == 0

class YdotoolProvider:
    async def capture_screen(self) -> str:
        return os.path.join(tempfile.gettempdir(), "opensarthi_screen.png")

    async def type_text(self, text: str) -> bool:
        await asyncio.sleep(0.3)
        proc = await asyncio.create_subprocess_exec(
            "ydotool", "type", text,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        await proc.communicate()
        return proc.returncode == 0

    async def press_key(self, key: str) -> bool:
        proc = await asyncio.create_subprocess_exec(
            "ydotool", "key", key,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        await proc.communicate()
        return proc.returncode == 0

    async def click(self, x: int, y: int, button: str = "left") -> bool:
        return True


class PyAutoGUIProvider:
    """Windows desktop automation provider using pyautogui."""
    async def capture_screen(self) -> str:
        import pyautogui
        path = os.path.join(tempfile.gettempdir(), "opensarthi_screen.png")
        screenshot = pyautogui.screenshot()
        screenshot.save(path)
        return path

    async def type_text(self, text: str) -> bool:
        await asyncio.sleep(0.3)
        import pyautogui
        pyautogui.typewrite(text, interval=0.05) if text.isascii() else pyautogui.write(text)
        return True

    async def press_key(self, key: str) -> bool:
        import pyautogui
        # Map common key names to pyautogui key names
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

    async def click(self, x: int, y: int, button: str = "left") -> bool:
        import pyautogui
        pyautogui.click(x, y, button=button)
        return True


# Helper to check display environment and select provider
def get_desktop_provider() -> DesktopProvider:
    if platform.system() == "Windows":
        return PyAutoGUIProvider()
    wayland_display = os.environ.get("WAYLAND_DISPLAY")
    if wayland_display:
        return YdotoolProvider()
    else:
        return XdotoolProvider()

_provider = get_desktop_provider()

class ClickTool(BaseTool):
    name = "click"
    description = "Click at (x, y) coordinates. Args: x (number), y (number), button (string, optional: 'left', 'right', 'middle', default 'left')"
    risk_level = RiskLevel.MODERATE

    async def execute(self, args: dict) -> ToolResult:
        x = args.get("x")
        y = args.get("y")
        button = args.get("button", "left")

        if x is None or y is None:
            return ToolResult.fail("Missing x or y coordinate", retryable=False)

        try:
            success = await _provider.click(int(x), int(y), button)
            if not success:
                return ToolResult.fail("Provider click failed", retryable=True)

            return ToolResult.ok(
                observation=f"Clicked at ({x}, {y}) with {button} button",
                confidence=ToolResultConfidence.MEDIUM,
                suggested_next="Observe the desktop to verify the click had the intended effect"
            )
        except Exception as e:
            return ToolResult.fail(str(e), retryable=True)


class TypeTextTool(BaseTool):
    name = "type_text"
    description = "Type text into the currently focused window/input. Args: text (string)"
    risk_level = RiskLevel.MODERATE

    async def execute(self, args: dict) -> ToolResult:
        text = args.get("text", "")
        if not text:
            return ToolResult.fail("No text provided", retryable=False)

        try:
            success = await _provider.type_text(text)
            if not success:
                return ToolResult.fail("Provider typing failed", retryable=True)

            return ToolResult.ok(
                observation=f"Typed: '{text[:50]}{'...' if len(text) > 50 else ''}'",
                confidence=ToolResultConfidence.HIGH
            )
        except Exception as e:
            return ToolResult.fail(str(e))


class PressKeyTool(BaseTool):
    name = "press_key"
    description = "Presses a specific keyboard key (e.g., 'Return', 'Enter', 'Tab', 'Escape'). Args: key (string)"
    risk_level = RiskLevel.MODERATE

    async def execute(self, args: dict) -> ToolResult:
        key = args.get("key", "")
        if not key:
            return ToolResult.fail("No key provided", retryable=False)

        try:
            success = await _provider.press_key(key)
            if not success:
                return ToolResult.fail("Provider press_key failed", retryable=True)

            return ToolResult.ok(
                observation=f"Pressed key: '{key}'",
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
        # Also always try the original app name first
        if app not in candidates:
            candidates = [app] + candidates

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
                        suggested_next=f"Use wait_for_window to confirm it opened"
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
    description = "Focus/bring a window to the foreground by its title. Args: title (string)"
    risk_level = RiskLevel.MODERATE

    async def execute(self, args: dict) -> ToolResult:
        title = args.get("title", "").strip()
        if not title:
            return ToolResult.fail("No window title provided", retryable=False)

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
                    return ToolResult.ok(observation=f"Focused window matching title '{title}' using wmctrl")
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
                    proc = await asyncio.create_subprocess_exec(
                        "xdotool", "windowactivate", window_ids[0],
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE
                    )
                    await proc.communicate()
                    if proc.returncode == 0:
                        return ToolResult.ok(observation=f"Focused window matching title '{title}' using xdotool")
            except Exception as e:
                return ToolResult.fail(f"Failed to focus window: {e}", retryable=True)

        return ToolResult.fail(
            f"Could not focus window with title '{title}'. Make sure the window is open and wmctrl/xdotool is installed.",
            retryable=True
        )


class ClickElementTool(BaseTool):
    name = "click_element"
    description = (
        "Click a UI element by its role and name using AT-SPI. "
        "More reliable than coordinate clicking. "
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
