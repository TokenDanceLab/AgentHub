// Platform secure token storage for mobile.
// Desktop uses keyring-rs (OS keychain). Mobile stores in the app data
// directory because the platform-keystore Tauri plugin (tauri-plugin-biometric
// or similar) has not yet been integrated.
//
// TODO: upgrade to Android Keystore / iOS Keychain via a Tauri plugin once
// the plugin ecosystem stabilises. The current file-based store is functional
// but not cryptographically protected.

use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

const TOKEN_FILE: &str = "hub_access_token.json";

fn token_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create app data dir: {e}"))?;
    Ok(dir.join(TOKEN_FILE))
}

#[tauri::command]
pub async fn store_hub_access_token(app: AppHandle, token: String) -> Result<(), String> {
    if token.trim().is_empty() {
        return Err("access token must not be empty".into());
    }

    let path = token_path(&app)?;
    let payload = serde_json::json!({ "access_token": token });
    fs::write(&path, serde_json::to_string(&payload).map_err(|e| format!("serialize: {e}"))?)
        .map_err(|e| format!("write token file: {e}"))
}

#[tauri::command]
pub async fn read_hub_access_token(app: AppHandle) -> Result<Option<String>, String> {
    let path = token_path(&app)?;
    match fs::read_to_string(&path) {
        Ok(contents) => {
            let parsed: serde_json::Value = serde_json::from_str(&contents)
                .map_err(|e| format!("deserialize token file: {e}"))?;
            Ok(parsed
                .get("access_token")
                .and_then(|v| v.as_str())
                .map(String::from))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("read token file: {e}")),
    }
}

#[tauri::command]
pub async fn clear_hub_access_token(app: AppHandle) -> Result<(), String> {
    let path = token_path(&app)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("remove token file: {e}")),
    }
}

