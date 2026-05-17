import { WSMessageSchema, type WSMessage, type WSMessageType } from "./schemas";
import { WS_RECONNECT_DELAY_MS, WS_MAX_RECONNECT_ATTEMPTS } from "./constants";

type MessageHandler = (msg: WSMessage) => void;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private port: number | null = null;
  private handlers = new Map<WSMessageType | "*", Set<MessageHandler>>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionallyClosed = false;

  connect(port: number) {
    this.port = port;
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
      console.warn("[WS] Not connected; dropping message:", type);
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
    if (!this.port) return;
    const url = `ws://127.0.0.1:${this.port}/ws`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log("[WS] Connected to runtime on port", this.port);
      this.reconnectAttempts = 0;
      this._emit({ id: crypto.randomUUID(), type: "session_state", payload: { connected: true }, timestamp: Date.now() });
    };

    this.ws.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data as string);
        const msg = WSMessageSchema.parse(raw);
        this._emit(msg);
      } catch (e) {
        console.error("[WS] Invalid message:", e);
      }
    };

    this.ws.onerror = (e) => console.error("[WS] Error:", e);

    this.ws.onclose = () => {
      if (this.intentionallyClosed) return;
      if (this.reconnectAttempts >= WS_MAX_RECONNECT_ATTEMPTS) {
        console.error("[WS] Max reconnect attempts reached");
        return;
      }
      this.reconnectAttempts++;
      console.log(`[WS] Reconnecting... (attempt ${this.reconnectAttempts})`);
      this.reconnectTimer = setTimeout(() => this._open(), WS_RECONNECT_DELAY_MS);
    };
  }

  private _emit(msg: WSMessage) {
    this.handlers.get(msg.type)?.forEach((h) => h(msg));
    this.handlers.get("*")?.forEach((h) => h(msg));
  }
}

// Singleton WebSocket client
export const wsClient = new WebSocketClient();
