ALTER TABLE agent_team_runs
    ADD COLUMN IF NOT EXISTS target_id UUID;

CREATE INDEX IF NOT EXISTS idx_agent_team_runs_target_id
    ON agent_team_runs(target_id)
    WHERE target_id IS NOT NULL;
