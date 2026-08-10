-- 0062_agent_team_runs_indexes.down.sql
-- Reverse of 0062: drop the two covering indexes. agent_team_runs reverts to
-- full-scan behavior for GetTeamRunBySessionID and ListTeamRunsByTeam (the
-- pre-0062 state).
DROP INDEX IF EXISTS idx_agent_team_runs_session_created;
DROP INDEX IF EXISTS idx_agent_team_runs_team_created;
