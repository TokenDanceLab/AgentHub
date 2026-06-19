# ADR-016: Hub-Edge 投递保证 —— Outbox 模式

## Status

Accepted

## Context

**关联审计项：AH-SR-049**

当前 Hub Server 向 Edge Server 下发 Agent Run 时采用 **fire-and-forget** 模式：

1. Hub 通过 WebSocket/HTTP 向 Edge 发送 `run_start` 指令。
2. Hub 立即返回成功给调用方。
3. 如果 Edge 离线、网络中断、或 Edge 收到消息但处理失败，**Hub 无感知，状态永久分歧**。

已观测到的具体故障场景：

- **Edge 离线**：Hub 发送 `run_start` 时 Edge WebSocket 连接已断开，消息丢失。Hub 侧认为 Run 已下发，Edge 侧 Run 从未开始。
- **Edge 处理失败**：Edge 收到消息但因进程崩溃而未能启动 Agent 进程，Hub 侧无错误回调。
- **网络瞬断**：TCP 连接在消息发送后、ACK 返回前断开，Hub 不知道 Edge 是否收到。

这些场景导致 Hub 状态机（`RUN_STARTING`）与 Edge 实际状态（无此 Run）永久不一致，需要人工介入修复，严重影响 **S.U.P.E.R R（Reliability）** 评分。

## Decision

在 Hub Server 中实现 **Transactional Outbox 模式**（基于数据库），保证 at-least-once 投递：

### 架构

```
Hub Server
  ┌──────────────────────────────────┐
  │  1. 写入业务表 + outbox 同事务    │
  │     INSERT INTO agent_runs (...)  │
  │     INSERT INTO outbox (...)      │  ← 同一 DB 事务
  │           │                       │
  │  2. OutboxPoller (后台 goroutine) │
  │     SELECT ... FROM outbox        │
  │     WHERE status='pending'        │
  │     ORDER BY created_at           │
  │           │                       │
  │  3. EdgeDispatcher                │
  │     → 通过 WebSocket 发送给 Edge  │
  │     → 等待 ACK / 超时重试         │
  │           │                       │
  │  4. 标记 delivered / dead         │
  └──────────────────────────────────┘
```

### 数据库设计

```sql
CREATE TABLE outbox (
    id          BIGSERIAL PRIMARY KEY,
    aggregate   TEXT NOT NULL,         -- 'agent_run'
    event_type  TEXT NOT NULL,         -- 'run_start', 'run_cancel'
    payload     JSONB NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',  -- pending, delivered, dead
    retry_count INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 5,
    next_retry  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMPTZ
);

CREATE INDEX idx_outbox_status_next_retry ON outbox(status, next_retry);
```

### 投递流程

1. **事务写入**：创建 AgentRun 时，在同一事务中写入 outbox 记录（`event_type = 'run_start'`）。
2. **Poller 轮询**：后台 goroutine 每 500ms 查询 `status='pending' AND next_retry <= NOW()` 的记录。
3. **派发**：通过 Edge WebSocket 连接发送 payload，等待 ACK。
4. **ACK 处理**：收到 Edge 的 `run_start_ack` 后，标记 `status='delivered'`。
5. **重试**：无 ACK 时指数退避重试（1s → 2s → 4s → 8s → 16s），最多 5 次。
6. **死信**：5 次重试全部失败后标记 `status='dead'`，触发 metric 告警和日志。

### 边缘场景处理

- **Edge 重连**：Edge WebSocket 重连后，Poller 自动发现 pending 消息并重新派发。
- **幂等性**：Edge 通过 `run_id` 实现幂等——重复收到同一 `run_start` 时检查 Run 是否已存在。
- **去重**：Outbox 的 `(aggregate, event_type, payload->>'run_id')` 组合唯一约束防止重复写入。

## Alternatives

### 方案 A：同步投递（等待 Edge ACK 后返回）

Hub 发送 `run_start` 后阻塞等待 Edge 的 ACK，超时返回错误。

- **优点**：调用方即时感知投递结果，无需 outbox 表。
- **缺点**：增加 Run API 的 P99 延迟（Edge 网络 RTT + Agent 进程启动时间）；如果 Edge 离线，API 会一直超时；阻塞 Hub 的 goroutine 资源；不符合当前异步响应模式。
- **结论**：拒绝。Hub 的 Run API 应快速返回，投递保证应异步处理。

### 方案 B：引入外部消息队列（RabbitMQ / NATS）

在 Hub 和 Edge 之间部署消息队列作为中间层。

- **优点**：成熟的消息投递保证（ack、DLQ、延迟队列开箱即用）。
- **缺点**：引入新的基础设施依赖（MQ 集群）；增加部署复杂度（需要配置、监控、备份 MQ）；对于单服务规模的 AgentHub 属于过度设计；当前 WebSocket 直连架构需要大幅改造。
- **结论**：拒绝。DB-based outbox 对于当前规模已足够，引入外部 MQ 的成本/收益比不合理。

### 方案 C：不做改造，接受 fire-and-forget

继续当前模式，通过人工监控和告警发现不一致后手动修复。

- **优点**：零实现成本。
- **缺点**：不解决 SUPER 审计中 AH-SR-049 这一明确标记的可靠性问题；状态不一致会随着使用增加而累积；人工修复成本随时间增长。
- **结论**：拒绝。这是明确的审计整改项，不可回避。

## Consequences

**正面：**

- 实现 at-least-once 投递保证，Hub 与 Edge 状态最终一致性有可靠基础。
- 业务写入与消息写入同事务，无消息丢失窗口。
- 死信队列自动发现持续故障的 Edge 节点，运维可主动介入。
- Outbox 记录提供完整的投递审计日志，可追溯每条指令的派发历史。
- 不引入外部消息中间件，运维复杂度不增加。

**负面：**

- 增加 `outbox` 表，需要维护 schema 迁移和索引。
- Poller 的 500ms 轮询间隔引入 0-500ms 的额外投递延迟（可接受，因为 Run 启动本身需要数秒）。
- 需要实现 Edge 侧的幂等处理逻辑，否则重试可能导致重复 Run。
- 死信消息需要运维人员手动处理或建立自动重试机制（建议先通过飞书通知告警）。
- Outbox 表持续增长需要定期清理（建议保留 7 天已投递记录，dead 记录保留 30 天）。
