import asyncio
import uuid
import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

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
        self.deps = AgentDependencies(
            desktop=self.desktop_tools,
            system=self.system_tools
        )

    async def send_message(self, msg_type: str, payload: dict):
        msg = {
            "id": str(uuid.uuid4()),
            "type": msg_type,
            "payload": payload,
            "timestamp": int(asyncio.get_event_loop().time() * 1000)
        }
        await self.ws.send_json(msg)

    async def handle_user_message(self, text: str):
        logger.info("Processing user message", text=text)
        
        # In a full implementation, we'd manage conversation history here
        # For now, just run the agent on the current input
        try:
            result = await agent.run(text, deps=self.deps)
            
            # Send the assistant's response back to the UI
            await self.send_message("assistant_response", {
                "id": str(uuid.uuid4()),
                "role": "assistant",
                "content": result.data,
                "timestamp": int(asyncio.get_event_loop().time() * 1000)
            })
            
            # Trigger TTS for the response
            # audio_path = await self.voice_pipeline.speak(result.data)
            # await self.send_message("audio_state", {"playing": True, "path": audio_path})
            
        except Exception as e:
            logger.error("Agent execution failed", error=str(e))
            await self.send_message("error", {"error": str(e)})

    async def process_incoming(self, data: dict):
        msg_type = data.get("type")
        payload = data.get("payload", {})

        if msg_type == "user_message":
            await self.handle_user_message(payload.get("text", ""))
        elif msg_type == "session_state":
            active = payload.get("active", False)
            if active:
                asyncio.create_task(self._listen_loop())
            else:
                self.voice_pipeline.stop_listening()

    async def _listen_loop(self):
        """Simulate sending transcript updates."""
        await self.send_message("session_state", {"voiceState": "listening"})
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
