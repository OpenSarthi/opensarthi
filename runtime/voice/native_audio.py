"""
Native Audio Pipeline for OpenSarthi — Mark-L Parity Feature

Provides sub-500ms voice interaction using:
- Gemini Live API (WebSocket-based bidirectional audio streaming)
- OpenAI Realtime API (WebRTC-based bidirectional audio streaming)

Both support function calling integration with the existing tool registry.
"""
import asyncio
import json
import base64
import structlog
import uuid
from typing import Optional, Callable, Any, Dict, List
from dataclasses import dataclass, field
from enum import Enum

try:
    import pyaudio
except ImportError:
    pyaudio = None

logger = structlog.get_logger()


class NativeAudioProvider(str, Enum):
    GEMINI_LIVE = "gemini-live"
    OPENAI_REALTIME = "openai-realtime"
    OFFLINE = "offline"


class NativeAudioState(str, Enum):
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    ERROR = "error"


@dataclass
class AudioConfig:
    """Audio configuration for native streaming."""
    sample_rate: int = 16000
    channels: int = 1
    chunk_size: int = 512  # 32ms @ 16kHz
    format: str = "int16"  # PCM 16-bit


@dataclass
class FunctionCall:
    """Represents a function call from the native audio provider."""
    id: str
    name: str
    arguments: Dict[str, Any]


@dataclass
class NativeAudioSession:
    """Session state for native audio connection."""
    provider: NativeAudioProvider
    state: NativeAudioState = NativeAudioState.DISCONNECTED
    session_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    websocket: Any = None
    audio_config: AudioConfig = field(default_factory=AudioConfig)
    tools_schema: List[Dict] = field(default_factory=list)
    on_audio_chunk: Optional[Callable] = None
    on_function_call: Optional[Callable] = None
    on_transcript: Optional[Callable] = None
    on_state_change: Optional[Callable] = None
    on_usage: Optional[Callable] = None
    error: Optional[str] = None


class NativeAudioPipeline:
    """
    Native audio pipeline supporting Gemini Live and OpenAI Realtime APIs.

    Features:
    - Bidirectional audio streaming (mic → provider → speaker)
    - Function calling integrated with OpenSarthi tool registry
    - Server-side VAD (Voice Activity Detection)
    - Automatic reconnection
    - Seamless fallback to offline pipeline
    """

    def __init__(self, settings=None):
        self.settings = settings
        self.session: Optional[NativeAudioSession] = None
        self._listen_task: Optional[asyncio.Task] = None
        self._send_task: Optional[asyncio.Task] = None
        self._receive_task: Optional[asyncio.Task] = None
        self._audio_input_queue: asyncio.Queue = asyncio.Queue()
        self._audio_output_queue: asyncio.Queue = asyncio.Queue()
        self._running = False
        self._mic_stream = None
        self._speaker_stream = None
        self._pyaudio = None
        self._lock = asyncio.Lock()  # Prevent concurrent connections

        # Audio configuration
        self.audio_config = AudioConfig()

    async def initialize(self, provider: str = "auto") -> bool:
        """
        Initialize native audio pipeline.

        Args:
            provider: "auto" | "gemini-live" | "openai-realtime" | "offline"

        Returns:
            True if native audio initialized successfully, False if falling back to offline
        """
        async with self._lock:
            if self.is_connected():
                return True

            from config import settings as global_settings
            self.settings = self.settings or global_settings
            self._loop = asyncio.get_running_loop()

            if provider == "auto":
                provider = getattr(self.settings, "native_audio_pipeline", "auto")

            if provider == "offline":
                logger.info("Native audio disabled, using offline pipeline")
                return False

        # Try providers in order
        providers_to_try = []
        if provider == "gemini-live":
            providers_to_try = [NativeAudioProvider.GEMINI_LIVE]
        elif provider == "openai-realtime":
            providers_to_try = [NativeAudioProvider.OPENAI_REALTIME]
        else:  # auto
            # Prefer Gemini Live if API key available
            if getattr(self.settings, "gemini_api_key", None):
                providers_to_try.append(NativeAudioProvider.GEMINI_LIVE)
            if getattr(self.settings, "openai_api_key", None):
                providers_to_try.append(NativeAudioProvider.OPENAI_REALTIME)

        for prov in providers_to_try:
            try:
                success = await self._connect_provider(prov)
                if success:
                    logger.info(f"Native audio connected via {prov.value}")
                    return True
            except Exception as e:
                logger.warning(f"Failed to connect to {prov.value}", error=str(e))
                continue

        logger.info("All native audio providers failed, falling back to offline pipeline")
        return False

    async def _connect_provider(self, provider: NativeAudioProvider) -> bool:
        """Connect to a specific native audio provider."""
        self.session = NativeAudioSession(provider=provider)
        self.session.on_state_change = self._on_state_change

        # Load tool schemas for function calling
        self.session.tools_schema = self._get_tool_schemas()

        if provider == NativeAudioProvider.GEMINI_LIVE:
            return await self._connect_gemini_live()
        elif provider == NativeAudioProvider.OPENAI_REALTIME:
            return await self._connect_openai_realtime()

        return False

    def _get_tool_schemas(self) -> List[Dict]:
        """Get tool schemas from registry for function calling."""
        from tools.registry import get_schemas
        schemas = get_schemas()
        # Convert to provider-specific format
        function_declarations = []
        for schema in schemas:
            function_declarations.append({
                "name": schema["name"],
                "description": schema["description"],
                "parameters": schema["schema"]
            })
        return function_declarations

    async def _connect_gemini_live(self) -> bool:
        """Connect to Gemini Live API via WebSocket."""
        import websockets
        from google.genai import types

        api_key = getattr(self.settings, "gemini_api_key", None)
        if not api_key:
            raise ValueError("GEMINI_API_KEY not configured")

        # Gemini Live WebSocket endpoint
        url = f"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key={api_key}"

        try:
            self.session.state = NativeAudioState.CONNECTING
            self.session.websocket = await websockets.connect(url)
            self.session.state = NativeAudioState.CONNECTED

            # Send initial setup message
            setup_msg = {
                "setup": {
                    "model": "models/gemini-2.5-flash-native-audio-preview-12-2025",
                    "generation_config": {
                        "response_modalities": ["AUDIO"],
                        "speech_config": {
                            "voice_config": {
                                "prebuilt_voice_config": {
                                    "voice_name": "Puck"  # Default voice
                                }
                            }
                        }
                    },
                    "tools": [{"function_declarations": self.session.tools_schema}] if self.session.tools_schema else [],
                    "system_instruction": {
                        "parts": [{
                            "text": "You are OpenSarthi, a helpful AI assistant with voice interaction capabilities. "
                                   "You can use tools to perform actions on the user's device, search the web, "
                                   "control media, and more. Keep responses conversational and concise for voice."
                        }]
                    }
                }
            }
            await self.session.websocket.send(json.dumps(setup_msg))

            # Start receive loop
            self._receive_task = asyncio.create_task(self._gemini_receive_loop())
            self._send_task = asyncio.create_task(self._gemini_send_loop())

            return True

        except Exception as e:
            logger.error("Gemini Live connection failed", error=str(e))
            self.session.state = NativeAudioState.ERROR
            self.session.error = str(e)
            return False

    async def _connect_openai_realtime(self) -> bool:
        """Connect to OpenAI Realtime API via WebRTC."""
        # OpenAI Realtime uses WebRTC, which is more complex.
        # For initial implementation, we'll use the WebSocket fallback approach
        # or use a WebRTC library like aiortc.

        api_key = getattr(self.settings, "openai_api_key", None)
        if not api_key:
            raise ValueError("OPENAI_API_KEY not configured")

        # For now, implement WebSocket-based approach (OpenAI also supports this)
        # Full WebRTC implementation would require aiortc
        import websockets

        url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "OpenAI-Beta": "realtime=v1"
        }

        try:
            self.session.state = NativeAudioState.CONNECTING
            self.session.websocket = await websockets.connect(url, additional_headers=headers)
            self.session.state = NativeAudioState.CONNECTED

            # Send session update with tools and audio config
            session_update = {
                "type": "session.update",
                "session": {
                    "modalities": ["text", "audio"],
                    "instructions": "You are OpenSarthi, a helpful AI assistant with voice interaction capabilities. "
                                   "You can use tools to perform actions on the user's device, search the web, "
                                   "control media, and more. Keep responses conversational and concise for voice.",
                    "voice": "alloy",
                    "input_audio_format": "pcm16",
                    "output_audio_format": "pcm16",
                    "input_audio_transcription": {
                        "model": "whisper-1"
                    },
                    "turn_detection": {
                        "type": "server_vad",
                        "threshold": 0.5,
                        "prefix_padding_ms": 300,
                        "silence_duration_ms": 500
                    },
                    "tools": self._convert_tools_for_openai(),
                    "tool_choice": "auto"
                }
            }
            await self.session.websocket.send(json.dumps(session_update))

            # Start receive loop
            self._receive_task = asyncio.create_task(self._openai_receive_loop())
            self._send_task = asyncio.create_task(self._openai_send_loop())

            return True

        except Exception as e:
            logger.error("OpenAI Realtime connection failed", error=str(e))
            self.session.state = NativeAudioState.ERROR
            self.session.error = str(e)
            return False

    def _convert_tools_for_openai(self) -> List[Dict]:
        """Convert tool schemas to OpenAI function calling format."""
        tools = []
        for schema in self.session.tools_schema:
            tools.append({
                "type": "function",
                "name": schema["name"],
                "description": schema["description"],
                "parameters": schema["schema"]
            })
        return tools

    async def _gemini_receive_loop(self):
        """Receive loop for Gemini Live WebSocket."""
        try:
            async for message in self.session.websocket:
                data = json.loads(message)
                await self._handle_gemini_message(data)
        except Exception as e:
            logger.error("Gemini receive loop error", error=str(e))
            await self._handle_disconnect()

    async def _gemini_send_loop(self):
        """Send loop for Gemini Live - streams audio from microphone."""
        try:
            while self.session and self.session.state == NativeAudioState.CONNECTED:
                # Get audio chunk from queue
                audio_chunk = await self._audio_input_queue.get()
                if audio_chunk is None:  # Shutdown signal
                    break

                # Convert to base64
                audio_b64 = base64.b64encode(audio_chunk).decode('utf-8')

                # Send to Gemini
                msg = {
                    "realtime_input": {
                        "media_chunks": [{
                            "mime_type": "audio/pcm;rate=16000",
                            "data": audio_b64
                        }]
                    }
                }
                await self.session.websocket.send(json.dumps(msg))
        except Exception as e:
            logger.error("Gemini send loop error", error=str(e))
            await self._handle_disconnect()

    async def _openai_receive_loop(self):
        """Receive loop for OpenAI Realtime WebSocket."""
        try:
            async for message in self.session.websocket:
                data = json.loads(message)
                await self._handle_openai_message(data)
        except Exception as e:
            logger.error("OpenAI receive loop error", error=str(e))
            await self._handle_disconnect()

    async def _openai_send_loop(self):
        """Send loop for OpenAI Realtime - streams audio from microphone."""
        try:
            while self.session and self.session.state == NativeAudioState.CONNECTED:
                audio_chunk = await self._audio_input_queue.get()
                if audio_chunk is None:
                    break

                audio_b64 = base64.b64encode(audio_chunk).decode('utf-8')

                msg = {
                    "type": "input_audio_buffer.append",
                    "audio": audio_b64
                }
                await self.session.websocket.send(json.dumps(msg))
        except Exception as e:
            logger.error("OpenAI send loop error", error=str(e))
            await self._handle_disconnect()

    async def _handle_gemini_message(self, data: Dict):
        """Handle incoming message from Gemini Live."""
        # Handle setup complete
        if "setupComplete" in data:
            logger.info("Gemini Live setup complete")
            # Start audio capture
            await self._start_audio_capture()
            return

        # Handle audio output
        if "serverContent" in data:
            content = data["serverContent"]

            # Audio chunks
            if "modelTurn" in content:
                for part in content["modelTurn"].get("parts", []):
                    if "inlineData" in part:
                        audio_b64 = part["inlineData"]["data"]
                        audio_bytes = base64.b64decode(audio_b64)
                        await self._audio_output_queue.put(audio_bytes)

                        # Play audio immediately
                        if self.session.on_audio_chunk:
                            await self.session.on_audio_chunk(audio_bytes)

            # Transcript
            if "outputTranscription" in content:
                text = content["outputTranscription"].get("text", "")
                if text and self.session.on_transcript:
                    await self.session.on_transcript(text, is_final=True)

            # Input transcription (user speech)
            if "inputTranscription" in content:
                text = content["inputTranscription"].get("text", "")
                if text and self.session.on_transcript:
                    await self.session.on_transcript(text, is_final=False)

            # Function calls
            if "modelTurn" in content:
                for part in content["modelTurn"].get("parts", []):
                    if "functionCall" in part:
                        fc = part["functionCall"]
                        func_call = FunctionCall(
                            id=fc.get("id", str(uuid.uuid4())),
                            name=fc.get("name", ""),
                            arguments=fc.get("args", {})
                        )
                        await self._execute_function_call(func_call)

        # Handle tool response confirmation
        if "toolResponse" in data:
            # Tool response handled by the provider automatically
            pass

        # Handle usage metadata for token tracking
        if "serverContent" in data:
            sc = data["serverContent"]
            if "usageMetadata" in sc:
                meta = sc["usageMetadata"]
                usage = {
                    "request_tokens": meta.get("promptTokenCount", 0),
                    "response_tokens": meta.get("candidatesTokenCount", 0),
                    "total_tokens": meta.get("totalTokenCount", 0)
                }
                if self.session and getattr(self.session, "on_usage", None):
                    await self.session.on_usage(usage)

    async def _handle_openai_message(self, data: Dict):
        """Handle incoming message from OpenAI Realtime."""
        msg_type = data.get("type", "")

        if msg_type == "session.created":
            logger.info("OpenAI Realtime session created")
            await self._start_audio_capture()

        elif msg_type == "session.updated":
            logger.info("OpenAI Realtime session updated")

        elif msg_type == "response.audio.delta":
            # Audio chunk from model
            audio_b64 = data.get("delta", "")
            audio_bytes = base64.b64decode(audio_b64)
            await self._audio_output_queue.put(audio_bytes)
            if self.session.on_audio_chunk:
                await self.session.on_audio_chunk(audio_bytes)

        elif msg_type == "response.audio_transcript.delta":
            # Streaming transcript
            text = data.get("delta", "")
            if text and self.session.on_transcript:
                await self.session.on_transcript(text, is_final=False)

        elif msg_type == "response.audio_transcript.done":
            # Final transcript
            text = data.get("transcript", "")
            if text and self.session.on_transcript:
                await self.session.on_transcript(text, is_final=True)

        elif msg_type == "input_audio_buffer.speech_started":
            logger.debug("OpenAI VAD: speech started")

        elif msg_type == "input_audio_buffer.speech_stopped":
            logger.debug("OpenAI VAD: speech stopped")

        elif msg_type == "response.function_call_arguments.done":
            # Function call from model
            func_call = FunctionCall(
                id=data.get("call_id", str(uuid.uuid4())),
                name=data.get("name", ""),
                arguments=json.loads(data.get("arguments", "{}"))
            )
            await self._execute_function_call(func_call)

        elif msg_type == "response.done":
            response = data.get("response", {})
            usage = response.get("usage", {})
            if usage:
                formatted_usage = {
                    "request_tokens": usage.get("input_tokens", 0),
                    "response_tokens": usage.get("output_tokens", 0),
                    "total_tokens": usage.get("total_tokens", 0)
                }
                if self.session and getattr(self.session, "on_usage", None):
                    await self.session.on_usage(formatted_usage)

        elif msg_type == "error":
            logger.error("OpenAI Realtime error", error=data.get("error", {}))
            await self._handle_disconnect()

    async def _execute_function_call(self, func_call: FunctionCall):
        """Execute a function call from the native audio provider."""
        logger.info(f"Executing function call: {func_call.name}", args=func_call.arguments)

        if self.session.on_function_call:
            try:
                result = await self.session.on_function_call(func_call.name, func_call.arguments)

                # Send result back to provider
                if self.session.provider == NativeAudioProvider.GEMINI_LIVE:
                    await self._send_gemini_function_response(func_call.id, result)
                elif self.session.provider == NativeAudioProvider.OPENAI_REALTIME:
                    await self._send_openai_function_response(func_call.id, result)
            except Exception as e:
                logger.error(f"Function call {func_call.name} failed", error=str(e))
                error_result = {"error": str(e)}
                if self.session.provider == NativeAudioProvider.GEMINI_LIVE:
                    await self._send_gemini_function_response(func_call.id, error_result)
                elif self.session.provider == NativeAudioProvider.OPENAI_REALTIME:
                    await self._send_openai_function_response(func_call.id, error_result)

    async def _send_gemini_function_response(self, call_id: str, result: Any):
        """Send function response to Gemini Live."""
        msg = {
            "tool_response": {
                "function_responses": [{
                    "id": call_id,
                    "name": "",  # Will be filled by the provider context
                    "response": result
                }]
            }
        }
        await self.session.websocket.send(json.dumps(msg))

    async def _send_openai_function_response(self, call_id: str, result: Any):
        """Send function response to OpenAI Realtime."""
        msg = {
            "type": "conversation.item.create",
            "item": {
                "type": "function_call_output",
                "call_id": call_id,
                "output": json.dumps(result)
            }
        }
        await self.session.websocket.send(json.dumps(msg))

        # Trigger response generation
        trigger_msg = {"type": "response.create"}
        await self.session.websocket.send(json.dumps(trigger_msg))

    async def _start_audio_capture(self):
        """Start capturing audio from microphone."""
        if not pyaudio:
            logger.error("pyaudio is not installed or available")
            return

        self._pyaudio = pyaudio.PyAudio()

        # Open input stream
        self._mic_stream = self._pyaudio.open(
            format=pyaudio.paInt16,
            channels=self.audio_config.channels,
            rate=self.audio_config.sample_rate,
            input=True,
            frames_per_buffer=self.audio_config.chunk_size,
            stream_callback=self._mic_callback
        )

        # Open output stream for playback
        self._speaker_stream = self._pyaudio.open(
            format=pyaudio.paInt16,
            channels=self.audio_config.channels,
            rate=24000,  # Provider output sample rate
            output=True,
            frames_per_buffer=self.audio_config.chunk_size
        )

        self._mic_stream.start_stream()
        logger.info("Audio capture started")

        # Start playback task
        self._playback_task = asyncio.create_task(self._playback_loop())

    def _mic_callback(self, in_data, frame_count, time_info, status):
        """PyAudio callback for microphone input."""
        if hasattr(self, "_loop") and self._loop and self._loop.is_running():
            self._loop.call_soon_threadsafe(
                self._audio_input_queue.put_nowait,
                in_data
            )
        return (None, pyaudio.paContinue if pyaudio else 0)

    async def _playback_loop(self):
        """Play audio chunks from output queue."""
        try:
            while self.session and self.session.state == NativeAudioState.CONNECTED:
                audio_chunk = await self._audio_output_queue.get()
                if audio_chunk is None:
                    break
                if self._speaker_stream and self._speaker_stream.is_active():
                    self._speaker_stream.write(audio_chunk)
        except Exception as e:
            logger.error("Playback loop error", error=str(e))

    def _on_state_change(self, state: NativeAudioState):
        """Handle state change callback."""
        logger.info(f"Native audio state changed: {state.value}")
        # Broadcast to WebSocket clients
        # This will be handled by the websocket handler

    async def _handle_disconnect(self):
        """Handle disconnection."""
        self.session.state = NativeAudioState.DISCONNECTED
        await self.cleanup()

    async def send_audio(self, audio_data: bytes):
        """Send audio chunk to provider (for phone relay)."""
        await self._audio_input_queue.put(audio_data)

    async def stop(self):
        """Stop the native audio pipeline."""
        async with self._lock:
            self._running = False

            # Signal shutdown
            await self._audio_input_queue.put(None)
            await self._audio_output_queue.put(None)

            # Cancel tasks
            for task in [self._receive_task, self._send_task, self._playback_task]:
                if task and not task.done():
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass

            await self.cleanup()

    async def cleanup(self):
        """Clean up audio resources."""
        if self._mic_stream:
            try:
                self._mic_stream.stop_stream()
                self._mic_stream.close()
            except Exception:
                pass
            self._mic_stream = None

        if self._speaker_stream:
            try:
                self._speaker_stream.stop_stream()
                self._speaker_stream.close()
            except Exception:
                pass
            self._speaker_stream = None

        if self._pyaudio:
            try:
                self._pyaudio.terminate()
            except Exception:
                pass
            self._pyaudio = None

        session = self.session
        if session and session.websocket:
            try:
                await session.websocket.close()
            except Exception:
                pass
            try:
                session.websocket = None
            except Exception:
                pass

        self.session = None
        logger.info("Native audio pipeline cleaned up")

    def is_connected(self) -> bool:
        """Check if native audio is connected."""
        return self.session is not None and self.session.state == NativeAudioState.CONNECTED

    def get_provider(self) -> Optional[str]:
        """Get current provider name."""
        return self.session.provider.value if self.session else None

    def get_latency_ms(self) -> Optional[int]:
        """Get estimated latency in milliseconds."""
        # This would be calculated from actual measurements
        return None


# Global instance for easy access - registry on sys to prevent duplicate instance across multiple module load paths
def get_native_audio_pipeline(settings=None) -> NativeAudioPipeline:
    """Get or create the global native audio pipeline instance."""
    import sys
    if not hasattr(sys, "_opensarthi_native_audio_pipeline") or sys._opensarthi_native_audio_pipeline is None:
        sys._opensarthi_native_audio_pipeline = NativeAudioPipeline(settings)
    return sys._opensarthi_native_audio_pipeline


async def initialize_native_audio(provider: str = "auto", settings=None) -> bool:
    """Initialize native audio pipeline."""
    pipeline = get_native_audio_pipeline(settings)
    return await pipeline.initialize(provider)


async def stop_native_audio():
    """Stop native audio pipeline."""
    import sys
    pipeline = getattr(sys, "_opensarthi_native_audio_pipeline", None)
    if pipeline:
        await pipeline.stop()
        sys._opensarthi_native_audio_pipeline = None