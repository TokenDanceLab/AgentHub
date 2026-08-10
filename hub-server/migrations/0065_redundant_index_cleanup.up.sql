-- 0065_redundant_index_cleanup.up.sql
-- P1 hygiene: drop three redundant secondary indexes whose lookup path is
-- already satisfied by a unique constraint or a composite index whose left
-- prefix is the same column. Each drop is safe because PostgreSQL can plan the
-- same queries off the surviving index/constraint; keeping the duplicate only
-- wastes write amplification (every INSERT/UPDATE maintains two b-trees) and
-- planner time.
--
-- Inventory (verified against source migrations):
--   1. idx_delivery_outbox_delivery_id (0052:19)
--      ON delivery_outbox(delivery_id)
--      REDUNDANT: delivery_outbox.delivery_id is declared
--                 `VARCHAR(128) NOT NULL UNIQUE` (0052:5), so a unique b-tree
--                 already exists on (delivery_id). This plain index is a
--                 strictly-worse duplicate.
--   2. idx_agent_team_events_run_id (0036:10)
--      ON agent_team_events(team_run_id)
--      REDUNDANT: 0056 installed uq_agent_team_events_run_seq on
--                 (team_run_id, seq). The single-column index is a left-prefix
--                 of that unique index, so any (team_run_id) lookup is served
--                 by the unique index's leftmost column.
--   3. idx_notifications_user_id (0041:3)
--      ON notifications(user_id)
--      REDUNDANT: 0013 installed idx_notifications_user_read_created on
--                 (user_id, read, created_at DESC). The single-column index is
--                 a left-prefix of that composite index.
--
-- Idempotent: DROP INDEX IF EXISTS is a no-op if the index was already dropped
-- (e.g. by a manual cleanup or a re-run of this migration). The three names
-- are not reused by any other migration, so dropping them cannot affect any
-- other index/constraint.

DROP INDEX IF EXISTS idx_delivery_outbox_delivery_id;
DROP INDEX IF EXISTS idx_agent_team_events_run_id;
DROP INDEX IF EXISTS idx_notifications_user_id;
