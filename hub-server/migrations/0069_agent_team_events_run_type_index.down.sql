-- 0069 down: drop the (team_run_id, type) composite index. Reverts to the
-- pre-0069 state where only uq_agent_team_events_run_seq covers team_run_id.

DROP INDEX IF EXISTS idx_agent_team_events_run_type;
