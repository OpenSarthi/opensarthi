"""
voice/android_bridge.py — Android STT/TTS bridge via Chaquopy.

Kotlin @JvmStatic companion methods are called as:
  AndroidVoiceBridge.getInstance()   ← works after @JvmStatic annotation

Python callbacks from Kotlin:
  _on_transcript(text)         — final STT result
  _on_partial_transcript(text) — partial result for live display
  _on_voice_state(state)       — listening / speaking / idle
"""
import asyncio
import os
import threading
import structlog
from typing import AsyncIterator, Optional, Callable

logger = structlog.get_logger()

IS_ANDROID = os.environ.get("OPENSARTHI_PLATFORM") == "android"

# ── Module-level globals ──────────────────────────────────────────────────────
_active_pipeline: Optional["AndroidVoicePipeline"] = None
_main_loop: Optional[asyncio.AbstractEventLoop] = None


def set_active_pipeline(pipeline: "AndroidVoicePipeline", loop: asyncio.AbstractEventLoop):
    global _active_pipeline, _main_loop
    _active_pipeline = pipeline
    _main_loop = loop


# ── Kotlin → Python callbacks ─────────────────────────────────────────────────

def _on_transcript(text: str):
    """Final STT result — put into pipeline queue."""
    global _active_pipeline, _main_loop
    logger.info("[AndroidVoiceBridge] Transcript", text=text)
    if _active_pipeline and _main_loop:
        try:
            _main_loop.call_soon_threadsafe(
                _active_pipeline._transcript_queue.put_nowait, text
            )
        except Exception as e:
            logger.warning(f"[AndroidVoiceBridge] transcript delivery failed: {e}")


def _on_partial_transcript(text: str):
    """Partial STT result — forward to UI for live display."""
    global _active_pipeline, _main_loop
    if _active_pipeline and _main_loop and _active_pipeline.on_partial_transcript:
        try:
            _main_loop.call_soon_threadsafe(_active_pipeline.on_partial_transcript, text)
        except Exception:
            pass


def _on_voice_state(state: str):
    """Voice state update from Kotlin."""
    global _active_pipeline, _main_loop
    logger.debug("[AndroidVoiceBridge] voice state", state=state)
    if _active_pipeline and _main_loop and _active_pipeline.on_voice_state:
        try:
            _main_loop.call_soon_threadsafe(_active_pipeline.on_voice_state, state)
        except Exception:
            pass


# ── Pipeline ──────────────────────────────────────────────────────────────────

class AndroidVoicePipeline:
    """
    Voice pipeline for Android — delegates to Kotlin AndroidVoiceBridge.
    STT uses SpeechRecognizer (auto-rearms for continuous listening).
    TTS uses TextToSpeech (pauses STT during speech).
    """

    def __init__(self):
        self._transcript_queue: asyncio.Queue = asyncio.Queue()
        self._running = False
        self._speaking = False
        self.on_voice_state: Optional[Callable[[str], None]] = None
        self.on_partial_transcript: Optional[Callable[[str], None]] = None

    async def initialize(self):
        loop = asyncio.get_running_loop()
        set_active_pipeline(self, loop)
        logger.info("[AndroidVoicePipeline] Initialized")

    def _get_bridge(self):
        """Get Kotlin bridge instance. Raises if unavailable."""
        from dev.opensarthi.android import AndroidVoiceBridge  # type: ignore
        return AndroidVoiceBridge.getInstance()

    async def start_listening(self) -> AsyncIterator[str]:
        set_active_pipeline(self, asyncio.get_running_loop())

        if IS_ANDROID:
            try:
                bridge = self._get_bridge()
                bridge.startListening()
                logger.info("[AndroidVoicePipeline] SpeechRecognizer started")
            except Exception as e:
                logger.error("[AndroidVoicePipeline] Failed to start listening", error=str(e))

        self._running = True

        try:
            while self._running:
                try:
                    transcript = await asyncio.wait_for(
                        self._transcript_queue.get(), timeout=1.0
                    )
                    yield transcript
                except asyncio.TimeoutError:
                    continue
                except asyncio.CancelledError:
                    break
        finally:
            self._running = False

    def stop_listening(self):
        self._running = False
        if IS_ANDROID:
            try:
                self._get_bridge().stopListening()
            except Exception as e:
                logger.error("[AndroidVoicePipeline] Failed to stop listening", error=str(e))

    async def speak(self, text: str):
        self._speaking = True
        try:
            if IS_ANDROID:
                await self._android_tts(text)
            else:
                logger.info(f"[AndroidVoicePipeline] TTS mock: {text[:60]}")
                await asyncio.sleep(len(text) * 0.04)
        finally:
            self._speaking = False

    async def _android_tts(self, text: str):
        loop = asyncio.get_event_loop()
        done_event = asyncio.Event()

        def _speak_on_main():
            try:
                bridge = self._get_bridge()

                # Set a Runnable completion callback using a thread event
                def _on_done():
                    loop.call_soon_threadsafe(done_event.set)

                # Chaquopy can wrap Python callables as java.lang.Runnable automatically
                bridge.onTtsComplete = _on_done
                bridge.speak(text)
            except Exception as e:
                logger.error("[AndroidVoicePipeline] TTS speak error", error=str(e))
                loop.call_soon_threadsafe(done_event.set)

        # Run on executor (bridges to main thread inside speak())
        await loop.run_in_executor(None, _speak_on_main)

        try:
            await asyncio.wait_for(done_event.wait(), timeout=90.0)
        except asyncio.TimeoutError:
            logger.warning("[AndroidVoicePipeline] TTS completion timeout")

    def stop_speaking(self):
        self._speaking = False
        if IS_ANDROID:
            try:
                self._get_bridge().stopSpeaking()
            except Exception as e:
                logger.warning("[AndroidVoicePipeline] Error stopping TTS", error=str(e))
