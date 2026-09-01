-- P2 notifications list performance (#2154 Ampere database lane).
--
-- ListNotifications runs
--   WHERE user_id = ? [AND read = false] ORDER BY created_at DESC LIMIT ? OFFSET ?
-- The composite index surviving from 0013,
-- idx_notifications_user_read_created (user_id, read, created_at DESC), serves
-- the user_id filter, but `read` sits between the filter column and the sort
-- column: the full list path (no `read` predicate) cannot use the index
-- ordering and degrades to in-memory quicksort + OFFSET over the user's whole
-- row set (EXPLAIN-verified on PG16). The unread-only path keeps using the
-- composite index (equality on user_id + read, then created_at DESC).
--
-- Add the missing (user_id, created_at DESC) index so the common full list
-- path is a pure index scan + LIMIT with no sort node.
-- Idempotent: IF NOT EXISTS keeps re-runs and down/up cycles safe.
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
    ON notifications (user_id, created_at DESC);
