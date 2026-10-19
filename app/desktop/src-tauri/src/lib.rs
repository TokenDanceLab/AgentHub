mod commands;
mod edge_health;
mod edge_manager;
mod host;
mod oidc_server;
mod secure_store;
mod tray;

use edge_manager::{resolve_edge_path, EdgeManager};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;

pub struct CloseToTrayState(pub Arc<AtomicBool>);
pub struct QuittingState(pub Arc<AtomicBool>);

/// Returns the available updater version, or null when the app is current.
#[tauri::command]
async fn check_for_update(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|error| error.to_string())?;
    updater
        .check()
        .await
        .map(|update| update.map(|available| available.version.clone()))
        .map_err(|error| error.to_string())
}

/// Downloads and installs the pending update, then restarts the app.
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|error| error.to_string())?;
    match updater.check().await.map_err(|error| error.to_string())? {
        Some(update) => {
            update
                .download_and_install(|_chunk_length, _content_length| {}, || {})
                .await
                .map_err(|error| error.to_string())?;
            app.restart();
        }
        None => Ok(()),
    }
}

pub fn run() {
    let edge_path = resolve_edge_path();
    let store_path = std::env::temp_dir().join("agenthub-edge.sqlite");
    let edge = Arc::new(Mutex::new(
        EdgeManager::new(edge_path.clone(), store_path.clone()).unwrap_or_else(|e| {
            log::error!(
                "Failed to initialize local Edge auth token: {e}. Local Edge startup is blocked."
            );
            EdgeManager::new_unavailable(edge_path, store_path, e)
        }),
    ));

    let close_to_tray = Arc::new(AtomicBool::new(true));
    let quitting = Arc::new(AtomicBool::new(false));
    let workspace_file_access = commands::WorkspaceFileAccessState::default();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(edge.clone())
        .manage(workspace_file_access)
        .manage(CloseToTrayState(close_to_tray.clone()))
        .manage(QuittingState(quitting.clone()))
        .invoke_handler(tauri::generate_handler![
            // host::edge
            crate::host::edge::get_edge_host_readiness,
            crate::host::edge::get_local_edge_diagnostics,
            crate::host::edge::get_local_cli_discovery,
            crate::host::edge::get_edge_auth_token,
            // host::fs
            crate::host::fs::read_dir_tree,
            crate::host::fs::read_file,
            // oidc_server (direct — tauri::command proc-macro is module-local)
            oidc_server::start_oidc_callback_server,
            oidc_server::proxy_http_post,
            // secure_store (direct)
            secure_store::clear_hub_refresh_token,
            secure_store::read_hub_refresh_token,
            secure_store::store_hub_refresh_token,
            secure_store::clear_hub_access_token,
            secure_store::read_hub_access_token,
            secure_store::store_hub_access_token,
            // notifications (direct)
            // host::window
            // tray (direct — has #[tauri::command] proc-macro)
            tray::set_tray_labels,
            // updater (direct)
            check_for_update,
            install_update,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            let access = app.state::<commands::WorkspaceFileAccessState>();
            if let Err(error) = commands::seed_workspace_file_access_from_store(&handle, &access) {
                log::warn!("Failed to seed workspace file access state: {error}");
            }
            commands::build_tray(&handle)?;
            let edge_for_start = edge.clone();
            let start_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                let mut manager = edge_for_start.lock().await;
                if let Err(error) = manager.start(&start_handle).await {
                    let _ = start_handle.emit("edge-start-error", error);
                }
            });
            commands::spawn_health_check(handle, edge);
            Ok(())
        })
        .on_window_event(move |window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = &event {
                let app = window.app_handle();
                let state = app.state::<CloseToTrayState>();
                let quitting = app.state::<QuittingState>();
                if quitting.0.load(Ordering::Relaxed) {
                    return;
                }
                if state.0.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                    #[cfg(target_os = "macos")]
                    {
                        use tauri::ActivationPolicy;
                        let _ = app.set_activation_policy(ActivationPolicy::Accessory);
                    }
                    use tauri_plugin_notification::NotificationExt;
                    let _ = app
                        .notification()
                        .builder()
                        .title("AgentHub Desktop")
                        .body("App is still running in the system tray. Use the tray icon to show or quit.")
                        .show();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
