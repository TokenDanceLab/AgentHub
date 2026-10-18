-- 0064_execution_target_invariants_not_valid.up.sql
-- Follow-up to 0060: that migration added five CHECK constraints on
-- execution_targets with plain ADD CONSTRAINT, which validates every existing
-- row at commit and fails on the first violation. This migration re-installs
-- the same constraints with NOT VALID, so legacy rows are not re-scanned while
-- new and updated rows are checked immediately, then counts remaining
-- violations per constraint. Backfill of legacy violations is a separate
-- migration.
--
-- Why NOT VALID over plain ADD CONSTRAINT:
--   - ADD CONSTRAINT scans the whole table at commit time and fails on any
--     violation.
--   - NOT VALID skips the scan; the constraint is enforced on writes from the
--     moment it lands. Legacy rows that already violate the predicate are left
--     exactly as they are until a later backfill runs.
--   - Once the data is clean a later migration can VALIDATE CONSTRAINT (fast:
--     PostgreSQL does not re-scan row-by-row for VALIDATE either, it holds a
--     SHARE UPDATE EXCLUSIVE lock and rewrites nothing).
--
-- Idempotent: every DROP CONSTRAINT IF EXISTS / ADD CONSTRAINT NOT VALID pair
-- can be re-run. If a previous apply half-installed 0060's constraints this
-- migration first drops those half-installed copies, then adds its own NOT
-- VALID copy, so the end state is one named constraint per invariant.

-- Drop 0060's plain CHECK constraints (or a previous 0064 try) before
-- re-adding them as NOT VALID. DROP CONSTRAINT IF EXISTS is no-op if missing.
ALTER TABLE execution_targets DROP CONSTRAINT IF EXISTS chk_execution_targets_type;
ALTER TABLE execution_targets DROP CONSTRAINT IF EXISTS chk_execution_targets_trust;
ALTER TABLE execution_targets DROP CONSTRAINT IF EXISTS chk_execution_targets_health;
ALTER TABLE execution_targets DROP CONSTRAINT IF EXISTS chk_execution_targets_auth;
ALTER TABLE execution_targets DROP CONSTRAINT IF EXISTS chk_execution_targets_port;

-- Re-install the same five invariants from 0060 verbatim, but NOT VALID so
-- legacy rows are not re-scanned at commit. Identical predicate text means a
-- later VALIDATE CONSTRAINT lands in the same end-state 0060 was aiming for.
ALTER TABLE execution_targets
    ADD CONSTRAINT chk_execution_targets_type
    CHECK (target_type IN ('local_edge', 'remote_ssh', 'tailscale', 'cloud_edge', 'hub_relay')) NOT VALID;

ALTER TABLE execution_targets
    ADD CONSTRAINT chk_execution_targets_trust
    CHECK (trust_level IN ('local', 'remote', 'cloud', 'relay')) NOT VALID;

ALTER TABLE execution_targets
    ADD CONSTRAINT chk_execution_targets_health
    CHECK (health_state IN ('unknown', 'healthy', 'online', 'degraded', 'offline', 'stale', 'mismatch', 'registered')) NOT VALID;

ALTER TABLE execution_targets
    ADD CONSTRAINT chk_execution_targets_auth
    CHECK (auth_method IN ('', 'none', 'ssh_tunnel', 'tailscale_mtls', 'hub_jwt')) NOT VALID;

ALTER TABLE execution_targets
    ADD CONSTRAINT chk_execution_targets_port
    CHECK (port >= 0 AND port <= 65535) NOT VALID;

-- Diagnostic: count violations per constraint. Zero violations → immediately
-- VALIDATE CONSTRAINT (cheapest forward-only end-state). Any violations →
-- leave the constraint NOT VALID; a later backfill cleans
-- the rows and a later migration VALIDATEs. This block never raises an
-- exception (NOTICE only), so a database with dirty legacy rows still
-- upgrades cleanly — exactly what 0060 was missing.
DO $$
DECLARE
    type_violations    integer;
    trust_violations   integer;
    health_violations  integer;
    auth_violations    integer;
    port_violations    integer;
BEGIN
    SELECT count(*) INTO type_violations   FROM execution_targets WHERE target_type   NOT IN ('local_edge', 'remote_ssh', 'tailscale', 'cloud_edge', 'hub_relay');
    SELECT count(*) INTO trust_violations  FROM execution_targets WHERE trust_level  NOT IN ('local', 'remote', 'cloud', 'relay');
    SELECT count(*) INTO health_violations FROM execution_targets WHERE health_state NOT IN ('unknown', 'healthy', 'online', 'degraded', 'offline', 'stale', 'mismatch', 'registered');
    SELECT count(*) INTO auth_violations   FROM execution_targets WHERE auth_method  NOT IN ('', 'none', 'ssh_tunnel', 'tailscale_mtls', 'hub_jwt');
    SELECT count(*) INTO port_violations   FROM execution_targets WHERE NOT (port >= 0 AND port <= 65535);

    RAISE NOTICE '0064 violation scan: type=%, trust=%, health=%, auth=%, port=%',
        type_violations, trust_violations, health_violations, auth_violations, port_violations;

    IF type_violations = 0 THEN
        ALTER TABLE execution_targets VALIDATE CONSTRAINT chk_execution_targets_type;
        RAISE NOTICE '0064: chk_execution_targets_type VALIDATED';
    ELSE
        RAISE NOTICE '0064: chk_execution_targets_type left NOT VALID (% rows to backfill)', type_violations;
    END IF;

    IF trust_violations = 0 THEN
        ALTER TABLE execution_targets VALIDATE CONSTRAINT chk_execution_targets_trust;
        RAISE NOTICE '0064: chk_execution_targets_trust VALIDATED';
    ELSE
        RAISE NOTICE '0064: chk_execution_targets_trust left NOT VALID (% rows to backfill)', trust_violations;
    END IF;

    IF health_violations = 0 THEN
        ALTER TABLE execution_targets VALIDATE CONSTRAINT chk_execution_targets_health;
        RAISE NOTICE '0064: chk_execution_targets_health VALIDATED';
    ELSE
        RAISE NOTICE '0064: chk_execution_targets_health left NOT VALID (% rows to backfill)', health_violations;
    END IF;

    IF auth_violations = 0 THEN
        ALTER TABLE execution_targets VALIDATE CONSTRAINT chk_execution_targets_auth;
        RAISE NOTICE '0064: chk_execution_targets_auth VALIDATED';
    ELSE
        RAISE NOTICE '0064: chk_execution_targets_auth left NOT VALID (% rows to backfill)', auth_violations;
    END IF;

    IF port_violations = 0 THEN
        ALTER TABLE execution_targets VALIDATE CONSTRAINT chk_execution_targets_port;
        RAISE NOTICE '0064: chk_execution_targets_port VALIDATED';
    ELSE
        RAISE NOTICE '0064: chk_execution_targets_port left NOT VALID (% rows to backfill)', port_violations;
    END IF;
END $$;
