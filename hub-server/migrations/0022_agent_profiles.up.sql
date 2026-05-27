CREATE TABLE agent_profiles (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id          UUID NOT NULL REFERENCES users(id),
    name              VARCHAR(128) NOT NULL,
    description       TEXT DEFAULT '',
    runtime_id        VARCHAR(64) NOT NULL,
    model             VARCHAR(128) DEFAULT '',
    provider          VARCHAR(64) DEFAULT '',
    reasoning_effort  VARCHAR(32) DEFAULT 'medium',
    model_mapping     JSONB DEFAULT '{}',
    skills            JSONB DEFAULT '[]',
    mcp_servers       JSONB DEFAULT '[]',
    tool_allowlist    JSONB DEFAULT '[]',
    approval_policy   JSONB DEFAULT '{}',
    permission_mode   VARCHAR(32) DEFAULT 'default',
    target_preferences JSONB DEFAULT '{}',
    context_budget_max_tokens INT DEFAULT 200000,
    is_public         BOOLEAN DEFAULT FALSE,
    install_count     INT DEFAULT 0,
    rating_avg        DECIMAL(3,2) DEFAULT 0,
    rating_count      INT DEFAULT 0,
    version           INT DEFAULT 1,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at        TIMESTAMPTZ
);

CREATE INDEX idx_agent_profiles_owner ON agent_profiles(owner_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_agent_profiles_public ON agent_profiles(is_public) WHERE is_public = TRUE AND deleted_at IS NULL;
CREATE INDEX idx_agent_profiles_runtime ON agent_profiles(runtime_id);
