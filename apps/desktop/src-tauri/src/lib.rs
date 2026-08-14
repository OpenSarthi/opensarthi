#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod ipc;
pub mod sidecar;
pub mod tray;

use std::sync::Arc;
use tracing::info;
use tracing_subscriber::EnvFilter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Linux-specific: suppress Qt/WebKitGTK font format warnings and
    // disable GPU compositing/DMA-BUF paths that cause crashes in AppImage.
    #[cfg(target_os = "linux")]
    {
        // Suppress Qt font-format warnings from AppImage bundled libraries
        std::env::set_var("QT_LOGGING_RULES", "qt.qpa.fonts.warning=false");
        // Ensure consistent DPI handling in AppImage environments
        if std::env::var("QT_FONT_DPI").is_err() {
            std::env::set_var("QT_FONT_DPI", "96");
        }
        // Suppress GStreamer audio device enumeration errors on Linux/AppImage.
        // All voice capture is handled by the Python sidecar (PyAudio).
        std::env::set_var("GST_GL_XINITTHREADS", "1");
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        if std::env::var("WEBKIT_DISABLE_COMPOSITING_MODE").is_err() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
    }

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse().unwrap()))
        .init();

    info!("Starting OpenSarthi Desktop Agent Shell");

    let app_state = Arc::new(ipc::AppState::default());

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            ipc::get_runtime_port,
            ipc::set_microphone,
            ipc::get_audio_level,
            ipc::capture_screen,
            ipc::set_window_visible,
            ipc::show_notification,
            ipc::create_desktop_shortcut,
        ])
        .setup(|app| {
            // Setup System Tray
            tray::setup(app.handle())?;
            
            // Spawn Python Runtime Sidecar
            sidecar::spawn(app.handle());
            
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
