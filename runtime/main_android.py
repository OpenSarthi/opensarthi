"""
main_android.py — Android entry point for the OpenSarthi runtime.

Called by RuntimeService.kt via Chaquopy:
    py.getModule("main_android").callAttr("start_server", 8765)

Key differences from the desktop main.py:
  1. No voice pipeline startup (voice handled by Android SpeechRecognizer via Kotlin)
  2. PORT is passed in by the Kotlin caller
  3. Uses Android-specific tool registry overrides (see tools/android/)
  4. uvicorn runs in a thread (not blocking the Chaquopy call frame directly)
  5. stop_server() provides graceful shutdown

Android tool overrides: When running on Android, the tool registry is patched
to substitute desktop tools (click, observe_desktop, etc.) with Android-aware
equivalents that either raise NotImplementedError (unimplemented) or delegate
to the Kotlin accessibility bridge.
"""
# ISSUE-14 FIX: Set OPENSARTHI_PLATFORM=android BEFORE any module imports.
# websocket.py and registry.py branch on this env var at import time.
import os
os.environ["OPENSARTHI_PLATFORM"] = "android"

import asyncio
import threading
import sys

# ── Path setup (Chaquopy provides sys.path automatically, but we add runtime root) ──
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
if _THIS_DIR not in sys.path:
    sys.path.insert(0, _THIS_DIR)

# ── Patch tool registry for Android before importing the agent ──────────────────
def _patch_android_tools():
    """Replace desktop-only tools with Android stubs or Android-native implementations."""
    try:
        from tools import registry as reg
        from tools.android import register_android_tools
        register_android_tools(reg)
    except ImportError as e:
        import logging
        logging.warning(f"[Android] Could not patch tool registry: {e}")

# ── Server lifecycle ────────────────────────────────────────────────────────────

_server = None
_server_thread = None
_loop: asyncio.AbstractEventLoop = None


def start_server(port: int = 8765):
    """
    Start the FastAPI/uvicorn server on the given port.
    Called from Kotlin via Chaquopy.
    Blocks until stop_server() is called.
    """
    global _server, _loop

    _patch_android_tools()

    os.environ.setdefault("RUNTIME_PORT", str(port))

    import uvicorn
    from main import app  # reuse the FastAPI app from the desktop main.py

    config = uvicorn.Config(
        app=app,
        host="127.0.0.1",
        port=port,
        log_level="info",
        loop="asyncio",
        # No SSL needed — localhost only
    )
    _server = uvicorn.Server(config)
    _loop = asyncio.new_event_loop()
    asyncio.set_event_loop(_loop)

    print(f"[OpenSarthi Android] Starting FastAPI runtime on ws://127.0.0.1:{port}/ws")
    _loop.run_until_complete(_server.serve())


def stop_server():
    """
    Gracefully stop the uvicorn server.
    Called from Kotlin via Chaquopy when RuntimeService is destroyed.
    """
    global _server, _loop
    if _server and _loop:
        _loop.call_soon_threadsafe(_server.shutdown)
    print("[OpenSarthi Android] Runtime stopped.")
