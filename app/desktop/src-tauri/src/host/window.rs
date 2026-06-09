use crate::CloseToTrayState;
use std::sync::atomic::Ordering;

pub use crate::notifications::{notify_run_completed, notify_run_failed};
pub use crate::tray::set_tray_labels;

#[tauri::command]
pub fn get_close_to_tray(state: tauri::State<'_, CloseToTrayState>) -> bool {
    state.0.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn set_close_to_tray(state: tauri::State<'_, CloseToTrayState>, enabled: bool) {
    state.0.store(enabled, Ordering::Relaxed);
}

pub fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    crate::tray::build_tray(app)
}

pub fn spawn_health_check(app: tauri::AppHandle, edge: crate::edge_manager::SharedEdgeManager) {
    crate::edge_health::spawn_health_check(app, edge);
}
