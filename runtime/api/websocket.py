import asyncio
import uuid
import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Any

from planner.agent import agent, AgentDependencies
from tools.desktop import DesktopTools
from tools.system import SystemTools
from voice.pipeline import VoicePipeline

logger = structlog.get_logger()
router = APIRouter()

class Session:
    def __init__(self, websocket: WebSocket):
        self.ws = websocket
        self.session_id = str(uuid.uuid4())
        self.desktop_tools = DesktopTools()
        self.system_tools = SystemTools()
        self.voice_pipeline = VoicePipeline()
        async def log_action_cb(tool: str, description: str, status: str, result: Any = None):
            await self.send_message("tool_action", {
                "tool": tool,
                "description": description,
                "status": status,
                "result": result
            })

        self.deps = AgentDependencies(
            desktop=self.desktop_tools,
            system=self.system_tools,
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
            
            # Synthesize premium voice
            tts = gTTS(text=text, lang='en', tld='com')
            temp_file = "/tmp/opensarthi_voice.mp3"
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
            msg_id = str(uuid.uuid4())
            timestamp = int(time.time() * 1000)
            db.save_message(self.thread_id, msg_id, "user", text, timestamp)

            from config import settings
            model_name = settings.cloud_model.lower()
            
            # Use the provided API key (stored in gemini_api_key field generically)
            api_key = settings.gemini_api_key
            import os

            if api_key:
                if "gemini" in model_name:
                    os.environ["GEMINI_API_KEY"] = api_key
                elif "claude" in model_name:
                    os.environ["ANTHROPIC_API_KEY"] = api_key
                else:
                    os.environ["OPENAI_API_KEY"] = api_key

            if "gemini" in model_name:
                from pydantic_ai.models.gemini import GeminiModel
                active_model = GeminiModel(settings.cloud_model)
            elif "claude" in model_name:
                from pydantic_ai.models.anthropic import AnthropicModel
                active_model = AnthropicModel(settings.cloud_model)
            elif "gpt" in model_name or "kimi" in model_name or "moonshot" in model_name or "deepseek" in model_name or "openrouter" in model_name:
                from pydantic_ai.models.openai import OpenAIModel
                from pydantic_ai.providers.openai import OpenAIProvider
                
                base_url = "https://api.openai.com/v1"
                if "kimi" in model_name or "moonshot" in model_name:
                    base_url = "https://api.moonshot.cn/v1"
                elif "deepseek" in model_name:
                    base_url = "https://api.deepseek.com/v1"
                elif "openrouter" in model_name:
                    base_url = "https://openrouter.ai/api/v1"
                
                active_model = OpenAIModel(
                    model_name=settings.cloud_model,
                    provider=OpenAIProvider(
                        base_url=base_url,
                        api_key=api_key or "noop",
                    )
                )
            else:
                from pydantic_ai.models.ollama import OllamaModel
                active_model = OllamaModel(settings.local_model)

            try:
                result = await agent.run(text, deps=self.deps, model=active_model)
                prefix_warning = ""
            except Exception as cloud_err:
                is_using_cloud = ("gemini" in model_name or "claude" in model_name or "gpt" in model_name or "kimi" in model_name or "moonshot" in model_name or "deepseek" in model_name or "openrouter" in model_name)
                if not is_using_cloud:
                    raise cloud_err
                
                logger.warning("Cloud agent execution failed, falling back to local model...", error=str(cloud_err))
                from pydantic_ai.models.ollama import OllamaModel
                fallback_local_model = OllamaModel(settings.local_model)
                result = await agent.run(text, deps=self.deps, model=fallback_local_model)
                prefix_warning = f"⚠️ **Cloud Model Failed** ({str(cloud_err)[:80]}...)\n*Fell back to local model: `{settings.local_model}`*\n\n---\n\n"

            final_output = prefix_warning + result.output
            
            ast_msg_id = str(uuid.uuid4())
            ast_timestamp = int(time.time() * 1000)
            db.save_message(self.thread_id, ast_msg_id, "assistant", final_output, ast_timestamp)

            # Send the assistant's response back to the UI
            await self.send_message("assistant_response", {
                "id": ast_msg_id,
                "role": "assistant",
                "content": final_output,
                "timestamp": ast_timestamp,
                "is_voice": source == "voice"
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
        elif msg_type == "new_chat":
            import db
            self.thread_id = db.create_thread()
            logger.info("Created new chat thread", thread_id=self.thread_id)
        elif msg_type == "get_history":
            import db
            threads = db.get_all_threads()
            await self.send_message("history_response", {"threads": threads})
        elif msg_type == "speak_text":
            text = payload.get("text", "")
            if text:
                import re
                # Strip markdown elements so the voice engine reads cleanly
                clean_text = re.sub(r'```[\s\S]*?```', '', text)
                clean_text = re.sub(r'`([^`]+)`', r'\1', clean_text)
                clean_text = re.sub(r'[*#_\-]', '', clean_text)
                clean_text = clean_text.strip()
                if clean_text:
                    logger.info("Replaying speech synthesis via WebSocket request", text=clean_text)
                    asyncio.create_task(self.speak(clean_text))
        elif msg_type == "load_thread":
            import db
            thread_id = payload.get("thread_id")
            self.thread_id = thread_id
            messages = db.get_history(thread_id)
            await self.send_message("thread_loaded", {"thread_id": thread_id, "messages": messages})
        elif msg_type == "update_settings":
            from config import settings, save_settings_to_env
            settings.local_model = payload.get("local_model", settings.local_model)
            settings.cloud_model = payload.get("cloud_model", settings.cloud_model)
            
            # API Key Retention: Only update if a non-empty string is provided
            new_api_key = payload.get("gemini_api_key")
            if new_api_key and new_api_key.strip():
                settings.gemini_api_key = new_api_key.strip()
                
            settings.voice_accent = payload.get("voice_accent", settings.voice_accent)
            settings.voice_speed = float(payload.get("voice_speed", settings.voice_speed))
            settings.continuous_listening = bool(payload.get("continuous_listening", settings.continuous_listening))
            settings.active_theme = payload.get("active_theme", settings.active_theme)
            
            save_settings_to_env(
                settings.local_model, 
                settings.cloud_model, 
                settings.gemini_api_key,
                settings.voice_accent,
                settings.voice_speed,
                settings.continuous_listening,
                settings.active_theme
            )
            if settings.gemini_api_key:
                import os
                os.environ["GEMINI_API_KEY"] = settings.gemini_api_key
            # Simply save changes in the sidecar environment without pushing entries to the chat history overlay
            pass

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
        
        # Send current settings on startup
        from config import settings
        await session.send_message("settings_sync", {
            "local_model": settings.local_model,
            "cloud_model": settings.cloud_model,
            "gemini_api_key": settings.gemini_api_key or "",
            "voice_accent": settings.voice_accent,
            "voice_speed": settings.voice_speed,
            "continuous_listening": settings.continuous_listening,
            "active_theme": getattr(settings, "active_theme", "theme-red-black")
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
