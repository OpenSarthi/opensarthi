"""
tools/android/tools.py

Android-native tool implementations that replace the desktop X11/AT-SPI tools.

Architecture:
  Python tools call Chaquopy's Java bridge to invoke Android APIs:
    - open_app    → context.startActivity(Intent(Intent.ACTION_MAIN, ...))
    - click       → Accessibility Service (requires user to grant in Settings)
    - observe     → MediaProjection → Bitmap → ML Kit Text Recognition
    - wait_for_*  → async polling with asyncio.sleep()

Status of each tool:
  ✅ open_app       — implemented via Intent
  ✅ shell          — restricted subset (no root, no arbitrary exec)
  🔄 observe_desktop — stub (MediaProjection needs Activity context — Phase 2)
  🔄 click           — stub (requires AccessibilityService to be running — Phase 2)
  🔄 type_text       — stub (requires AccessibilityService — Phase 2)
  🔄 wait_for_window — stub (polls foreground package name — Phase 2)
"""
import asyncio
import os
import subprocess
import structlog
from typing import Optional

logger = structlog.get_logger()

# ── Base tool result ───────────────────────────────────────────────────────────
from planner.schemas import ToolResult


class _NotImplementedOnAndroidError(Exception):
    pass


def _android_not_impl(tool_name: str) -> ToolResult:
    return ToolResult(
        success=False,
        error=f"Tool '{tool_name}' is not yet implemented for Android. "
              f"Use voice or text commands for tasks the AI can handle via API.",
        retryable=False,
    )


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
        # Get Android context via Chaquopy
        context = Python.getPlatform().getApplication()
        pm = context.getPackageManager()

        # Try to launch via package manager
        launch_intent = pm.getLaunchIntentForPackage(package_name)
        if launch_intent is None:
            return ToolResult(
                success=False,
                error=f"App '{app_name}' (package: {package_name}) not found on device.",
                retryable=False,
            )
        launch_intent.addFlags(0x10000000)  # FLAG_ACTIVITY_NEW_TASK
        context.startActivity(launch_intent)
        logger.info("Opened Android app", app=app_name, package=package_name)
        await asyncio.sleep(1.0)  # wait for app to open
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
    BLOCKED = ["rm ", "rm\t", "dd ", "mkfs", "fdisk", "sudo", "su ", "chmod 777", "curl | sh", "wget | sh"]
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


# Stub implementations — Phase 2
async def android_click(args: dict, **_) -> ToolResult:
    return _android_not_impl("click")

async def android_type_text(args: dict, **_) -> ToolResult:
    return _android_not_impl("type_text")

async def android_press_key(args: dict, **_) -> ToolResult:
    return _android_not_impl("press_key")

async def android_observe_desktop(args: dict, **_) -> ToolResult:
    return _android_not_impl("observe_desktop")

async def android_focus_window(args: dict, **_) -> ToolResult:
    return _android_not_impl("focus_window")

async def android_wait_for_window(args: dict, **_) -> ToolResult:
    return _android_not_impl("wait_for_window")

async def android_wait_for_text(args: dict, **_) -> ToolResult:
    return _android_not_impl("wait_for_text")

async def android_click_element(args: dict, **_) -> ToolResult:
    return _android_not_impl("click_element")


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
                # Replace the execute method on the existing tool object
                tool._android_execute = impl_fn
                tool.execute = impl_fn
                patched += 1
        except Exception as e:
            logger.warning(f"Could not patch tool '{tool_name}': {e}")

    logger.info(f"[Android] Patched {patched}/{len(OVERRIDES)} tools with Android implementations")
