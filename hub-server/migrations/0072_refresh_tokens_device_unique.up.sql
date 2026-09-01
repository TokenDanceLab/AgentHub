-- #2154 (database-lane P2-2): UpsertRefreshToken uses
-- ON CONFLICT (user_id, device_type, device_id), which PostgreSQL only
-- accepts against a UNIQUE index/constraint. Migration 0015 created
-- idx_refresh_tokens_user_device as a plain (non-unique) index, so every
-- rotation/login upsert fails with SQLSTATE 42P10 on a migrations-only
-- schema. This migration upgrades the index to unique.
--
-- Idempotent by construction: dedupe keeps one row per (user_id,
-- device_type, device_id) key (newest expiry wins), then recreates the
-- index as UNIQUE with IF NOT EXISTS guards.

DELETE FROM refresh_tokens
WHERE id IN (
    SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                   PARTITION BY user_id, device_type, device_id
                   ORDER BY expires_at DESC, created_at DESC
               ) AS rn
        FROM refresh_tokens
    ) ranked
    WHERE rn > 1
);

DROP INDEX IF EXISTS idx_refresh_tokens_user_device;
CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_tokens_user_device
    ON refresh_tokens (user_id, device_type, device_id);
