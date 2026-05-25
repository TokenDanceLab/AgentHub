use keyring::use_native_store;
use keyring_core::{Entry, Error};
use std::sync::OnceLock;

const SERVICE: &str = "com.agenthub.desktop";
const HUB_REFRESH_TOKEN_USER: &str = "hub-refresh-token";

static KEYRING_INIT: OnceLock<Result<(), String>> = OnceLock::new();

fn ensure_keyring() -> Result<(), String> {
    KEYRING_INIT
        .get_or_init(|| {
            use_native_store(true).map_err(|err| format!("credential store unavailable: {err}"))
        })
        .clone()
}

fn refresh_token_entry() -> Result<Entry, String> {
    ensure_keyring()?;
    Entry::new(SERVICE, HUB_REFRESH_TOKEN_USER)
        .map_err(|err| format!("credential entry unavailable: {err}"))
}

#[tauri::command]
pub async fn store_hub_refresh_token(token: String) -> Result<(), String> {
    if token.trim().is_empty() {
        return Err("refresh token must not be empty".to_string());
    }
    refresh_token_entry()?
        .set_password(&token)
        .map_err(|err| format!("credential store write failed: {err}"))
}

#[tauri::command]
pub async fn read_hub_refresh_token() -> Result<Option<String>, String> {
    match refresh_token_entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(Error::NoEntry) => Ok(None),
        Err(err) => Err(format!("credential store read failed: {err}")),
    }
}

#[tauri::command]
pub async fn clear_hub_refresh_token() -> Result<(), String> {
    match refresh_token_entry()?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(err) => Err(format!("credential store delete failed: {err}")),
    }
}
