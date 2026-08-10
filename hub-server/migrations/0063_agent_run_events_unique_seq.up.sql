-- 0063_agent_run_events_unique_seq.up.sql
-- Enforce per-task uniqueness of agent_run_events.event_seq.
--
-- CreateAgentRunEventWithNextSeqLimited (repository/agent.go:303) computes
-- MAX(event_seq)+1 with a read-then-insert inside one transaction. Without a
-- unique index, two concurrent writers for the same task_id that bypassed the
-- row lock (or a future code path that forgets the lock) can commit the same
-- event_seq and corrupt replay ordering. A unique index turns the lost race
-- into a 23505 the repository can retry.
--
-- Step 1 (idempotent repair, 0056-style): resequence each task's events by
-- (event_seq, created_at, id) so relative order is preserved and no rows are
-- deleted — the event log is append-only and duplicate-seq rows still carry
-- distinct payloads. Tasks that are already unique and contiguous are left
-- untouched (event_seq IS DISTINCT FROM new_seq matches zero rows), so
-- re-running this statement is a no-op.
WITH ordered AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY task_id
               ORDER BY event_seq ASC, created_at ASC, id ASC
           ) AS new_seq
    FROM agent_run_events
)
UPDATE agent_run_events AS e
SET event_seq = o.new_seq
FROM ordered AS o
WHERE e.id = o.id
  AND e.event_seq IS DISTINCT FROM o.new_seq;

-- Step 2: replace the plain composite index from 0029 with a unique index.
-- The unique index serves the same (task_id, event_seq) lookups used by
-- ListAgentRunEventsByTaskIDFiltered, so keeping both would be redundant.
DROP INDEX IF EXISTS idx_agent_run_events_task_seq;
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_run_events_task_seq
    ON agent_run_events (task_id, event_seq);
