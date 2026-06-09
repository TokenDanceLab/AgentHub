use keyring_core::Entry;
use serde::Serialize;
use std::sync::OnceLock;

const SERVICE: &str = "com.agenthub.desktop";
const HUB_REFRESH_TOKEN_USER: &str = "hub-refresh-token";
const HUB_ACCESS_TOKEN_USER: &str = "hub-access-token";

static STORE_INIT: OnceLock<Result<(), String>> = OnceLock::new();

#[derive(Debug, Clone, Serialize)]
pub struct CredentialStoreReadiness {
    pub available: bool,
    pub service: String,
    pub error: Option<String>,
}

fn ensure_store() -> Result<(), String> {
    STORE_INIT
        .get_or_init(|| {
            #[cfg(target_os = "windows")]
            {
                let store = windows_native_keyring_store::Store::new()
                    .map_err(|e| format!("credential store unavailable: {e}"))?;
                keyring_core::set_default_store(store);
                Ok(())
            }
            #[cfg(target_os = "macos")]
            {
                let store = apple_native_keyring_store::Store::new()
                    .map_err(|e| format!("credential store unavailable: {e}"))?;
                keyring_core::set_default_store(store);
                Ok(())
            }
            #[cfg(target_os = "linux")]
            {
                let store = linux_keyutils_keyring_store::Store::new()
                    .map_err(|e| format!("credential store unavailable: {e}"))?;
                keyring_core::set_default_store(store);
                Ok(())
            }
        })
        .clone()
}

fn credential_store_readiness_from_result(result: Result<(), String>) -> CredentialStoreReadiness {
    match result {
        Ok(()) => CredentialStoreReadiness {
            available: true,
            service: SERVICE.to_string(),
            error: None,
        },
        Err(error) => CredentialStoreReadiness {
            available: false,
            service: SERVICE.to_string(),
            error: Some(error),
        },
    }
}

pub fn check_credential_store_readiness() -> CredentialStoreReadiness {
    let result = ensure_store().and_then(|_| {
        Entry::new(SERVICE, HUB_REFRESH_TOKEN_USER)
            .map(|_| ())
            .map_err(|err| format!("credential entry unavailable: {err}"))
    });

    credential_store_readiness_from_result(result)
}

fn refresh_token_entry() -> Result<Entry, String> {
    ensure_store()?;
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
        Err(keyring_core::Error::NoEntry) => Ok(None),
        Err(err) => Err(format!("credential store read failed: {err}")),
    }
}

#[tauri::command]
pub async fn clear_hub_refresh_token() -> Result<(), String> {
    match refresh_token_entry()?.delete_credential() {
        Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
        Err(err) => Err(format!("credential store delete failed: {err}")),
    }
}

// ── Hub access token ──

fn access_token_entry() -> Result<Entry, String> {
    ensure_store()?;
    Entry::new(SERVICE, HUB_ACCESS_TOKEN_USER)
        .map_err(|err| format!("credential entry unavailable: {err}"))
}

#[tauri::command]
pub async fn store_hub_access_token(token: String) -> Result<(), String> {
    if token.trim().is_empty() {
        return Err("access token must not be empty".to_string());
    }
    access_token_entry()?
        .set_password(&token)
        .map_err(|err| format!("credential store write failed: {err}"))
}

#[tauri::command]
pub async fn read_hub_access_token() -> Result<Option<String>, String> {
    match access_token_entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring_core::Error::NoEntry) => Ok(None),
        Err(err) => Err(format!("credential store read failed: {err}")),
    }
}

#[tauri::command]
pub async fn clear_hub_access_token() -> Result<(), String> {
    match access_token_entry()?.delete_credential() {
        Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
        Err(err) => Err(format!("credential store delete failed: {err}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_readiness_reports_service_without_token_usernames() {
        let readiness = credential_store_readiness_from_result(Ok(()));

        assert!(readiness.available);
        assert_eq!(readiness.service, "com.agenthub.desktop");
        assert!(readiness.error.is_none());
    }

    #[test]
    fn credential_readiness_keeps_unavailable_reason_nonfatal() {
        let readiness =
            credential_store_readiness_from_result(Err("credential store unavailable".to_string()));

        assert!(!readiness.available);
        assert_eq!(readiness.service, "com.agenthub.desktop");
        assert_eq!(
            readiness.error.as_deref(),
            Some("credential store unavailable")
        );
    }
}
