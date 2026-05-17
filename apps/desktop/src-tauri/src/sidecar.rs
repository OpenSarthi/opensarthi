use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};
use tracing::{error, info, warn};

use crate::ipc::AppState;

pub fn spawn(app: &AppHandle) {
    let app_clone = app.clone();
    
    tauri::async_runtime::spawn(async move {
        info!("Starting Python sidecar...");
        
        let sidecar = app_clone
            .shell()
            .sidecar("opensarthi-runtime")
            .expect("Failed to initialize sidecar configuration");
            
        let (mut rx, _child) = match sidecar.spawn() {
            Ok(tuple) => tuple,
            Err(e) => {
                error!("Failed to spawn Python sidecar: {}", e);
                let _ = app_clone.emit("runtime:crashed", e.to_string());
                return;
            }
        };
        
        let state = app_clone.state::<Arc<AppState>>();
        
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let line = String::from_utf8_lossy(&line);
                    let line = line.trim();
                    info!("Sidecar [stdout]: {}", line);
                    
                    // Look for the port announcement from the FastAPI server
                    if line.starts_with("PORT:") {
                        if let Ok(port) = line[5..].parse::<u16>() {
                            info!("Runtime sidecar is listening on port {}", port);
                            state.runtime_port.store(port, Ordering::Relaxed);
                            let _ = app_clone.emit("runtime:port-ready", port);
                        }
                    }
                }
                CommandEvent::Stderr(line) => {
                    let line = String::from_utf8_lossy(&line);
                    warn!("Sidecar [stderr]: {}", line.trim());
                }
                CommandEvent::Terminated(payload) => {
                    error!("Sidecar terminated with payload: {:?}", payload);
                    state.runtime_port.store(0, Ordering::Relaxed);
                    let _ = app_clone.emit("runtime:crashed", format!("{:?}", payload));
                    // Depending on payload, we could restart it here
                }
                CommandEvent::Error(err) => {
                    error!("Sidecar error: {}", err);
                }
                _ => {}
            }
        }
    });
}
