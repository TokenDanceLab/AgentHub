ALTER TABLE execution_targets
    ADD COLUMN IF NOT EXISTS workspace_allowlist JSONB DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS trust_level VARCHAR(32) DEFAULT 'local',
    ADD COLUMN IF NOT EXISTS health_state VARCHAR(32) DEFAULT 'unknown';
