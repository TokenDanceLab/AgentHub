// OIDC login via TokenDance ID.
// Mobile uses system browser + deep link callback (custom URI scheme).
// Desktop uses local HTTP server — see app/desktop/src-tauri/src/oidc_server.rs.
// Both must NOT overlap in implementation.

use tauri::AppHandle;

#[tauri::command]
pub async fn start_oidc_login(app: AppHandle) -> Result<(), String> {
    // TODO: mobile agent — implement OIDC PKCE flow via system browser + deep link.
    // The desktop agent owns the HTTP server approach in app/desktop/.
    // Coordinate on the TokenDance ID configuration (client_id, redirect_uri).
    let _ = app;
    Err("not yet implemented — coordinate with desktop agent on OIDC flow".into())
}
