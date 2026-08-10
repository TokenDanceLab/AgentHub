-- 0065_redundant_index_cleanup.down.sql
-- Down for 0065: recreate the three plain secondary indexes that were dropped
-- above, restoring the pre-0065 state for anyone who rolls back. Definitions
-- are taken verbatim from the original creating migrations (0052, 0036, 0041)
-- so the schema is byte-identical to before 0065 ran.
--
-- Idempotent: every CREATE INDEX IF NOT EXISTS is a no-op if the index already
-- exists (e.g. on a database that never applied 0065, or a re-run of this
-- down). This makes the down safe to apply on any state.

-- From 0052 (delivery_outbox). Original: plain CREATE INDEX (no IF NOT EXISTS).
-- Recreated with IF NOT EXISTS so the down is idempotent across re-runs.
CREATE INDEX IF NOT EXISTS idx_delivery_outbox_delivery_id
    ON delivery_outbox(delivery_id);

-- From 0036 (agent_team_events). Original: plain CREATE INDEX.
CREATE INDEX IF NOT EXISTS idx_agent_team_events_run_id
    ON agent_team_events(team_run_id);

-- From 0041 (notifications). Original already used IF NOT EXISTS.
CREATE INDEX IF NOT EXISTS idx_notifications_user_id
    ON notifications(user_id);
