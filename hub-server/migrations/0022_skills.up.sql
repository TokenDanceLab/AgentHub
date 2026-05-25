CREATE TABLE skills (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id      UUID NOT NULL REFERENCES users(id),
    name          VARCHAR(128) NOT NULL,
    description   TEXT DEFAULT '',
    skill_type    VARCHAR(32) NOT NULL DEFAULT 'agent_skill',
    runtime_ids   JSONB DEFAULT '[]',
    entry_point   VARCHAR(512) DEFAULT '',
    config_schema JSONB DEFAULT '{}',
    is_public     BOOLEAN DEFAULT FALSE,
    version       VARCHAR(32) DEFAULT '1.0.0',
    install_count INT DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at    TIMESTAMPTZ
);
CREATE INDEX idx_skills_owner ON skills(owner_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_skills_public ON skills(is_public) WHERE is_public = TRUE AND deleted_at IS NULL;
