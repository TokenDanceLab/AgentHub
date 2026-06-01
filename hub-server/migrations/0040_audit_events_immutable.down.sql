-- 0040_audit_events_immutable.down.sql
-- Reverts the immutable audit_events changes.

-- 1. Remove triggers.
DROP TRIGGER IF EXISTS trg_audit_events_no_update ON audit_events;
DROP TRIGGER IF EXISTS trg_audit_events_no_delete ON audit_events;

-- 2. Drop the trigger function.
DROP FUNCTION IF EXISTS audit_events_protect();

-- 3. Drop the prev_hash index.
DROP INDEX IF EXISTS idx_audit_events_prev_hash;

-- 4. Remove prev_hash column.
ALTER TABLE audit_events DROP COLUMN IF EXISTS prev_hash;
