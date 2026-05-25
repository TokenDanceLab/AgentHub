CREATE TABLE mcp_servers (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id      UUID NOT NULL REFERENCES users(id),
    name          VARCHAR(128) NOT NULL,
    transport     VARCHAR(32) NOT NULL DEFAULT 'stdio',
    command       VARCHAR(512) DEFAULT '',
    args          JSONB DEFAULT '[]',
    env_vars      JSONB DEFAULT '{}',
    url           VARCHAR(512) DEFAULT '',
    auth_type     VARCHAR(32) DEFAULT 'none',
    auth_config   JSONB DEFAULT '{}',
    tool_schema   JSONB DEFAULT '{}',
    is_public     BOOLEAN DEFAULT FALSE,
    install_count INT DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at    TIMESTAMPTZ
);
CREATE INDEX idx_mcp_servers_owner ON mcp_servers(owner_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_mcp_servers_public ON mcp_servers(is_public) WHERE is_public = TRUE AND deleted_at IS NULL;
