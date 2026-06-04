mod commands;
mod edge_health;
mod edge_manager;
mod notifications;
mod oidc_server;
mod secure_store;
mod tray;

use edge_manager::{resolve_edge_path, EdgeManager};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;

/// Managed state: whether the window should minimize to tray instead of quitting on close.
pub struct CloseToTrayState(pub Arc<AtomicBool>);

/// Managed state: whether the app is in the process of explicitly quitting
/// (so CloseRequested does not prevent close on macOS dock quit / Cmd+Q).
pub struct QuittingState(pub Arc<AtomicBool>);

#[tauri::command]
fn get_close_to_tray(state: tauri::State<'_, CloseToTrayState>) -> bool {
    state.0.load(Ordering::Relaxed)
}

#[tauri::command]
fn set_close_to_tray(state: tauri::State<'_, CloseToTrayState>, enabled: bool) {
    state.0.store(enabled, Ordering::Relaxed);
}

pub fn run() {
    let edge_path = resolve_edge_path();
    let store_path = std::env::temp_dir().join("agenthub-edge-store.json");
    let edge = Arc::new(Mutex::new(
        EdgeManager::new(edge_path, store_path)
            .expect("failed to initialize local Edge auth token"),
    ));

    let close_to_tray = Arc::new(AtomicBool::new(true));
    let quitting = Arc::new(AtomicBool::new(false));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(edge.clone())
        .manage(CloseToTrayState(close_to_tray.clone()))
        .manage(QuittingState(quitting.clone()))
        .invoke_handler(tauri::generate_handler![
            commands::get_edge_status,
            commands::get_edge_auth_token,
            commands::start_edge,
            commands::stop_edge,
            commands::read_dir_tree,
            commands::create_file,
            commands::create_folder,
            commands::rename_entry,
            commands::copy_entry,
            commands::delete_entry,
            commands::read_file,
            commands::write_file,
            commands::git_status,
            commands::git_diff_unstaged,
            commands::git_diff_staged,
            commands::git_diff_file,
            commands::read_workspace_store,
            commands::write_workspace_store,
            commands::validate_allowlist,
            commands::search_workspace_content,
            oidc_server::start_oidc_callback_server,
            oidc_server::stop_oidc_callback_server,
            secure_store::clear_hub_refresh_token,
            secure_store::read_hub_refresh_token,
            secure_store::store_hub_refresh_token,
            secure_store::clear_hub_access_token,
            secure_store::read_hub_access_token,
            secure_store::store_hub_access_token,
            notifications::notify_run_completed,
            notifications::notify_run_failed,
            get_close_to_tray,
            set_close_to_tray,
            tray::set_tray_labels,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            tray::build_tray(&handle)?;
            let edge_for_start = edge.clone();
            let start_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                let mut manager = edge_for_start.lock().await;
                if let Err(error) = manager.start(&start_handle).await {
                    let _ = start_handle.emit("edge-start-error", error);
                }
            });
            edge_health::spawn_health_check(handle, edge);
            Ok(())
        })
        .on_window_event(move |window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = &event {
                let app = window.app_handle();
                let state = app.state::<CloseToTrayState>();
                let quitting = app.state::<QuittingState>();
                // If the app is explicitly quitting, let the close proceed.
                if quitting.0.load(Ordering::Relaxed) {
                    return;
                }
                if state.0.load(Ordering::Relaxed) {
                    // Prevent the window from closing — hide to tray instead.
                    api.prevent_close();
                    let _ = window.hide();
                    // On macOS, remove the app from the Dock so only the tray icon remains.
                    #[cfg(target_os = "macos")]
                    {
                        use tauri::ActivationPolicy;
                        let _ = app.set_activation_policy(ActivationPolicy::Accessory);
                    }
                    // Show a native notification confirming the app is still running.
                    use tauri_plugin_notification::NotificationExt;
                    let _ = app
                        .notification()
                        .builder()
                        .title("AgentHub Desktop")
                        .body("App is still running in the system tray. Use the tray icon to show or quit.")
                        .show();
                }
                // If close_to_tray is false, let the event proceed normally.
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
