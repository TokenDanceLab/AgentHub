CREATE TABLE edge_enrollments (
    id uuid PRIMARY KEY,
    device_id uuid NOT NULL,
    name varchar(128) NOT NULL,
    runtime_id varchar(64) NOT NULL CHECK (runtime_id = 'openai-sdk'),
    workspace_root varchar(512) NOT NULL,
    user_code_hash varchar(64) NOT NULL UNIQUE,
    poll_secret_hash varchar(64) NOT NULL,
    user_id uuid REFERENCES users(id),
    user_identity_id uuid REFERENCES user_identities(id),
    oidc_client_id varchar(255) NOT NULL DEFAULT '',
    generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0),
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    confirmed_at timestamptz,
    exchanged_at timestamptz,
    CHECK ((confirmed_at IS NULL AND user_id IS NULL AND user_identity_id IS NULL)
        OR (confirmed_at IS NOT NULL AND user_id IS NOT NULL AND user_identity_id IS NOT NULL AND oidc_client_id <> '')),
    CHECK (exchanged_at IS NULL OR confirmed_at IS NOT NULL)
);
CREATE INDEX idx_edge_enrollments_expiry ON edge_enrollments(expires_at);

CREATE TABLE IF NOT EXISTS edge_device_credentials (
    device_id uuid PRIMARY KEY REFERENCES devices(id),
    target_id uuid NOT NULL UNIQUE REFERENCES execution_targets(id),
    user_id uuid NOT NULL REFERENCES users(id),
    user_identity_id uuid NOT NULL REFERENCES user_identities(id),
    oidc_client_id varchar(255) NOT NULL CHECK (oidc_client_id <> ''),
    generation bigint NOT NULL CHECK (generation >= 0),
    credential_hash varchar(64) NOT NULL UNIQUE,
    runtime_id varchar(64) NOT NULL CHECK (runtime_id = 'openai-sdk'),
    workspace_root varchar(512) NOT NULL,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_edge_device_credentials_identity ON edge_device_credentials(user_identity_id);
CREATE INDEX IF NOT EXISTS idx_edge_device_credentials_expiry ON edge_device_credentials(expires_at);

-- Reattach ownership constraints when reapplying after the security-preserving
-- down migration, which retains revoked credential routing markers.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'edge_device_credentials'::regclass AND conname = 'edge_device_credentials_device_id_fkey') THEN
        ALTER TABLE edge_device_credentials ADD CONSTRAINT edge_device_credentials_device_id_fkey FOREIGN KEY (device_id) REFERENCES devices(id);
        ALTER TABLE edge_device_credentials ADD CONSTRAINT edge_device_credentials_target_id_fkey FOREIGN KEY (target_id) REFERENCES execution_targets(id);
        ALTER TABLE edge_device_credentials ADD CONSTRAINT edge_device_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
        ALTER TABLE edge_device_credentials ADD CONSTRAINT edge_device_credentials_user_identity_id_fkey FOREIGN KEY (user_identity_id) REFERENCES user_identities(id);
    END IF;
END $$;

ALTER TABLE pending_agent_tasks ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz;
ALTER TABLE pending_agent_tasks ADD COLUMN IF NOT EXISTS cancel_applied_at timestamptz;
ALTER TABLE pending_agent_tasks ADD COLUMN IF NOT EXISTS cancel_error text NOT NULL DEFAULT '';

-- Isolate outbound paired polling from the legacy push worker. Persist the
-- authorization generation's opaque digest outside the dispatch payload so
-- re-enrollment cannot inherit tasks authorized for the previous credential.
ALTER TABLE delivery_outbox ADD COLUMN IF NOT EXISTS transport varchar(16) NOT NULL DEFAULT 'push';
ALTER TABLE delivery_outbox ADD COLUMN IF NOT EXISTS paired_credential_hash varchar(64) NOT NULL DEFAULT '';
