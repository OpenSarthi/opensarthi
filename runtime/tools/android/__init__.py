"""
tools/android/__init__.py

Android-specific tool overrides for OpenSarthi.

When running on Android (detected via OPENSARTHI_PLATFORM=android env var),
these tools replace their desktop counterparts in the tool registry.

Desktop tool   → Android replacement
───────────────────────────────────────────────────────────────────────────────
click          → AndroidClickTool     (Accessibility Service via JNI bridge)
type_text      → AndroidTypeTool      (Accessibility Service InputMethod)
press_key      → AndroidKeyTool       (dispatchKeyEvent via Accessibility)
open_app       → AndroidOpenAppTool   (startActivity with package Intent)
observe_desktop→ AndroidObserveTool   (MediaProjection + ML Kit OCR)
focus_window   → AndroidFocusTool     (bringToFront via ActivityManager)
wait_for_window→ AndroidWaitAppTool   (poll ActivityManager.getForegroundApp)
wait_for_text  → AndroidWaitTextTool  (poll ML Kit OCR result)
shell          → AndroidShellTool     (restricted: non-root adb-style commands)
"""
from .tools import register_android_tools

__all__ = ["register_android_tools"]
