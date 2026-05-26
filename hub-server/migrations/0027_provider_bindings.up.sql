CREATE TABLE provider_bindings (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id      UUID NOT NULL REFERENCES users(id),
    binding_name  VARCHAR(64) DEFAULT '',
    provider      VARCHAR(64) NOT NULL,
    base_url      VARCHAR(512) DEFAULT '',
    is_available  BOOLEAN DEFAULT TRUE,
    quota_used    BIGINT DEFAULT 0,
    quota_limit   BIGINT DEFAULT 0,
    last_checked  TIMESTAMPTZ,
    metadata      JSONB DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_provider_bindings_owner ON provider_bindings(owner_id);
