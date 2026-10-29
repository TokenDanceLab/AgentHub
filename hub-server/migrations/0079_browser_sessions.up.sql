ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS oidc_client_id varchar(255) NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS oidc_subject_epochs (
    issuer varchar(512) NOT NULL,
    subject varchar(255) NOT NULL,
    generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0),
    last_logout_iat bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (issuer, subject)
);

CREATE TABLE browser_sessions (
    token_hash varchar(64) PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    user_identity_id uuid NOT NULL REFERENCES user_identities(id),
    oidc_client_id varchar(255) NOT NULL,
    device_id uuid NOT NULL REFERENCES devices(id),
    generation bigint NOT NULL CHECK (generation >= 0),
    csrf_token varchar(64) NOT NULL,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz
);
CREATE INDEX idx_browser_sessions_identity ON browser_sessions(user_identity_id);
CREATE INDEX idx_browser_sessions_expiry ON browser_sessions(expires_at);

CREATE TABLE IF NOT EXISTS oidc_logout_events (
    issuer varchar(512) NOT NULL,
    jti varchar(512) NOT NULL,
    claims_hash varchar(64) NOT NULL,
    received_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (issuer, jti)
);
CREATE INDEX IF NOT EXISTS idx_oidc_logout_events_expiry ON oidc_logout_events(expires_at);
