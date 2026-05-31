import asyncio
import socket
import sys
import uvicorn
from fastapi import FastAPI
import structlog

from api.routes import router as api_router
from api.websocket import router as ws_router
from mcp import mcp_router

logger = structlog.get_logger()

app = FastAPI(title="OpenSarthi Runtime")

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
