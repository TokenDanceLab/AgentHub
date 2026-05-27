CREATE TABLE execution_targets (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id       UUID NOT NULL REFERENCES users(id),
    device_id      UUID REFERENCES devices(id),
    name           VARCHAR(128) NOT NULL,
    target_type    VARCHAR(32) NOT NULL DEFAULT 'local_edge',
    host           VARCHAR(256) DEFAULT '',
    port           INT DEFAULT 0,
    workspace_root VARCHAR(512) DEFAULT '',
    auth_method    VARCHAR(32) DEFAULT '',
    is_online      BOOLEAN DEFAULT FALSE,
    last_seen_at   TIMESTAMPTZ,
    capabilities   JSONB DEFAULT '{}',
    metadata       JSONB DEFAULT '{}',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at     TIMESTAMPTZ
);
CREATE INDEX idx_execution_targets_owner ON execution_targets(owner_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_execution_targets_device ON execution_targets(device_id);
