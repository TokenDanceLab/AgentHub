-- 0040_audit_events_immutable.up.sql
-- Adds hash-chain support and makes audit_events table append-only.

-- 1. Add prev_hash column for hash-chain integrity.
ALTER TABLE audit_events
    ADD COLUMN IF NOT EXISTS prev_hash VARCHAR(64) NOT NULL DEFAULT '';

-- 2. Backfill prev_hash for existing records.
--    Process in creation order so each row's prev_hash is computed from the
--    preceding row's (id, prev_hash).
DO $$
DECLARE
    rec RECORD;
    prev_hash_val VARCHAR(64) := '';
    prev_id_val   UUID;
BEGIN
    FOR rec IN
        SELECT id FROM audit_events ORDER BY created_at ASC, id ASC
    LOOP
        IF prev_id_val IS NOT NULL THEN
            prev_hash_val := encode(
                digest(prev_id_val::text || prev_hash_val, 'sha256'),
                'hex'
            );
        ELSE
            prev_hash_val := '';
        END IF;
        UPDATE audit_events SET prev_hash = prev_hash_val WHERE id = rec.id;
        prev_id_val := rec.id;
    END LOOP;
END $$;

-- 3. Create a trigger function that prevents UPDATE and DELETE on audit_events.
--    TRUNCATE is also prevented (only superuser can bypass).
CREATE OR REPLACE FUNCTION audit_events_protect()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'audit_events table is append-only: UPDATE is forbidden';
    ELSIF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'audit_events table is append-only: DELETE is forbidden';
    ELSIF TG_OP = 'TRUNCATE' THEN
        RAISE EXCEPTION 'audit_events table is append-only: TRUNCATE is forbidden';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers only if they don't already exist.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_audit_events_no_update'
          AND tgrelid = 'audit_events'::regclass
    ) THEN
        CREATE TRIGGER trg_audit_events_no_update
            BEFORE UPDATE ON audit_events
            FOR EACH STATEMENT
            EXECUTE FUNCTION audit_events_protect();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_audit_events_no_delete'
          AND tgrelid = 'audit_events'::regclass
    ) THEN
        CREATE TRIGGER trg_audit_events_no_delete
            BEFORE DELETE ON audit_events
            FOR EACH STATEMENT
            EXECUTE FUNCTION audit_events_protect();
    END IF;
END $$;

-- 4. Add index on prev_hash for chain verification queries.
CREATE INDEX IF NOT EXISTS idx_audit_events_prev_hash ON audit_events(prev_hash);
