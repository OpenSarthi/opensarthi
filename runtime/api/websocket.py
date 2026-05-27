import asyncio
import uuid
import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Any

from planner.agent import agent, AgentDependencies
from voice.pipeline import VoicePipeline

logger = structlog.get_logger()
router = APIRouter()

class Session:
    def __init__(self, websocket: WebSocket):
        self.ws = websocket
        self.session_id = str(uuid.uuid4())
        self.voice_pipeline = VoicePipeline()
        loop = asyncio.get_event_loop()
        self.voice_pipeline.on_voice_state = lambda state: asyncio.run_coroutine_threadsafe(
            self.send_message("voice_state", {"state": state}),
            loop
        )
        async def log_action_cb(tool: str, description: str, status: str, result: Any = None):
            await self.send_message("tool_action", {
                "tool": tool,
                "description": description,
                "status": status,
                "result": result
            })

        self.deps = AgentDependencies(
            log_action=log_action_cb
        )
        import db
        self.thread_id = db.create_thread()

    async def send_message(self, msg_type: str, payload: dict):
        msg = {
            "id": str(uuid.uuid4()),
            "type": msg_type,
            "payload": payload,
            "timestamp": int(asyncio.get_event_loop().time() * 1000)
        }
        await self.ws.send_json(msg)

    async def request_permission(self, tool_name: str, args: dict) -> bool:
        """Ask user for permission to execute a dangerous tool, yielding control back on response."""
        from state_machine import AgentState
        self.pending_input = asyncio.Future()
        try:
            req_id = str(uuid.uuid4())
            await self.send_message("permission_request", {
                "request_id": req_id,
                "tool": tool_name,
                "args": args,
                "risk_level": "dangerous",
                "description": f"Execute dangerous action: {tool_name} with arguments {args}?",
                "timeout_seconds": 30
            })
            if hasattr(self, '_current_runtime') and self._current_runtime:
                await self._current_runtime._transition(AgentState.ASKING_PERMISSION)
                
            response = await self.pending_input
            return response.get("allow", response.get("approved", False))
        finally:
            self.pending_input = None

    async def request_user_input(self, prompt: str, input_type: str = "text") -> str:
        """Ask user for arbitrary text input (e.g. password for sudo), yielding control back on response."""
        from state_machine import AgentState
        self.pending_input = asyncio.Future()
        try:
            await self.send_message("input_request", {
                "prompt": prompt,
                "input_type": input_type
            })
            if hasattr(self, '_current_runtime') and self._current_runtime:
                await self._current_runtime._transition(AgentState.ASKING_PERMISSION)
                
            response = await self.pending_input
            return response.get("value", "")
        finally:
            self.pending_input = None

    async def emit_state(self, state_ctx):
        """Broadcast current agent state to the frontend UI."""
        await self.send_message("agent_state", state_ctx.to_dict())


    async def speak(self, text: str):
        """Play speech and broadcast speech status events to the client."""
        try:
            await self.send_message("speech_started", {})
            await self.voice_pipeline.speak(text)
        finally:
            await self.send_message("speech_completed", {})

    async def speak_and_send_audio(self, text: str):
        try:
            from gtts import gTTS
            import base64
            import os
            import tempfile
            
            # Synthesize premium voice
            tts = gTTS(text=text, lang='en', tld='com')
            temp_file = os.path.join(tempfile.gettempdir(), "opensarthi_voice.mp3")
            tts.save(temp_file)
            
            # Read and encode to base64
            with open(temp_file, "rb") as f:
                audio_bytes = f.read()
            base64_audio = base64.b64encode(audio_bytes).decode('utf-8')
            
            # Send to frontend!
            await self.send_message("audio_output", {
                "audio": base64_audio
            })
            logger.info("Sent premium base64 audio to frontend")
            
            # Clean up
            try:
                os.remove(temp_file)
            except Exception:
                pass
        except Exception as e:
            logger.error("Failed to speak and send audio base64", error=str(e))

    async def handle_user_message(self, text: str, source: str = "text"):
        logger.info("Processing user message", text=text, source=source)
        
        try:
            import db
            import time
            import os
            msg_id = str(uuid.uuid4())
            timestamp = int(time.time() * 1000)
            db.save_message(self.thread_id, msg_id, "user", text, timestamp)

            from config import settings, get_active_api_key
            provider = settings.ai_provider.lower()
            model_name = settings.cloud_model.lower()
            api_key = get_active_api_key()

            is_cloud = True
            # --- Build the active model based on selected provider ---
            if provider == "ollama":
                from pydantic_ai.models.ollama import OllamaModel
                active_model = OllamaModel(settings.local_model)
                is_cloud = False
            elif provider == "google":
                if api_key:
                    os.environ["GEMINI_API_KEY"] = api_key
                from pydantic_ai.models.gemini import GeminiModel
                active_model = GeminiModel(settings.cloud_model)
            elif provider == "anthropic":
                if api_key:
                    os.environ["ANTHROPIC_API_KEY"] = api_key
                from pydantic_ai.models.anthropic import AnthropicModel
                active_model = AnthropicModel(settings.cloud_model)
            elif provider == "groq":
                if api_key:
                    os.environ["GROQ_API_KEY"] = api_key
                # Groq uses the OpenAI-compatible API
                from pydantic_ai.models.openai import OpenAIModel
                from pydantic_ai.providers.openai import OpenAIProvider
                active_model = OpenAIModel(
                    model_name=settings.cloud_model,
                    provider=OpenAIProvider(
                        base_url="https://api.groq.com/openai/v1",
                        api_key=api_key or "noop",
                    )
                )
            elif provider == "openai":
                if api_key:
                    os.environ["OPENAI_API_KEY"] = api_key
                from pydantic_ai.models.openai import OpenAIModel
                from pydantic_ai.providers.openai import OpenAIProvider
                active_model = OpenAIModel(
                    model_name=settings.cloud_model,
                    provider=OpenAIProvider(
                        base_url="https://api.openai.com/v1",
                        api_key=api_key or "noop",
                    )
                )
            elif provider == "openrouter":
                if api_key:
                    os.environ["OPENROUTER_API_KEY"] = api_key
                from pydantic_ai.models.openai import OpenAIModel
                from pydantic_ai.providers.openai import OpenAIProvider
                active_model = OpenAIModel(
                    model_name=settings.cloud_model,
                    provider=OpenAIProvider(
                        base_url="https://openrouter.ai/api/v1",
                        api_key=api_key or "noop",
                    )
                )
            else:
                raise Exception(f"Unsupported AI provider: {provider}")

            from pydantic_ai.messages import ModelRequest, ModelResponse, UserPromptPart, TextPart
            
            # Fetch message history (all messages saved so far in this thread)
            history_messages = db.get_history(self.thread_id)
            
            # Trim to last 20 messages to stay within context limits (skip the current prompt which is last)
            MAX_HISTORY = 20
            trimmed_history = history_messages[:-1]
            if len(trimmed_history) > MAX_HISTORY:
                trimmed_history = trimmed_history[-MAX_HISTORY:]
            
            message_history = []
            for msg in trimmed_history:
                if msg["role"] == "user":
                    message_history.append(ModelRequest(parts=[UserPromptPart(content=msg["content"])]))
                elif msg["role"] == "assistant":
                    message_history.append(ModelResponse(parts=[TextPart(content=msg["content"])]))

            from agent_runtime import AgentRuntime
            from observation import DesktopObserver

            observer = DesktopObserver()
            runtime = AgentRuntime(ws_handler=self, agent=agent, observer=observer, deps=self.deps)
            self._current_runtime = runtime

            prefix_warning = ""
            usage = None
            try:
                final_output = await runtime.run(
                    goal=text,
                    model=active_model,
                    message_history=message_history
                )
                usage = runtime.last_usage
            except Exception as e:
                logger.error("Agent execution failed", error=str(e))
                raise e

            # Extract token usage
            try:
                request_tokens = getattr(usage, "request_tokens", 0) or 0
                response_tokens = getattr(usage, "response_tokens", 0) or 0
                total_tokens = getattr(usage, "total_tokens", 0) or (request_tokens + response_tokens)
            except Exception:
                request_tokens = 0
                response_tokens = 0
                total_tokens = 0
            
            ast_msg_id = str(uuid.uuid4())
            ast_timestamp = int(time.time() * 1000)
            db.save_message(self.thread_id, ast_msg_id, "assistant", final_output, ast_timestamp)

            # Send the assistant's response back to the UI with token usage
            await self.send_message("assistant_response", {
                "id": ast_msg_id,
                "role": "assistant",
                "content": final_output,
                "timestamp": ast_timestamp,
                "is_voice": source == "voice",
                "usage": {
                    "request_tokens": request_tokens,
                    "response_tokens": response_tokens,
                    "total_tokens": total_tokens,
                }
            })

        except Exception as e:
            logger.error("Agent execution failed", error=str(e))
            await self.send_message("error", {"error": str(e)})

    async def process_incoming(self, data: dict):
        msg_type = data.get("type")
        payload = data.get("payload", {})

        if msg_type == "user_message":
            await self.handle_user_message(payload.get("text", ""), source=payload.get("source", "text"))
        elif msg_type == "session_state":
            pass # Keep mic listening for continuous wake word
        elif msg_type == "voice_state":
            state = payload.get("state")
            if state == "listening":
                import time
                self.voice_pipeline.is_recording_command = True
                self.voice_pipeline._speech_buffer = []
                self.voice_pipeline.last_speech_time = time.time()
                self.voice_pipeline.start_recording_time = time.time()
                logger.info("[WebSocket] Manual voice listening triggered by user. Bypassing wake word.")
            elif state == "idle":
                self.voice_pipeline.is_recording_command = False
                logger.info("[WebSocket] Manual voice listening stopped by user.")
        elif msg_type == "new_chat":
            import db
            self.thread_id = db.create_thread()
            logger.info("Created new chat thread", thread_id=self.thread_id)
        elif msg_type == "cancel_execution":
            if hasattr(self, '_current_runtime') and self._current_runtime:
                self._current_runtime.request_cancel()
                await self.send_message("agent_state", {
                    "state": "idle",
                    "goal": None,
                    "step": 0,
                    "step_description": None,
                    "total_steps": 0,
                    "retry_count": 0,
                    "error": None
                })
        elif msg_type == "pause_execution":
            if hasattr(self, '_current_runtime') and self._current_runtime:
                self._current_runtime.pause()
                await self.send_message("task_paused", {})
                logger.info("Task execution paused")
        elif msg_type == "resume_execution":
            if hasattr(self, '_current_runtime') and self._current_runtime:
                self._current_runtime.resume()
                await self.send_message("task_resumed", {})
                logger.info("Task execution resumed")
        elif msg_type == "permission_response":
            if hasattr(self, 'pending_input') and self.pending_input and not self.pending_input.done():
                self.pending_input.set_result(payload)
        elif msg_type == "input_response":
            if hasattr(self, 'pending_input') and self.pending_input and not self.pending_input.done():
                self.pending_input.set_result(payload)
        elif msg_type == "get_history":
            import db
            threads = db.get_all_threads()
            await self.send_message("history_response", {"threads": threads})
        elif msg_type == "delete_thread":
            import db
            tid = payload.get("thread_id")
            if tid:
                db.delete_thread(tid)
                logger.info("Deleted thread", thread_id=tid)
                if self.thread_id == tid:
                    self.thread_id = db.create_thread()
                threads = db.get_all_threads()
                await self.send_message("history_response", {"threads": threads})
        elif msg_type == "delete_all_threads":
            import db
            db.delete_all_threads()
            logger.info("Deleted all threads")
            self.thread_id = db.create_thread()
            threads = db.get_all_threads()
            await self.send_message("history_response", {"threads": threads})
        elif msg_type == "speak_text":
            text = payload.get("text", "")
            if text:
                import re
                # Strip <think>...</think> blocks from the text before speaking
                clean_text = re.sub(r'<think>[\s\S]*?</think>', '', text)
                # Strip markdown elements so the voice engine reads cleanly
                clean_text = re.sub(r'```[\s\S]*?```', '', clean_text)
                clean_text = re.sub(r'`([^`]+)`', r'\1', clean_text)
                clean_text = re.sub(r'[*#_\-]', '', clean_text)
                # Strip raw JSON plan blocks
                clean_text = re.sub(r'\[\s*\{[\s\S]*?\}\s*\]', '', clean_text)
                clean_text = clean_text.strip()
                if clean_text:
                    logger.info("Replaying speech synthesis via WebSocket request", text=clean_text)
                    asyncio.create_task(self.speak(clean_text))
        elif msg_type == "stop_speech":
            logger.info("Received request to stop speech synthesis")
            if hasattr(self, 'voice_pipeline') and self.voice_pipeline:
                self.voice_pipeline.stop_speaking()
            await self.send_message("speech_completed", {})
        elif msg_type == "load_thread":
            import db
            thread_id = payload.get("thread_id")
            self.thread_id = thread_id
            messages = db.get_history(thread_id)
            await self.send_message("thread_loaded", {"thread_id": thread_id, "messages": messages})
        elif msg_type == "update_settings":
            from config import settings, save_settings_to_env
            import os
            settings.local_model = payload.get("local_model", settings.local_model)
            settings.cloud_model = payload.get("cloud_model", settings.cloud_model)
            settings.ai_provider = payload.get("ai_provider", settings.ai_provider)
            
            # Per-provider API key retention: only update if a non-empty value is provided
            def _update_key(field: str, env_var: str):
                new_val = payload.get(field)
                if new_val and new_val.strip():
                    setattr(settings, field, new_val.strip())
                    os.environ[env_var] = new_val.strip()
            
            _update_key("gemini_api_key", "GEMINI_API_KEY")
            _update_key("openai_api_key", "OPENAI_API_KEY")
            _update_key("anthropic_api_key", "ANTHROPIC_API_KEY")
            _update_key("groq_api_key", "GROQ_API_KEY")
            _update_key("openrouter_api_key", "OPENROUTER_API_KEY")
                
            settings.voice_accent = payload.get("voice_accent", settings.voice_accent)
            settings.voice_speed = float(payload.get("voice_speed", settings.voice_speed))
            settings.continuous_listening = bool(payload.get("continuous_listening", settings.continuous_listening))
            settings.active_theme = payload.get("active_theme", settings.active_theme)
            
            # Wake word settings
            raw_wake = payload.get("wake_words")
            if raw_wake is not None:
                if isinstance(raw_wake, str):
                    settings.wake_words = [w.strip() for w in raw_wake.split(",") if w.strip()]
                elif isinstance(raw_wake, list):
                    settings.wake_words = [str(w).strip() for w in raw_wake if str(w).strip()]
            
            settings.wake_word_enabled = bool(payload.get("wake_word_enabled", settings.wake_word_enabled))
            settings.wake_word_threshold = float(payload.get("wake_word_threshold", settings.wake_word_threshold))

            save_settings_to_env(
                settings.local_model,
                settings.cloud_model,
                settings.ai_provider,
                settings.gemini_api_key,
                settings.openai_api_key,
                settings.anthropic_api_key,
                settings.groq_api_key,
                settings.openrouter_api_key,
                settings.voice_accent,
                settings.voice_speed,
                settings.continuous_listening,
                settings.active_theme,
                settings.wake_words,
                settings.wake_word_enabled,
                settings.wake_word_threshold
            )
            
            # Propagate to running voice pipeline
            if hasattr(self, 'voice_pipeline') and self.voice_pipeline:
                try:
                    self.voice_pipeline.wake_detector.update_phrases(settings.wake_words)
                    self.voice_pipeline.wake_detector.threshold = settings.wake_word_threshold
                except Exception as ve:
                    logger.warning("Failed to propagate wake word updates to pipeline", error=str(ve))
            
            logger.info("Settings updated", provider=settings.ai_provider, model=settings.cloud_model)

    async def _listen_loop(self):
        """Simulate sending transcript updates."""
        async for transcript in self.voice_pipeline.start_listening():
            await self.send_message("transcript_update", {"text": transcript})

class ConnectionManager:
    def __init__(self):
        self.sessions: dict[WebSocket, Session] = {}

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        session = Session(websocket)
        self.sessions[websocket] = session
        logger.info("Client connected", session_id=session.session_id)
        
        # Eagerly pre-load voice models in the background to prevent lazy-loading lag spikes and websocket connection timeout
        async def init_task():
            try:
                await session.voice_pipeline.initialize()
            except Exception as e:
                logger.error("Failed to initialize voice pipeline models", error=str(e))
        asyncio.create_task(init_task())
        
        # Send current settings on startup
        from config import settings
        await session.send_message("settings_sync", {
            "local_model": settings.local_model,
            "cloud_model": settings.cloud_model,
            "ai_provider": settings.ai_provider,
            "gemini_api_key": settings.gemini_api_key or "",
            "openai_api_key": settings.openai_api_key or "",
            "anthropic_api_key": settings.anthropic_api_key or "",
            "groq_api_key": settings.groq_api_key or "",
            "openrouter_api_key": settings.openrouter_api_key or "",
            "voice_accent": settings.voice_accent,
            "voice_speed": settings.voice_speed,
            "continuous_listening": settings.continuous_listening,
            "active_theme": getattr(settings, "active_theme", "theme-red-black"),
            "wake_words": getattr(settings, "wake_words", ["hey sarthi", "hello sarthi"]),
            "wake_word_enabled": getattr(settings, "wake_word_enabled", True),
            "wake_word_threshold": getattr(settings, "wake_word_threshold", 0.5)
        })
        
        asyncio.create_task(session._listen_loop())
        return session

    def disconnect(self, websocket: WebSocket):
        if websocket in self.sessions:
            session = self.sessions.pop(websocket)
            session.voice_pipeline.stop_listening()
            logger.info("Client disconnected", session_id=session.session_id)

manager = ConnectionManager()

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    session = await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_json()
            await session.process_incoming(data)
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error("WebSocket error", error=str(e))
        manager.disconnect(websocket)
