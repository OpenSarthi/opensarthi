/**
 * Android WebSocket client — identical protocol to the desktop wsClient,
 * but connects directly to ws://localhost:8765 (the Chaquopy-started FastAPI server).
 *
 * No port discovery needed: Android starts the runtime on a fixed port.
 */
import { WSMessageSchema, type WSMessage, type WSMessageType } from "./schemas";

const ANDROID_RUNTIME_PORT = 8765;
const WS_RECONNECT_DELAY_MS = 2000;
const WS_MAX_RECONNECT_ATTEMPTS = 20;

type MessageHandler = (msg: WSMessage) => void;

class AndroidWebSocketClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<WSMessageType | "*", Set<MessageHandler>>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionallyClosed = false;

  connect() {
    this.intentionallyClosed = false;
    this._open();
  }

  disconnect() {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  send(type: WSMessageType, payload: unknown) {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      console.warn("[WS-Android] Not connected; dropping message:", type);
      return;
    }
    const msg: WSMessage = {
      id: crypto.randomUUID(),
      type,
      payload,
      timestamp: Date.now(),
    };
    this.ws.send(JSON.stringify(msg));
  }

  on(type: WSMessageType | "*", handler: MessageHandler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  get isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private _open() {
    const url = `ws://127.0.0.1:${ANDROID_RUNTIME_PORT}/ws`;
    console.log("[WS-Android] Connecting to runtime:", url);
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log("[WS-Android] Connected to runtime");
      this.reconnectAttempts = 0;
      this._emit({
        id: crypto.randomUUID(),
        type: "session_state",
        payload: { connected: true },
        timestamp: Date.now(),
      });
    };

    this.ws.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data as string);
        const msg = WSMessageSchema.parse(raw);
        this._emit(msg);
      } catch (e) {
        console.error("[WS-Android] Invalid message:", e);
      }
    };

    this.ws.onerror = (e) => console.error("[WS-Android] Error:", e);

    this.ws.onclose = () => {
      if (this.intentionallyClosed) return;
      if (this.reconnectAttempts >= WS_MAX_RECONNECT_ATTEMPTS) {
        console.error("[WS-Android] Max reconnect attempts reached");
        return;
      }
      this.reconnectAttempts++;
      console.log(`[WS-Android] Reconnecting... (attempt ${this.reconnectAttempts})`);
      this.reconnectTimer = setTimeout(() => this._open(), WS_RECONNECT_DELAY_MS);
    };
  }

  private _emit(msg: WSMessage) {
    this.handlers.get(msg.type)?.forEach((h) => h(msg));
    this.handlers.get("*")?.forEach((h) => h(msg));
  }
}

export const wsClient = new AndroidWebSocketClient();
