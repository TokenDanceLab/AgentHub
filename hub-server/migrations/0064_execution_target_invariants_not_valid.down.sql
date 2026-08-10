-- 0064_execution_target_invariants_not_valid.down.sql
-- Down for 0064: drop the five NOT VALID CHECK constraints installed above.
-- Idempotent (DROP IF EXISTS on every one); safe regardless of whether 0064's
-- up finished mid-diagnostic-block.

ALTER TABLE execution_targets DROP CONSTRAINT IF EXISTS chk_execution_targets_port;
ALTER TABLE execution_targets DROP CONSTRAINT IF EXISTS chk_execution_targets_auth;
ALTER TABLE execution_targets DROP CONSTRAINT IF EXISTS chk_execution_targets_health;
ALTER TABLE execution_targets DROP CONSTRAINT IF EXISTS chk_execution_targets_trust;
ALTER TABLE execution_targets DROP CONSTRAINT IF EXISTS chk_execution_targets_type;
