-- 0060_execution_target_invariants.down.sql
-- 回滚 ExecutionTarget 数据库不变量（#1545）。

ALTER TABLE execution_targets DROP CONSTRAINT IF EXISTS chk_execution_targets_port;
ALTER TABLE execution_targets DROP CONSTRAINT IF EXISTS chk_execution_targets_auth;
ALTER TABLE execution_targets DROP CONSTRAINT IF EXISTS chk_execution_targets_health;
ALTER TABLE execution_targets DROP CONSTRAINT IF EXISTS chk_execution_targets_trust;
ALTER TABLE execution_targets DROP CONSTRAINT IF EXISTS chk_execution_targets_type;
DROP INDEX IF EXISTS idx_execution_targets_active_name_unique;
