-- 0062_agent_team_runs_indexes.up.sql
-- Add covering indexes for the two agent_team_runs query paths that currently
-- full-scan the table:
--   - GetTeamRunBySessionID: WHERE session_id = ? ORDER BY created_at DESC
--     (repository/agent_team.go) — used on every team-session load.
--   - ListTeamRunsByTeam: WHERE team_id = ? ORDER BY created_at DESC LIMIT 200
--     (repository/agent_team.go) — used to list a team's run history.
-- Both indexes are (filter_col, created_at DESC) so the ORDER BY can be served
-- from the index without a sort step.

CREATE INDEX IF NOT EXISTS idx_agent_team_runs_session_created
    ON agent_team_runs (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_team_runs_team_created
    ON agent_team_runs (team_id, created_at DESC);
