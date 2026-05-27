// Platform secure token storage for mobile.
// Desktop uses keyring-rs (OS keychain). Mobile needs a platform-appropriate
// alternative (Android Keystore / iOS Keychain via Tauri plugins).
//
// DO NOT copy desktop's keyring approach — it doesn't work on mobile.

#[tauri::command]
pub async fn store_hub_access_token(token: String) -> Result<(), String> {
    // TODO: mobile agent — store in platform secure storage.
    if token.trim().is_empty() {
        return Err("access token must not be empty".into());
    }
    Err("not yet implemented — use platform secure storage plugin".into())
}

#[tauri::command]
pub async fn read_hub_access_token() -> Result<Option<String>, String> {
    Err("not yet implemented — use platform secure storage plugin".into())
}

#[tauri::command]
pub async fn clear_hub_access_token() -> Result<(), String> {
    Err("not yet implemented — use platform secure storage plugin".into())
}
