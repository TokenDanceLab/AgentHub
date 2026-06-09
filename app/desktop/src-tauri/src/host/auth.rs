pub use crate::oidc_server::{check_loopback_callback_readiness, LoopbackReadiness};
pub use crate::secure_store::{check_credential_store_readiness, CredentialStoreReadiness};

pub fn build_packaged_login_readiness() -> PackagedLoginReadiness {
    PackagedLoginReadiness {
        loopback: check_loopback_callback_readiness(),
        credential_store: check_credential_store_readiness(),
        real_e2e: PackagedLoginRealE2EGate {
            status: "proposal_only".to_string(),
            reason: "Real packaged login E2E requires an explicit TokenDance ID/browser gate."
                .to_string(),
        },
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PackagedLoginRealE2EGate {
    pub status: String,
    pub reason: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PackagedLoginReadiness {
    pub loopback: LoopbackReadiness,
    pub credential_store: CredentialStoreReadiness,
    pub real_e2e: PackagedLoginRealE2EGate,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_readiness_binds_random_localhost_port() {
        let readiness = check_loopback_callback_readiness();

        assert!(readiness.available);
        assert_eq!(readiness.bind_host, "127.0.0.1");
        assert!(readiness.port.unwrap_or_default() > 0);
        assert!(readiness.error.is_none());
    }

    #[test]
    fn loopback_redirect_uri_uses_http_loopback_callback_path() {
        let readiness = LoopbackReadiness {
            available: true,
            bind_host: "127.0.0.1".to_string(),
            port: Some(49152),
            redirect_uri: Some("http://127.0.0.1:49152/callback".to_string()),
            error: None,
        };

        assert_eq!(
            readiness.redirect_uri.as_deref(),
            Some("http://127.0.0.1:49152/callback")
        );
    }

    #[test]
    fn credential_readiness_reports_service_without_token_usernames() {
        let readiness = check_credential_store_readiness();

        assert!(readiness.available);
        assert_eq!(readiness.service, "com.agenthub.desktop");
        assert!(readiness.error.is_none());
    }

    #[test]
    fn credential_readiness_keeps_unavailable_reason_nonfatal() {
        use crate::secure_store::credential_store_readiness_from_result;

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
