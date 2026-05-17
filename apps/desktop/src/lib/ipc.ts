import { invoke } from "@tauri-apps/api/core";

// ─── Typed Tauri IPC wrappers ─────────────────────────────────────────────────

/** Capture a screenshot. Returns base64-encoded PNG. */
export const captureScreen = () =>
  invoke<string>("capture_screen");

/** Toggle microphone on/off. Returns new state (true = active). */
export const toggleMicrophone = (active: boolean) =>
  invoke<boolean>("set_microphone", { active });

/** Get the runtime WebSocket port (set by sidecar on startup). */
export const getRuntimePort = () =>
  invoke<number>("get_runtime_port");

/** Show or hide the main window. */
export const setWindowVisible = (visible: boolean) =>
  invoke<void>("set_window_visible", { visible });

/** Get mic audio level (0.0–1.0) for waveform display. */
export const getAudioLevel = () =>
  invoke<number>("get_audio_level");

/** Trigger a native OS notification. */
export const showNotification = (title: string, body: string) =>
  invoke<void>("show_notification", { title, body });
