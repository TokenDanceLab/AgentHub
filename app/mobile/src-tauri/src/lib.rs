// AgentHub Mobile — Tauri lib
//
// Desktop owns: app/desktop/src-tauri/ (edge, tray, keyring, OIDC HTTP server)
// Mobile owns:  app/mobile/src-tauri/  (OIDC deep-link, platform secure store, notifications)
//
// DO NOT modify the other's Tauri project. If you need shared Rust code,
// propose an app/shared-rust/ crate that both depend on.

mod notifications;
mod oidc;
mod secure_store;

/// PKCE state held in Tauri managed state so the deep-link callback handler
/// can retrieve the verifier and exchange the authorization code for tokens.
pub struct OidcState {
    pub verifier: std::sync::Mutex<Option<String>>,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            oidc::start_oidc_login,
            secure_store::store_hub_access_token,
            secure_store::read_hub_access_token,
            secure_store::clear_hub_access_token,
            notifications::notify_run_completed,
            notifications::notify_run_failed,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
