// OIDC login via TokenDance ID.
// Mobile uses system browser + deep link callback (custom URI scheme).
// Desktop uses local HTTP server — see app/desktop/src-tauri/src/oidc_server.rs.
//
// Mobile flow:
//   1. Generate PKCE code verifier + challenge
//   2. Open system browser to TokenDance ID /authorize with PKCE params
//   3. TokenDance ID redirects to custom URI scheme (agenthub://callback)
//   4. Tauri deep-link plugin (future) captures the callback, exchanges code for token
//   5. Token is stored via secure_store
//
// Current status: opens the browser for login. The deep-link callback handler
// requires the tauri-plugin-deep-link crate (not yet in Cargo.toml). Once that
// plugin is integrated, the callback handling can be completed.

use rand::distributions::{Alphanumeric, DistString};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

const TOKENDANCE_ID_BASE: &str = "https://id.tokendance.com";
const CLIENT_ID: &str = "agenthub_mobile";
const REDIRECT_URI: &str = "agenthub://callback";

fn generate_pkce_verifier() -> String {
    Alphanumeric.sample_string(&mut rand::thread_rng(), 64)
}

fn pkce_challenge(verifier: &str) -> String {
    let hash = Sha256::digest(verifier.as_bytes());
    base64_url_no_pad(&hash)
}

fn base64_url_no_pad(bytes: &[u8]) -> String {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    URL_SAFE_NO_PAD.encode(bytes)
}

#[tauri::command]
pub async fn start_oidc_login(app: AppHandle) -> Result<(), String> {
    let verifier = generate_pkce_verifier();
    let challenge = pkce_challenge(&verifier);

    // Store the verifier in state so the deep-link callback handler can
    // retrieve it later to exchange the code.
    // The deep-link handler is not yet implemented; this state will be
    // consumed once the tauri-plugin-deep-link integration is complete.
    app.manage(crate::OidcState {
        verifier: std::sync::Mutex::new(Some(verifier)),
    });

    let auth_url = format!(
        "{base}/authorize\
         ?response_type=code\
         &client_id={client}\
         &redirect_uri={redirect}\
         &code_challenge={challenge}\
         &code_challenge_method=S256\
         &scope=openid+profile+email",
        base = TOKENDANCE_ID_BASE,
        client = CLIENT_ID,
        redirect = urlencoding::encode(REDIRECT_URI),
        challenge = urlencoding::encode(&challenge),
    );

    app.shell()
        .open(auth_url, None)
        .map_err(|e| format!("failed to open system browser: {e}"))?;

    Ok(())
}

