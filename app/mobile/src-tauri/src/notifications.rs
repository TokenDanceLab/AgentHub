use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

#[tauri::command]
pub async fn notify_run_completed(
    app: AppHandle,
    agent_name: String,
    run_id: String,
) -> Result<(), String> {
    let _ = app
        .notification()
        .builder()
        .title("Agent Run Completed")
        .body(format!("{} finished run {}", agent_name, run_id))
        .show();
    Ok(())
}

#[tauri::command]
pub async fn notify_run_failed(
    app: AppHandle,
    agent_name: String,
    error: String,
) -> Result<(), String> {
    let _ = app
        .notification()
        .builder()
        .title("Agent Run Failed")
        .body(format!("{} failed: {}", agent_name, error))
        .show();
    Ok(())
}
