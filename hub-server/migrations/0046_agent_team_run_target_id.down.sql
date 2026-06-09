DROP INDEX IF EXISTS idx_agent_team_runs_target_id;

ALTER TABLE agent_team_runs
    DROP COLUMN IF EXISTS target_id;
