use crate::edge_manager::{EdgeStatus, SharedEdgeManager};
use tauri::State;

#[tauri::command]
pub async fn get_edge_status(state: State<'_, SharedEdgeManager>) -> Result<EdgeStatus, String> {
    let mgr = state.lock().await;
    Ok(mgr.status())
}

#[tauri::command]
pub async fn start_edge(state: State<'_, SharedEdgeManager>) -> Result<EdgeStatus, String> {
    let mut mgr = state.lock().await;
    mgr.start().await?;
    Ok(mgr.status())
}

#[tauri::command]
pub async fn stop_edge(state: State<'_, SharedEdgeManager>) -> Result<EdgeStatus, String> {
    let mut mgr = state.lock().await;
    mgr.stop().await?;
    Ok(mgr.status())
}
