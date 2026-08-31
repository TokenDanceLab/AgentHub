pub fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    crate::tray::build_tray(app)
}

pub fn spawn_health_check(app: tauri::AppHandle, edge: crate::edge_manager::SharedEdgeManager) {
    crate::edge_health::spawn_health_check(app, edge);
}
