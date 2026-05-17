// Runtime constants for OpenSarthi

export const RUNTIME_DEFAULT_PORT = 8421;
export const WS_RECONNECT_DELAY_MS = 2000;
export const WS_MAX_RECONNECT_ATTEMPTS = 10;
export const PERMISSION_TIMEOUT_MS = 30_000;

export const WAKE_WORDS = ["hey sarthi", "hello sarthi", "ok sarthi"] as const;

export const APP_NAME = "OpenSarthi";
export const APP_VERSION = "0.1.0";

export const TAURI_EVENTS = {
  RUNTIME_PORT_READY: "runtime:port-ready",
  RUNTIME_CRASHED:    "runtime:crashed",
  AUDIO_STATE:        "audio:state",
  HOTKEY_TRIGGER:     "hotkey:trigger",
} as const;

export const RISK_COLORS = {
  safe:      "var(--success)",
  moderate:  "var(--warning)",
  dangerous: "var(--danger)",
  forbidden: "var(--danger)",
} as const;
