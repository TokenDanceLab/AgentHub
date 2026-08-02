-- 0059_execution_target_evidence.up.sql
-- 健康证据持久化（#1544）：ExecutionTarget 的 health_state/is_online/last_seen_at
-- 三个等价字段曾被多个写路径（Ping、设备注册、HTTP probe）独立修改，且
-- local_edge 的 manual ping 直接写 online 而没有任何探测。本 migration 引入
-- 每 target 一条最新 evidence 的单一写路径：
--   source  = registration | probe | relay_route   （证据来源）
--   status  = online | offline | mismatch | degraded | unknown
--   observed_target_id = probe 观测到的远端 target id（mismatch 判定）
--   route_key = hub_relay/local_edge 的路由标识（user:deviceType:deviceID）
--   observed_at / expires_at = 证据时间窗口；投影为 stale 当过期
-- 服务层不再直接写 execution_targets 的 health 字段；读侧由
-- dispatch.ResolveExecutionTargetHealthState(target, evidence, now) 纯投影。
-- 旧列 health_state/is_online/last_seen_at 保留作兼容读（迁移窗口），不新增写路径。

CREATE TABLE IF NOT EXISTS execution_target_evidence (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_id          UUID NOT NULL UNIQUE REFERENCES execution_targets(id) ON DELETE CASCADE,
    source             VARCHAR(32) NOT NULL,
    status             VARCHAR(32) NOT NULL,
    failure_category   VARCHAR(64) NOT NULL DEFAULT '',
    observed_target_id VARCHAR(128) NOT NULL DEFAULT '',
    route_key          VARCHAR(256) NOT NULL DEFAULT '',
    observed_at        TIMESTAMPTZ NOT NULL,
    expires_at         TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_execution_target_evidence_observed
    ON execution_target_evidence(target_id, observed_at DESC);
