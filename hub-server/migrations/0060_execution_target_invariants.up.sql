-- 0060_execution_target_invariants.up.sql
-- ExecutionTarget 数据库不变量（#1545）：
--   1. active (owner_id, name) partial unique index — 并发创建同名 target
--      只有一个成功；soft delete 后名字可复用（deleted_at IS NULL 才计数）。
--   2. target_type / trust_level / health_state / auth_method 枚举 CHECK —
--      service 校验之外的数据库兜底，任何写路径（含未来的后台任务）
--      都不能写入非法状态。
--   3. port 范围 CHECK — 0 是合法默认值，禁止负数和 >65535。
-- 说明：target_type × host/device 组合约束在 service 层执行（#1545 决策：
-- local_edge/hub_relay 以 route/device 为证据，remote_* 需要 host；DB 层
-- 不加组合 CHECK 以避免与历史数据/兼容路径冲突，service 返回稳定错误码）。

-- 1. Active name uniqueness (owner-scoped, soft-delete aware).
CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_targets_active_name_unique
    ON execution_targets(owner_id, name)
    WHERE deleted_at IS NULL;

-- 2. Enum CHECK constraints.
ALTER TABLE execution_targets
    ADD CONSTRAINT chk_execution_targets_type
    CHECK (target_type IN ('local_edge', 'remote_ssh', 'tailscale', 'cloud_edge', 'hub_relay'));

ALTER TABLE execution_targets
    ADD CONSTRAINT chk_execution_targets_trust
    CHECK (trust_level IN ('local', 'remote', 'cloud', 'relay'));

ALTER TABLE execution_targets
    ADD CONSTRAINT chk_execution_targets_health
    CHECK (health_state IN ('unknown', 'healthy', 'online', 'degraded', 'offline', 'stale', 'mismatch', 'registered'));

ALTER TABLE execution_targets
    ADD CONSTRAINT chk_execution_targets_auth
    CHECK (auth_method IN ('', 'none', 'ssh_tunnel', 'tailscale_mtls', 'hub_jwt'));

-- 3. Port range (0 = default port is legal).
ALTER TABLE execution_targets
    ADD CONSTRAINT chk_execution_targets_port
    CHECK (port >= 0 AND port <= 65535);
