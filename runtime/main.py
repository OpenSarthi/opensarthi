import asyncio
import socket
import sys
from contextlib import asynccontextmanager
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import structlog

from api.routes import router as api_router
from api.websocket import router as ws_router
from mcp import mcp_router

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(application: FastAPI):
    # ── Startup ──────────────────────────────────────────────────────────────
    try:
        from tools.google_tools import start_oauth_callback_server
        start_oauth_callback_server(8765)
    except Exception as e:
        logger.warning("Failed to initialize background OAuth callback server", error=str(e))
    yield
    # ── Shutdown ─────────────────────────────────────────────────────────────
    logger.info("Stopping OpenSarthi runtime, cleaning up active services...")
    try:
        from tools.google_tools import stop_oauth_callback_server
        stop_oauth_callback_server()
    except Exception:
        pass
    try:
        from dashboard.server import dashboard_server
        dashboard_server.stop()
    except Exception as e:
        logger.error("Failed to stop dashboard server during shutdown", error=str(e))


app = FastAPI(title="OpenSarthi Runtime", lifespan=lifespan)

# Allow requests from Tauri frontend (dev: localhost:1420, prod: tauri://localhost)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)
app.include_router(ws_router)
app.include_router(mcp_router)



def get_free_port() -> int:
    """Get a random free port from the OS."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        return s.getsockname()[1]

if __name__ == "__main__":
    # If a specific port is passed (e.g. during dev), use it. Otherwise find a free one.
    port = int(sys.argv[1]) if len(sys.argv) > 1 else get_free_port()
    
    # ─── CRITICAL: Print port for Tauri sidecar manager ───
    print(f"PORT:{port}", flush=True)
    # ──────────────────────────────────────────────────────
    
    logger.info("Starting OpenSarthi runtime server", port=port, sys_executable=sys.executable)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
