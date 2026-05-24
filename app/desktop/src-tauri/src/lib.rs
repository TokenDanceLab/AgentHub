mod commands;
mod edge_health;
mod edge_manager;
mod notifications;
mod tray;

use edge_manager::{resolve_edge_path, EdgeManager};
use std::sync::Arc;
use tokio::sync::Mutex;

pub fn run() {
    let edge_path = resolve_edge_path();
    let store_path = std::env::temp_dir().join("agenthub-edge-store.json");
    let edge = Arc::new(Mutex::new(EdgeManager::new(edge_path, store_path)));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .manage(edge.clone())
        .invoke_handler(tauri::generate_handler![
            commands::get_edge_status,
            commands::start_edge,
            commands::stop_edge,
            notifications::notify_run_completed,
            notifications::notify_run_failed,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            tray::build_tray(&handle)?;
            edge_health::spawn_health_check(handle, edge);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
