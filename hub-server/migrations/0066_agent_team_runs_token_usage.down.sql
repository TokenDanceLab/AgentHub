-- 0066_agent_team_runs_token_usage.down.sql
-- Down for 0066: drop the token_usage_total counter column added by the up.
-- Safe to run on any state (IF EXISTS would not be needed for DROP COLUMN in
-- strict PG, but the column is nullable and its absence is the pre-0066
-- state). After this down, the guard reverts to the full event-scan
-- projection only.
ALTER TABLE agent_team_runs DROP COLUMN IF EXISTS token_usage_total;
