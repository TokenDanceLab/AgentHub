use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

pub fn send_run_completed(app: &AppHandle, agent_name: &str, run_id: &str) {
    let _ = app
        .notification()
        .builder()
        .title("Agent Run Completed")
        .body(format!("{} finished run {}", agent_name, run_id))
        .show();
}

pub fn send_run_failed(app: &AppHandle, agent_name: &str, error: &str) {
    let _ = app
        .notification()
        .builder()
        .title("Agent Run Failed")
        .body(format!("{} failed: {}", agent_name, error))
        .show();
}

#[tauri::command]
pub async fn notify_run_completed(
    app: AppHandle,
    agent_name: String,
    run_id: String,
) -> Result<(), String> {
    send_run_completed(&app, &agent_name, &run_id);
    Ok(())
}

#[tauri::command]
pub async fn notify_run_failed(
    app: AppHandle,
    agent_name: String,
    error: String,
) -> Result<(), String> {
    send_run_failed(&app, &agent_name, &error);
    Ok(())
}
