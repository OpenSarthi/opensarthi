// OpenSarthi — Rust Core
// IPC commands exposed to the frontend via Tauri invoke

use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use tracing::{info, error};

/// Shared application state
pub struct AppState {
    pub runtime_port: AtomicU16,
    pub mic_active: AtomicBool,
    pub audio_level: std::sync::atomic::AtomicU32, // f32 stored as u32 bits
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            runtime_port: AtomicU16::new(0),
            mic_active: AtomicBool::new(false),
            audio_level: std::sync::atomic::AtomicU32::new(0),
        }
    }
}

/// Get the port on which the Python runtime sidecar is listening.
#[tauri::command]
pub fn get_runtime_port(state: State<Arc<AppState>>) -> u16 {
    state.runtime_port.load(Ordering::Relaxed)
}

/// Enable or disable the microphone input stream.
#[tauri::command]
pub fn set_microphone(active: bool, state: State<Arc<AppState>>) -> bool {
    state.mic_active.store(active, Ordering::Relaxed);
    info!(mic_active = active, "Microphone state changed");
    active
}

/// Get current mic audio level (0.0–1.0) as f32.
#[tauri::command]
pub fn get_audio_level(state: State<Arc<AppState>>) -> f32 {
    let bits = state.audio_level.load(Ordering::Relaxed);
    f32::from_bits(bits)
}

/// Capture a screenshot of the primary display. Returns base64-encoded PNG.
#[tauri::command]
pub async fn capture_screen() -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    use xcap::Monitor;

    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    let primary = monitors.into_iter().next().ok_or("No monitor found")?;
    let image = primary.capture_image().map_err(|e| e.to_string())?;

    let mut buf = std::io::Cursor::new(Vec::new());
    image.write_to(&mut buf, image::ImageFormat::Png).map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(buf.into_inner()))
}

/// Show or hide the main window.
#[tauri::command]
pub fn set_window_visible(visible: bool, app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("Window not found")?;
    if visible {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    } else {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Show a native OS notification.
#[tauri::command]
pub fn show_notification(title: String, body: String, app: AppHandle) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .map_err(|e| e.to_string())
}
