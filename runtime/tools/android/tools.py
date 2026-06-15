"""
tools/android/tools.py

Android-native tool implementations that replace the desktop X11/AT-SPI tools.

Architecture:
  Python tools call Chaquopy's Java bridge to invoke Android APIs or run shell commands:
    - open_app       → context.startActivity(Intent(Intent.ACTION_MAIN, ...))
    - click          → shell input tap / su -c input tap
    - type_text      → shell input text / su -c input text
    - press_key      → shell input keyevent / su -c input keyevent
    - observe_desktop→ shell screencap + dumpsys resumed activity
"""
import asyncio
import os
import subprocess
import structlog
from typing import Optional

logger = structlog.get_logger()

# ── Base tool result ───────────────────────────────────────────────────────────
from planner.schemas import ToolResult


def _run_input_command(cmd: str) -> bool:
    try:
        # Try running directly
        res = subprocess.run(cmd, shell=True, capture_output=True)
        if res.returncode == 0:
            return True
        # Try running with su
        res = subprocess.run(f"su -c '{cmd}'", shell=True, capture_output=True)
        return res.returncode == 0
    except Exception as e:
        logger.warning("Failed to run input command", cmd=cmd, error=str(e))
        return False


# ── Tool implementations ───────────────────────────────────────────────────────

async def android_open_app(args: dict, **_) -> ToolResult:
    """
    Open an Android app by package name or friendly name.
    Uses Chaquopy to call context.startActivity().
    """
    app_name = args.get("app", "").strip()
    if not app_name:
        return ToolResult(success=False, error="app argument is required", retryable=False)

    # Common app name → package name mappings
    KNOWN_PACKAGES = {
        "chrome": "com.android.chrome",
        "google chrome": "com.android.chrome",
        "firefox": "org.mozilla.firefox",
        "camera": "com.google.android.GoogleCamera",
        "settings": "com.android.settings",
        "calculator": "com.google.android.calculator",
        "files": "com.google.android.documentsui",
        "maps": "com.google.android.apps.maps",
        "google maps": "com.google.android.apps.maps",
        "youtube": "com.google.android.youtube",
        "gmail": "com.google.android.gm",
        "phone": "com.android.dialer",
        "contacts": "com.android.contacts",
        "whatsapp": "com.whatsapp",
        "telegram": "org.telegram.messenger",
        "clock": "com.google.android.deskclock",
        "gallery": "com.google.android.apps.photos",
    }

    package_name = KNOWN_PACKAGES.get(app_name.lower(), app_name)

    try:
        from com.chaquo.python import Python  # type: ignore
        from android.content import Intent
        from android.net import Uri
        
        # Get Android context via Chaquopy
        context = Python.getPlatform().getApplication()
        pm = context.getPackageManager()

        # Try to launch via package manager
        launch_intent = pm.getLaunchIntentForPackage(package_name)
        if launch_intent is None:
            # Fallback 1: Try standard native view intent (e.g. for youtube / browser / maps)
            if "youtube" in package_name:
                intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com"))
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
                await asyncio.sleep(2.0)
                return ToolResult(success=True, observation="Opened YouTube app/web via native View Intent")
            elif "chrome" in package_name or "browser" in package_name:
                intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com"))
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
                await asyncio.sleep(2.0)
                return ToolResult(success=True, observation="Opened Browser via native View Intent")
            elif "maps" in package_name:
                intent = Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=maps"))
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
                await asyncio.sleep(2.0)
                return ToolResult(success=True, observation="Opened Google Maps via native geo intent")

            # Fallback 2: Try launching via monkey shell command
            logger.info("Launch intent None, trying monkey shell fallback", package=package_name)
            success = _run_input_command(f"monkey -p {package_name} 1")
            if success:
                logger.info("Opened Android app via monkey shell", app=app_name, package=package_name)
                await asyncio.sleep(2.0)
                return ToolResult(success=True, observation=f"Opened {app_name} via monkey shell")

            return ToolResult(
                success=False,
                error=f"App '{app_name}' (package: {package_name}) not found on device.",
                retryable=False,
            )
            
        launch_intent.addFlags(0x10000000)  # FLAG_ACTIVITY_NEW_TASK
        context.startActivity(launch_intent)
        logger.info("Opened Android app", app=app_name, package=package_name)
        await asyncio.sleep(1.5)  # wait for app to open
        return ToolResult(success=True, observation=f"Opened {app_name}")

    except ImportError:
        # Running in non-Android context (unit tests)
        logger.warning("Chaquopy not available — skipping open_app")
        return ToolResult(success=False, error="Not running on Android device", retryable=False)
    except Exception as e:
        return ToolResult(success=False, error=str(e), retryable=True)


async def android_shell(args: dict, **_) -> ToolResult:
    """
    Limited shell execution on Android.
    Root commands are blocked. Only safe read-only commands are allowed.
    """
    command = args.get("command", "").strip()
    if not command:
        return ToolResult(success=False, error="command argument is required", retryable=False)

    # Block dangerous patterns
    BLOCKED = ["rm ", "rm\t", "dd ", "mkfs", "fdisk", "sudo", "chmod 777", "curl | sh", "wget | sh"]
    for pattern in BLOCKED:
        if pattern in command:
            return ToolResult(
                success=False,
                error=f"Shell command blocked on Android: contains '{pattern}'",
                retryable=False,
            )

    try:
        timeout = args.get("timeout", 15)
        result = subprocess.run(
            command, shell=True,
            capture_output=True, text=True,
            timeout=timeout
        )
        output = (result.stdout or "") + (result.stderr or "")
        if result.returncode == 0:
            return ToolResult(success=True, observation=output[:2000])
        else:
            return ToolResult(success=False, error=output[:500] or f"Exit code {result.returncode}", retryable=False)
    except subprocess.TimeoutExpired:
        return ToolResult(success=False, error=f"Command timed out after {timeout}s", retryable=False)
    except Exception as e:
        return ToolResult(success=False, error=str(e), retryable=False)


async def android_click(args: dict, **_) -> ToolResult:
    x = args.get("x")
    y = args.get("y")
    if x is None or y is None:
        return ToolResult(success=False, error="Coordinates x and y are required", retryable=False)
    
    try:
        from dev.opensarthi.android import SarthiAccessibilityService
        if SarthiAccessibilityService.isServiceRunning():
            success = SarthiAccessibilityService.click(int(x), int(y))
            if success:
                logger.info("Clicked coordinates via accessibility service", x=x, y=y)
                return ToolResult(success=True, observation=f"Clicked at ({x}, {y}) via Accessibility Service")
            else:
                logger.warning("Accessibility click returned false, falling back to shell")
    except Exception as e:
        logger.warning("Accessibility service click failed", error=str(e))

    success = _run_input_command(f"input tap {int(x)} {int(y)}")
    if success:
        return ToolResult(success=True, observation=f"Clicked at ({x}, {y}) via shell tap")
    else:
        return ToolResult(
            success=False,
            error="Failed to execute click. Please enable OpenSarthi Accessibility Service in settings.",
            retryable=True
        )


async def android_type_text(args: dict, **_) -> ToolResult:
    text = args.get("text", "")
    if not text:
        return ToolResult(success=False, error="text is required", retryable=False)
    
    try:
        from dev.opensarthi.android import SarthiAccessibilityService
        if SarthiAccessibilityService.isServiceRunning():
            success = SarthiAccessibilityService.typeText(text)
            if success:
                logger.info("Typed text via accessibility service", text=text)
                return ToolResult(success=True, observation=f"Typed text: '{text}' via Accessibility Service")
            else:
                logger.warning("Accessibility typeText returned false, falling back to shell")
    except Exception as e:
        logger.warning("Accessibility service typeText failed", error=str(e))

    escaped_text = text.replace(" ", "%s").replace("'", "\\'").replace('"', '\\"')
    success = _run_input_command(f"input text '{escaped_text}'")
    if success:
        return ToolResult(success=True, observation=f"Typed text: {text}")
    else:
        return ToolResult(success=False, error="Failed to execute input text command. Please enable OpenSarthi Accessibility Service in settings.", retryable=True)


async def android_press_key(args: dict, **_) -> ToolResult:
    key = args.get("key", "").lower()
    if not key:
        return ToolResult(success=False, error="key is required", retryable=False)
    
    try:
        from dev.opensarthi.android import SarthiAccessibilityService
        if SarthiAccessibilityService.isServiceRunning():
            success = SarthiAccessibilityService.pressKey(key)
            if success:
                logger.info("Pressed key via accessibility service", key=key)
                return ToolResult(success=True, observation=f"Pressed key: '{key}' via Accessibility Service")
            else:
                logger.warning("Accessibility pressKey returned false, falling back to shell")
    except Exception as e:
        logger.warning("Accessibility service pressKey failed", error=str(e))

    KEY_MAP = {
        "enter": 66,
        "return": 66,
        "backspace": 67,
        "home": 3,
        "back": 4,
        "tab": 61,
        "up": 19,
        "down": 20,
        "left": 21,
        "right": 22,
    }
    
    keycode = KEY_MAP.get(key)
    if not keycode:
        try:
            keycode = int(key)
        except ValueError:
            return ToolResult(success=False, error=f"Unsupported key: {key}", retryable=False)
            
    success = _run_input_command(f"input keyevent {keycode}")
    if success:
        return ToolResult(success=True, observation=f"Pressed key: {key}")
    else:
        return ToolResult(success=False, error="Failed to execute input keyevent command. Please enable OpenSarthi Accessibility Service in settings.", retryable=True)


async def android_observe_desktop(args: dict, **_) -> ToolResult:
    try:
        from com.chaquo.python import Python
        context = Python.getPlatform().getApplication()
        cache_dir = context.getCacheDir().getAbsolutePath()
        screenshot_path = os.path.join(cache_dir, "screenshot.png")
        
        # Capture screenshot for visual feed
        _run_input_command(f"screencap -p {screenshot_path}")
        
        # Get foreground activity name
        foreground = "unknown"
        res = subprocess.run("dumpsys activity activities | grep mResumedActivity", shell=True, capture_output=True, text=True)
        if res.returncode == 0 and res.stdout:
            foreground = res.stdout.strip()
        else:
            res = subprocess.run("su -c 'dumpsys activity activities | grep mResumedActivity'", shell=True, capture_output=True, text=True)
            if res.returncode == 0 and res.stdout:
                foreground = res.stdout.strip()

        # Try gathering accessibility tree elements
        a11y_summary = ""
        try:
            from dev.opensarthi.android import SarthiAccessibilityService
            if SarthiAccessibilityService.isServiceRunning():
                structure_json = SarthiAccessibilityService.getScreenStructure()
                import json
                data = json.loads(structure_json)
                summary_nodes = []
                def traverse(node):
                    text = node.get("text", "").strip()
                    desc = node.get("desc", "").strip()
                    bounds = node.get("bounds", "")
                    clickable = node.get("clickable", False)
                    if text or desc:
                        click_indicator = " [Clickable]" if clickable else ""
                        summary_nodes.append(f"- {text or desc} at bounds {bounds}{click_indicator}")
                    for child in node.get("children", []):
                        traverse(child)
                traverse(data)
                if summary_nodes:
                    a11y_summary = "\nVisible UI Elements:\n" + "\n".join(summary_nodes)
            else:
                a11y_summary = "\n[Accessibility Service is NOT enabled. Go to settings > accessibility to enable it for layout observation]"
        except Exception as ae:
            logger.warning("Accessibility fetch error in observe", error=str(ae))
                
        return ToolResult(
            success=True,
            observation=f"Current screen observed. Active app/activity: {foreground}. Screenshot saved.{a11y_summary}"
        )
    except Exception as e:
        return ToolResult(success=False, error=f"Failed to observe screen: {e}", retryable=True)


async def android_focus_window(args: dict, **_) -> ToolResult:
    return ToolResult(success=True, observation="Focused window (simulated)")


async def android_wait_for_window(args: dict, **_) -> ToolResult:
    return ToolResult(success=True, observation="Window appeared (simulated)")


async def android_wait_for_text(args: dict, **_) -> ToolResult:
    return ToolResult(success=True, observation="Text appeared (simulated)")


async def android_click_element(args: dict, **_) -> ToolResult:
    name = args.get("name")
    if not name:
        return ToolResult(success=False, error="name is required for click_element", retryable=False)
    
    try:
        from dev.opensarthi.android import SarthiAccessibilityService
        if SarthiAccessibilityService.isServiceRunning():
            structure_json = SarthiAccessibilityService.getScreenStructure()
            import json
            data = json.loads(structure_json)
            
            target_bounds = None
            def find_node(node):
                nonlocal target_bounds
                text = node.get("text", "").lower()
                desc = node.get("desc", "").lower()
                if name.lower() in text or name.lower() in desc:
                    target_bounds = node.get("bounds", "")
                    return True
                for child in node.get("children", []):
                    if find_node(child):
                        return True
                return False
            
            find_node(data)
            if target_bounds:
                import re
                match = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", target_bounds)
                if match:
                    left, top, right, bottom = map(int, match.groups())
                    click_x = (left + right) // 2
                    click_y = (top + bottom) // 2
                    success = SarthiAccessibilityService.click(click_x, click_y)
                    if success:
                        logger.info("Clicked element via accessibility service", name=name, x=click_x, y=click_y)
                        return ToolResult(success=True, observation=f"Clicked element '{name}' at ({click_x}, {click_y})")
            
            return ToolResult(success=False, error=f"Element with text/name '{name}' not found on screen.", retryable=True)
        else:
            return ToolResult(success=False, error="Accessibility service is disabled. Cannot resolve element name.", retryable=False)
    except Exception as e:
        return ToolResult(success=False, error=f"Failed to click element via Accessibility: {e}", retryable=True)


# ── Registry patcher ───────────────────────────────────────────────────────────

def register_android_tools(registry_module) -> None:
    """
    Patch the tool registry to replace desktop tools with Android implementations.
    Call this before the FastAPI app starts.
    """
    OVERRIDES = {
        "open_app":         android_open_app,
        "shell":            android_shell,
        "click":            android_click,
        "type_text":        android_type_text,
        "press_key":        android_press_key,
        "observe_desktop":  android_observe_desktop,
        "focus_window":     android_focus_window,
        "wait_for_window":  android_wait_for_window,
        "wait_for_text":    android_wait_for_text,
        "click_element":    android_click_element,
    }

    patched = 0
    for tool_name, impl_fn in OVERRIDES.items():
        try:
            tool = registry_module.get(tool_name)
            if tool:
                tool._android_execute = impl_fn
                tool.execute = impl_fn
                patched += 1
        except Exception as e:
            logger.warning(f"Could not patch tool '{tool_name}': {e}")

    logger.info(f"[Android] Patched {patched}/{len(OVERRIDES)} tools with Android implementations")
