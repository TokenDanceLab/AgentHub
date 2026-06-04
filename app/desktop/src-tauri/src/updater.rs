use serde::Serialize;
use tauri_plugin_updater::UpdaterExt;

#[derive(Debug, Clone, Serialize)]
pub struct UpdateInfo {
    pub has_update: bool,
    pub version: Option<String>,
    pub current_version: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn check_for_update(app: tauri::AppHandle) -> Result<UpdateInfo, String> {
    let current = app.config().version.clone().unwrap_or_default();

    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(UpdateInfo {
            has_update: true,
            version: Some(update.version.to_string()),
            current_version: Some(current),
            error: None,
        }),
        Ok(None) => Ok(UpdateInfo {
            has_update: false,
            version: None,
            current_version: Some(current),
            error: None,
        }),
        Err(e) => Ok(UpdateInfo {
            has_update: false,
            version: None,
            current_version: Some(current),
            error: Some(e.to_string()),
        }),
    }
}

#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("Failed to check for update: {}", e))?;

    let update = update.ok_or("No update available")?;

    update
        .download_and_install(|_chunk, _content_length| {}, || {})
        .await
        .map_err(|e| format!("Failed to install update: {}", e))?;

    Ok(())
}
