-- Revert 0056: drop the unique index and restore the plain composite index
-- from 0036. The seq resequencing of historical duplicates is not reverted:
-- it only normalized ordering metadata and the original duplicate seq values
-- are not recoverable (nor desirable).
DROP INDEX IF EXISTS uq_agent_team_events_run_seq;
CREATE INDEX IF NOT EXISTS idx_agent_team_events_run_seq
    ON agent_team_events (team_run_id, seq);
