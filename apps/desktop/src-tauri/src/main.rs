#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ipc;
mod sidecar;
mod tray;

use std::sync::Arc;
use tracing::info;
use tracing_subscriber::EnvFilter;

fn main() {
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
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            ipc::get_runtime_port,
            ipc::set_microphone,
            ipc::get_audio_level,
            ipc::capture_screen,
            ipc::set_window_visible,
            ipc::show_notification,
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
