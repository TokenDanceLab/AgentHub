ALTER TABLE execution_targets
    DROP COLUMN IF EXISTS health_state,
    DROP COLUMN IF EXISTS trust_level,
    DROP COLUMN IF EXISTS workspace_allowlist;
