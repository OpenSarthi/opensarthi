"""
runtime/dashboard/server.py
Dashboard server for mobile control of OpenSarthi.
Listens on port 8765. Same WiFi required.
Uses AES-256-CBC for encrypting WebSocket payloads.
"""

import asyncio
import base64
import hashlib
import io
import re
import secrets
import socket
import string
import time
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse, JSONResponse
import uvicorn
import qrcode

PORT = 8765
BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = Path(__file__).resolve().parent / "static"

_KEY_CHARS = [c for c in (string.ascii_uppercase + string.digits)
              if c not in ('O', 'I', 'L', '0', '1')]
_AES_SALT = b'OPENSARTHI-DASHBOARD-v1'


def _derive_key(session_key: str) -> bytes:
    return hashlib.sha256(session_key.encode('utf-8') + _AES_SALT).digest()


def _decrypt_cbc(aes_key: bytes, enc_b64: str) -> str:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    from cryptography.hazmat.primitives import padding as sym_pad
    raw = base64.b64decode(enc_b64)
    iv, ct = raw[:16], raw[16:]
    dec = Cipher(algorithms.AES(aes_key), modes.CBC(iv)).decryptor()
    padded = dec.update(ct) + dec.finalize()
    unpadder = sym_pad.PKCS7(128).unpadder()
    return (unpadder.update(padded) + unpadder.finalize()).decode('utf-8')


def _local_ip() -> str:
    """Return the best LAN-facing IPv4 address, no internet required."""
    for probe in ("8.8.8.8", "1.1.1.1", "192.168.1.1"):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.settimeout(0.5)
            s.connect((probe, 80))
            ip = s.getsockname()[0]
            s.close()
            if not ip.startswith("127."):
                return ip
        except Exception:
            pass
    try:
        ip = socket.gethostbyname(socket.gethostname())
        if not ip.startswith("127."):
            return ip
    except Exception:
        pass
    return "127.0.0.1"


def _kill_port_owner(port: int) -> bool:
    """
    Terminate any process listening on *port* using psutil.
    Returns True if a process was killed, False if the port was already free.
    """
    try:
        import psutil
        killed = False
        for conn in psutil.net_connections(kind="tcp"):
            if conn.laddr.port == port and conn.status == "LISTEN" and conn.pid:
                try:
                    proc = psutil.Process(conn.pid)
                    proc.terminate()
                    proc.wait(timeout=2)
                    killed = True
                except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.TimeoutExpired):
                    pass
        return killed
    except Exception:
        return False


class DashboardServer:
    def __init__(self):
        self._ip = _local_ip()
        self._tokens: set[str] = set()
        self._token_keys: dict[str, str] = {}  # auth_token -> session_key
        self._aes_cache: dict[str, bytes] = {}  # session_key -> AES bytes
        self._clients: set[WebSocket] = set()
        self._device_info: dict[WebSocket, str] = {}
        self._pending_keys: dict[str, float] = {}  # key -> expiry
        self._device_sessions: dict[str, dict] = {}  # device_token -> {session_key}
        self._history: list[dict] = []
        self._server_task: asyncio.Task | None = None
        self._running = False
        self.app = self._build_app()

    def new_key(self, expiry_secs: int = 600) -> str:
        now = time.time()
        self._pending_keys = {k: v for k, v in self._pending_keys.items() if v > now}
        key = ''.join(secrets.choice(_KEY_CHARS) for _ in range(6))
        self._pending_keys[key] = now + expiry_secs
        return key

    def get_url(self) -> str:
        return f"http://{self._ip}:{PORT}"

    def get_pairing_info(self) -> dict:
        key = self.new_key()
        url = f"http://{self._ip}:{PORT}/auto-login?key={key}"
        
        # Generate QR code
        qr = qrcode.QRCode(box_size=4, border=2)
        qr.add_data(url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        qr_base64 = base64.b64encode(buf.getvalue()).decode('utf-8')

        return {
            "key": key,
            "url": url,
            "qr": qr_base64
        }

    def _aes_key(self, session_key: str) -> bytes:
        if session_key not in self._aes_cache:
            self._aes_cache[session_key] = _derive_key(session_key)
        return self._aes_cache[session_key]

    def _decrypt(self, token: str, enc_b64: str) -> str | None:
        sk = self._token_keys.get(token)
        if not sk:
            return None
        try:
            return _decrypt_cbc(self._aes_key(sk), enc_b64)
        except Exception:
            return None

    async def broadcast(self, msg_type: str, payload: dict):
        msg = {
            "type": msg_type,
            "payload": payload,
            "timestamp": int(time.time() * 1000)
        }
        self._history.append(msg)
        if len(self._history) > 100:
            self._history = self._history[-100:]
        dead: set[WebSocket] = set()
        for ws in list(self._clients):
            try:
                await ws.send_json(msg)
            except Exception:
                dead.add(ws)
        self._clients -= dead

    def _build_app(self) -> FastAPI:
        app = FastAPI(docs_url=None, redoc_url=None)

        def _auth(req: Request) -> bool:
            tok = req.headers.get("authorization", "").removeprefix("Bearer ").strip()
            return bool(tok) and tok in self._tokens

        @app.get("/", response_class=HTMLResponse)
        async def index():
            html_file = STATIC_DIR / "index.html"
            if html_file.exists():
                return HTMLResponse(html_file.read_text(encoding="utf-8"))
            return HTMLResponse("<h3>Dashboard UI template loading...</h3>")

        @app.post("/login")
        async def login(req: Request):
            body = await req.json()
            entered = str(body.get("pin", "")).strip().upper()
            now = time.time()
            if entered in self._pending_keys and self._pending_keys[entered] > now:
                del self._pending_keys[entered]
                tok = secrets.token_urlsafe(32)
                self._tokens.add(tok)
                self._token_keys[tok] = entered
                self._aes_key(entered)
                asyncio.create_task(self.broadcast("sys", {"text": "Remote connection established."}))
                return JSONResponse({"ok": True, "token": tok})
            return JSONResponse({"ok": False, "error": "Invalid or expired key"}, status_code=401)

        @app.get("/auto-login")
        async def auto_login(key: str = ""):
            now = time.time()
            if not key or key not in self._pending_keys or self._pending_keys[key] <= now:
                return HTMLResponse("<h3>Link Expired</h3><p>Generate a new QR code in Settings.</p>")

            del self._pending_keys[key]
            tok = secrets.token_urlsafe(32)
            dev_tok = secrets.token_urlsafe(32)
            self._tokens.add(tok)
            self._token_keys[tok] = key
            self._aes_key(key)
            self._device_sessions[dev_tok] = {"session_key": key}

            asyncio.create_task(self.broadcast("sys", {"text": "Remote connection established via QR."}))

            return HTMLResponse(f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width">
<style>
  body{{background:#07090f;color:#dde3ed;font-family:sans-serif;
       display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}}
  p{{color:#5e6a7e;font-size:14px}}
</style></head>
<body>
<script>
  sessionStorage.setItem('os_remote_token','{tok}');
  sessionStorage.setItem('os_remote_key','{key}');
  localStorage.setItem('os_remote_device_token','{dev_tok}');
  setTimeout(function(){{location.replace('/')}},400);
</script>
<p>Connecting to OpenSarthi…</p>
</body></html>""")

        @app.post("/api/device-login")
        async def device_login_ep(req: Request):
            try:
                body = await req.json()
            except Exception:
                return JSONResponse({"ok": False}, status_code=400)
            dev_tok = (body.get("device_token") or "").strip()
            if not dev_tok or dev_tok not in self._device_sessions:
                return JSONResponse({"ok": False}, status_code=401)
            session_key = self._device_sessions[dev_tok]["session_key"]
            tok = secrets.token_urlsafe(32)
            self._tokens.add(tok)
            self._token_keys[tok] = session_key
            self._aes_key(session_key)
            asyncio.create_task(self.broadcast("sys", {"text": "Known device reconnected automatically."}))
            return JSONResponse({"ok": True, "token": tok, "key": session_key})

        @app.websocket("/ws")
        async def ws_ep(websocket: WebSocket, token: str = ""):
            tok = token.strip()
            if not tok or tok not in self._tokens:
                await websocket.close(code=4001)
                return
            await websocket.accept()
            self._clients.add(websocket)
            
            # Extract client metadata
            ua = websocket.headers.get("user-agent", "Unknown Browser")
            device = "Mobile Device"
            if "iPhone" in ua:
                device = "iPhone"
            elif "Android" in ua:
                device = "Android Device"
            elif "iPad" in ua:
                device = "iPad"
            
            ip = websocket.client.host if websocket.client else "Unknown IP"
            self._device_info[websocket] = f"{device} ({ip})"
            
            # Send initial history
            for entry in self._history[-50:]:
                try:
                    await websocket.send_json(entry)
                except Exception:
                    break
            
            try:
                from api.websocket import manager as ws_manager
                while True:
                    data = await websocket.receive_json()
                    if data.get("type") == "command":
                        enc = data.get("enc", "")
                        t = self._decrypt(tok, enc) if enc else (data.get("text") or "").strip()
                        if t:
                            # Forward command to the active desktop session
                            if ws_manager.sessions:
                                # Get first active session
                                active_session = list(ws_manager.sessions.values())[0]
                                asyncio.create_task(
                                    active_session.handle_user_message(t, source="text", thread_id=active_session.thread_id)
                                )
            except WebSocketDisconnect:
                pass
            finally:
                self._clients.discard(websocket)
                self._device_info.pop(websocket, None)

        return app
    def start(self):
        if self._running:
            return
        self._running = True

        # Kill any stale process holding PORT from a previous session / old AppImage
        import logging as _logging
        if _kill_port_owner(PORT):
            _logging.info(f"[Dashboard] Killed stale process on port {PORT}, proceeding with bind.")
            # Give the OS a moment to reclaim the port
            import threading as _t; _t.Event().wait(0.4)

        import threading
        config = uvicorn.Config(self.app, host="0.0.0.0", port=PORT, log_level="warning")
        self._server = uvicorn.Server(config)

        def run_server():
            try:
                self._server.run()
            except Exception as e:
                import logging
                logging.error(f"Dashboard server error: {e}")
            finally:
                self._running = False

        self._thread = threading.Thread(target=run_server, daemon=True)
        self._thread.start()

    def stop(self):
        if not self._running:
            return
        self._running = False
        if hasattr(self, "_server"):
            self._server.should_exit = True
            if hasattr(self, "_thread") and self._thread.is_alive():
                self._thread.join(timeout=1.0)


import atexit
def cleanup_dashboard():
    dashboard_server.stop()

atexit.register(cleanup_dashboard)


# Global dashboard instance
dashboard_server = DashboardServer()
