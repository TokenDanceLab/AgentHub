-- 0061_audit_rechain_trigger_fix.up.sql
-- Fix P0: migration 0058 re-chains audit_events via UPDATE, but migration 0040
-- installs a BEFORE UPDATE trigger (trg_audit_events_no_update) that raises an
-- exception on any UPDATE. 0040 is applied before 0058 (40 < 58), so 0058's
-- re-chain DO block cannot run on a real PostgreSQL database — the migration
-- upgrade/downgrade is double-broken (a deploy bomb).
--
-- Per the migration-immutability rule, 0040 and 0058 are NOT modified. This
-- migration (0061) re-runs the content-hash re-chain with the 0040 triggers
-- temporarily disabled, exactly the way tests/integration/audit_chain_test.go
-- already bypass them (ALTER TABLE ... DISABLE TRIGGER USER). It is
-- self-contained and idempotent so it produces the correct end state whether or
-- not 0058's DO block previously succeeded:
--   1. (re)create audit_canonical_content() — CREATE OR REPLACE is a no-op if
--      0058 already installed the same function body.
--   2. DISABLE TRIGGER USER on audit_events (suspend 0040's append-only guard).
--   3. Re-chain every row by content (prev_hash = SHA256(prev_id || prev_hash ||
--      canonical(prev content))). Idempotent: re-computing the same hash from
--      the same ordered inputs yields the same value, so already-correct rows
--      are rewritten with an identical value.
--   4. Re-create the prev_hash unique index (idempotent).
--   5. ENABLE TRIGGER USER — restore 0040's append-only guard.
--
-- Safety: DISABLE/ENABLE TRIGGER USER runs in the same migration transaction.
-- golang-migrate applies each .up.sql as one transaction, so the triggers are
-- guaranteed to be re-enabled on commit (or the whole migration rolls back,
-- leaving the triggers as they were before 0061 ran).

-- 1. (Re)create the canonical content encoder. Identical to 0058's body so a
--    database where 0058 applied its function but not its DO block still lines
--    up byte-for-byte with the Go-side model.canonicalContent.
CREATE OR REPLACE FUNCTION audit_canonical_content(
  p_user_id text, p_profile_id text, p_target_id text, p_event_type text,
  p_severity text, p_summary text, p_details text, p_client_ip text,
  p_created_at timestamptz
) RETURNS text AS $$
DECLARE
  created_nano text;
BEGIN
  created_nano := (EXTRACT(EPOCH FROM p_created_at) * 1000000000)::bigint::text;
  RETURN
    length(p_user_id)::text || ':' || p_user_id ||
    length(coalesce(p_profile_id, ''))::text || ':' || coalesce(p_profile_id, '') ||
    length(coalesce(p_target_id, ''))::text || ':' || coalesce(p_target_id, '') ||
    length(p_event_type)::text || ':' || p_event_type ||
    length(p_severity)::text || ':' || p_severity ||
    length(p_summary)::text || ':' || p_summary ||
    length(p_details)::text || ':' || p_details ||
    length(p_client_ip)::text || ':' || p_client_ip ||
    length(created_nano)::text || ':' || created_nano;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2. Suspend 0040's append-only triggers so the re-chain UPDATE can run.
--    USER targets only session-owned triggers (the three 0040 triggers); it
--    does NOT touch system triggers or replication triggers.
ALTER TABLE audit_events DISABLE TRIGGER USER;

-- 3. Re-chain: by creation order, recompute prev_hash = SHA256(prev_id ||
--    prev_hash || canonical(prev content)). The first row keeps prev_hash = ''.
--    Idempotent — re-running on an already-correct chain rewrites identical
--    hashes, and SELECT-only iterations (no UPDATE) cost nothing on rows whose
--    hash did not change.
DO $$
DECLARE
  rec RECORD;
  prev_hash_val varchar(64) := '';
  prev_id_val uuid;
  prev_user_id text := '';
  prev_profile_id text := '';
  prev_target_id text := '';
  prev_event_type text := '';
  prev_severity text := '';
  prev_summary text := '';
  prev_details text := '';
  prev_client_ip text := '';
  prev_created_at timestamptz;
  new_hash text;
BEGIN
  FOR rec IN
    SELECT id, user_id, profile_id, target_id, event_type, severity, summary,
           details, client_ip, created_at, prev_hash
    FROM audit_events
    ORDER BY created_at ASC, id ASC
  LOOP
    IF prev_id_val IS NOT NULL THEN
      new_hash := encode(
        digest(
          prev_id_val::text || prev_hash_val ||
          audit_canonical_content(
            prev_user_id, prev_profile_id, prev_target_id,
            prev_event_type, prev_severity, prev_summary, prev_details,
            prev_client_ip, prev_created_at),
          'sha256'),
        'hex');
    ELSE
      new_hash := '';
    END IF;
    -- Only UPDATE when the hash actually changes; on an already-correct chain
    -- this avoids touching rows and keeps the migration cheap + idempotent.
    IF new_hash IS DISTINCT FROM rec.prev_hash THEN
      UPDATE audit_events SET prev_hash = new_hash WHERE id = rec.id;
    END IF;
    prev_hash_val := new_hash;
    prev_id_val := rec.id;
    prev_user_id := rec.user_id;
    prev_profile_id := rec.profile_id;
    prev_target_id := rec.target_id;
    prev_event_type := rec.event_type;
    prev_severity := rec.severity;
    prev_summary := rec.summary;
    prev_details := rec.details::text;
    prev_client_ip := rec.client_ip;
    prev_created_at := rec.created_at;
  END LOOP;
END $$;

-- 4. Re-create the fork-defense unique index (idempotent).
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_events_prev_hash_unique ON audit_events(prev_hash);

-- 5. Restore 0040's append-only triggers.
ALTER TABLE audit_events ENABLE TRIGGER USER;
