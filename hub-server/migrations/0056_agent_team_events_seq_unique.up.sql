-- 0056: enforce per-run uniqueness of agent_team_events.seq (#1383).
--
-- AppendTeamEvent computed MAX(seq)+1 with a plain read-then-insert, so two
-- concurrent appends for the same run could commit the same seq and corrupt
-- replay ordering. A unique index turns the lost race into a 23505 the
-- repository retries; this migration first repairs any historical duplicates
-- so the index can be created.
--
-- Step 1 (idempotent repair): resequence each run's events by
-- (seq, created_at, id) so relative order is preserved and no rows are
-- deleted — the event log is append-only and duplicate seq rows still carry
-- distinct payloads. Runs that are already unique and contiguous are left
-- untouched (seq IS DISTINCT FROM new_seq matches zero rows), so re-running
-- this statement is a no-op.
WITH ordered AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY team_run_id
               ORDER BY seq ASC, created_at ASC, id ASC
           ) AS new_seq
    FROM agent_team_events
)
UPDATE agent_team_events AS e
SET seq = o.new_seq
FROM ordered AS o
WHERE e.id = o.id
  AND e.seq IS DISTINCT FROM o.new_seq;

-- Step 2: replace the plain composite index from 0036 with a unique index.
-- The unique index serves the same (team_run_id, seq) lookups, so keeping
-- both would be redundant.
DROP INDEX IF EXISTS idx_agent_team_events_run_seq;
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_team_events_run_seq
    ON agent_team_events (team_run_id, seq);
