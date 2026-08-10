-- 0063_agent_run_events_unique_seq.down.sql
-- Revert 0063: drop the unique index and restore the plain composite index
-- from 0029. The event_seq resequencing of historical duplicates is not
-- reverted: it only normalized ordering metadata and the original duplicate
-- seq values are not recoverable (nor desirable). Mirrors 0056.down policy.
DROP INDEX IF EXISTS uq_agent_run_events_task_seq;
CREATE INDEX IF NOT EXISTS idx_agent_run_events_task_seq
    ON agent_run_events (task_id, event_seq);
