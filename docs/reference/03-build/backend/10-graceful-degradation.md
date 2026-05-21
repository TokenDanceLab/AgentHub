# AgentHub 优雅降级与韧性策略

> 综合自：`design-error-handling.md`（37 ErrorCode + retry）、`design-observability.md`（health checks + heartbeats）、
> `roadmap-research-to-implementation.md`（P0-P4 拓扑）、`architecture.md`（Hub-Edge-Runner 离线设计）
> 日期：2026-05-21

---

## 1. 韧性目标

AgentHub 的 Hub-Edge-Runner 拓扑为部分连接场景而设计。指导原则：**任何单一组件故障不应阻塞本地执行**。

| 目标 | 指标 | 测量方式 |
|------|------|---------|
| 本地执行可用性 | P0 Desktop 模式在 Hub 不可达时仍可工作 | Edge `/readyz` 返回 "degraded" 而非 "unavailable" |
| 优雅重连 | 所有 WebSocket 连接自动恢复 | 30s 内重连成功率 |
| 数据持久性 | 瞬态故障不丢消息 | EventStore write-chain + 本地 SQLite |
| 用户感知 | 降级可见但不阻塞 | 连接圆点 + 内联横幅，网络问题绝不弹 modal |

---

## 2. 故障模式与降级行为

### 2.1 Hub 不可用

Hub 是中心 IM 服务器。它对本地执行是**可选的**。

| 受影响组件 | Hub 离线时行为 | 恢复方式 |
|-----------|--------------|---------|
| **Edge -> Hub 同步** | 同步暂停。Edge 将出站事件在 `sync_outbox` 中排队（环形缓冲区，最多 10K 条目）。 | 重连后按 `seq` 顺序重放。Hub 按 `(edge_id, seq)` 去重。 |
| **云端群聊** | 不可用。仅本地 Conversation 继续。UI 横幅："Cloud chat unavailable"。 | 重连后 Hub 发送 `conversation.snapshot`。 |
| **好友列表 / 联系人** | 从 Edge 本地缓存读取。不能添加/删除。 | 重连后 `contact.sync` 全量重新同步。 |
| **Mobile / Web 客户端** | 全屏 "Connecting..." 带重试按钮。无法到达 Edge（除同一局域网外的 P3）。 | 自动重连：1s, 2s, 4s, 8s, 最大 30s 指数退避。 |
| **远程命令中继** | Mobile 无法发送命令。"Edge unreachable -- Hub offline" 错误。 | 排队的命令在重连时送达。 |
| **Agent 联系人注册表** | 从缓存读取。新注册推迟。 | 重连时重新同步。 |
| **云端 Artifact 同步** | Artifact 保留在本地。无跨设备访问。 | 重连时推送。 |

**Edge 本地自治**：所有 P0 功能（本地聊天、@mention 分发、Runner 执行、Diff Card、工作区）在无 Hub 时正常运行。Edge `/readyz` 返回 `"degraded"`，其中 `hub_connection: "degraded"`——绝不返回 `"unavailable"`。

### 2.2 Edge 不可用

Edge 是本地控制节点。对 Desktop 用户而言，其故障比 Hub 故障更严重。

| 受影响组件 | Edge 离线时行为 | 恢复方式 |
|-----------|---------------|---------|
| **UI（Desktop）** | WS 断开。红色连接圆点 + "Edge disconnected" 横幅。运行显示 "reconnecting..."。 | 自动重连：1-30s 退避，无限重试。重连时 Edge 推送完整状态快照。 |
| **Runner 进程** | 检测到心跳丢失（3 次丢失 = 30s）。继续自主执行，本地缓冲结果。 | Edge 重连时推送缓冲结果。Edge 重建运行状态。 |
| **上下文构建** | 新分发不可用。活动运行继续使用已构建上下文。 | Edge 重启时从最后快照恢复。 |
| **Hub 同步（远程）** | Hub 检测到心跳丢失（3 次丢失 = 90s），标记 Edge `offline`。Mobile："Desktop offline"。 | 下次心跳时 Hub 标记 `online`。Mobile 收到 `edge.status_change`。 |
| **本地 SQLite** | WAL 确保崩溃安全。重启时 Edge 重放 WAL 并重建：conversations、runners、sync_outbox、ws_rooms。 | 重启时自动执行。 |

### 2.3 Runner 崩溃 / 不可用

Runner 是 Agent 执行进程管理器。故障范围限于所管理的运行。

| 受影响组件 | Runner 崩溃时行为 | 恢复方式 |
|-----------|-----------------|---------|
| **活动运行** | Agent 子进程成为孤儿。Edge 标记 Runner 不健康（30s）然后离线（60s）。运行状态 -> `failed` 带 `ErrRunnerUnavailable`。 | Edge 重启（最多 3 次，间隔 2s）。重启时：SIGTERM 孤儿进程，保留 Checkpoint。 |
| **待处理运行** | 在 Edge 中排队。直到 Runner 重新注册后才分发。 | 重连时自动分发。 |
| **工作区文件** | Git worktree 在磁盘上完好。如果正在写入，未提交的变更可能丢失。 | 通过 `git status` 验证。损坏的工作区从基准 commit 重建。 |
| **Diff 生成** | 正在进行的 diff 丢失。工作区中已完成的 diff 保留。 | Edge 在运行恢复时重新请求。 |

**Runner 重启协议**：(1) Edge 检测到超时。(2) 标记不健康，向 UI 推送状态。(3) Edge 重启 Runner。(4) Runner 加载 Checkpoint 注册表，SIGTERM 孤儿进程。(5) Runner 发送 `runner.register` 带 `recovery: true`。(6) Edge 重放最后已知的运行状态；Runner 协调（已完成上报，进行中从 Checkpoint 恢复）。(7) Edge 标记健康。

### 2.4 SQLite 数据库损坏 / 锁

| 组件 | 损坏行为 | 恢复方式 |
|------|---------|---------|
| **Edge SQLite** | 启动时 `integrity_check` 失败 -> 拒绝启动，exit code 2。 | 从备份替换，或从 Hub 同步重建。P0 离线：全新 DB（开发期接受数据丢失）。 |
| **Edge SQLite 锁定** | 写入争用以 50ms 退避重试（5 次尝试）。持续 -> `ErrDatabaseLocked`。 | WAL 模式启用并发读取。设置 `busy_timeout=5000`。 |
| **Runner SQLite** | 启动时损坏 -> 全新 DB。丢失的 Checkpoint = 运行从头开始。 | 可接受：Runner DB 类似缓存。Edge EventStore 是权威来源。 |
| **Hub SQLite** | 严重。账号和云端 Conversation 的权威来源。从备份完全恢复。 | 每日 `VACUUM INTO 'backup.db'`。恢复最新备份 + 重放 WAL。 |

**强制 SQLite PRAGMA（所有服务）**：`journal_mode=WAL`、`synchronous=NORMAL`（Hub 使用 FULL）、`foreign_keys=ON`、`busy_timeout=5000`、启动时 `integrity_check`。

### 2.5 WebSocket 连接故障

| 对 | 影响 | 重连策略 |
|---|------|---------|
| **UI <-> Edge（localhost）** | UI 丢失实时性。活动运行不可见。消息发送失败。 | 退避：500ms, 1s, 2s, 4s, 最大 10s。无限重试。重连时：Edge 推送 `edge.state_snapshot`。 |
| **Edge <-> Hub（WAN）** | 云端同步暂停。Mobile 不可达。本地正常。 | 退避：1s, 2s, 4s, 8s, 最大 30s。无限重试。Edge 排队事件。 |
| **Runner -> Edge（localhost）** | 新运行阻塞。活动运行继续自主运行。 | 基于心跳检测。Edge 通过本地 HTTP 重连。 |
| **Hub 内部 WS gateway** | Mobile/Web 断开。Hub REST 继续。 | Ping/Pong 15s 间隔。3 次丢失 -> 关闭，客户端重连。 |

---

## 3. 功能降级矩阵

各组件不可用时哪些功能可用：

| 功能 | Hub 离线 | Edge 离线 | Runner 离线 | DB 损坏 |
|------|:-------:|:--------:|:----------:|:------:|
| 本地聊天（单 Agent 及多 Agent） | 完整 | -- | -- | -- |
| Agent 执行（CC/Codex/OpenCode） | 完整 | -- | -- | -- |
| Diff Card（展示 + apply/discard） | 完整 | -- | 只读（缓存） | -- |
| 工作区文件浏览 | 完整 | -- | 只读（磁盘） | -- |
| 预览服务器 | 完整 | -- | -- | -- |
| 安全审批流 | 完整 | -- | -- | 只读（缓存规则） |
| 上下文构建 | 完整 | -- | -- | -- |
| Checkpoint create/restore | 完整 | -- | -- | -- |
| 云端群聊 | -- | 完整 | 完整 | -- |
| Mobile 远程控制 | -- | -- | 完整 | -- |
| 跨设备 Artifact 访问 | -- | 完整 | 完整 | -- |
| 好友/联系人管理 | -- | 完整 | 完整 | -- |
| 预算追踪（云端） | -- | 完整 | 完整 | -- |
| 成本聚合（跨 Edge） | -- | 见备注 | 完整 | -- |

图例：**完整** = 正常运行；**--** = 不可用；**只读** = 已有数据可见，无新写入。

---

## 4. 自动恢复策略

### 4.1 重连层级

```
第一层：UI <-> Edge（localhost WS）     无限重试，  500ms-10s 退避
第二层：Edge <-> Hub（WAN 反向 WSS）    无限重试，    1s-30s 退避
第三层：Runner -> Edge（心跳）           60s 后重启， 最多 3 次尝试
第四层：Agent 子进程 -> Runner          崩溃后重启， 最多 3 次尝试，2s 间隔
```

### 4.2 退避配置

```go
// packages/resilience/backoff.go
type BackoffConfig struct {
    Initial, Max time.Duration; Multiplier, Jitter float64; MaxRetries int // -1 = 无限
}

var (
    UIBackoff          = BackoffConfig{500*time.Millisecond, 10*time.Second, 2.0, 0.1, -1}
    EdgeHubBackoff     = BackoffConfig{1*time.Second, 30*time.Second, 2.0, 0.2, -1}
    RunnerRestart      = BackoffConfig{2*time.Second, 10*time.Second, 1.5, 0.1, 3}
    LLMRetry           = BackoffConfig{500*time.Millisecond, 10*time.Second, 2.0, 0.1, 2}
)
```

### 4.3 重连时的状态协调

**Edge -> Hub**：(1) Edge 连接，发送 `edge.register` 带 `last_seq`。(2) Hub 计算差异：`seq > last_seq` 的事件。(3) Hub 发送 `sync.catchup` 批次（最大 500/批）。(4) Edge 应用，更新游标。(5) Edge 刷新 `sync_outbox` 队列。(6) Hub 按 `(edge_id, seq)` 去重。(7) 稳态流式传输。

**UI -> Edge**：(1) UI 发送 `client.connect` 带 `last_event_id`。(2) Edge 从 EventStore 重放错过的 ServerEvent。(3) Edge 发送 `edge.state_snapshot`（活动运行、连接、runners）。(4) UI 重建所有 store 状态。(5) 正常流式传输。

**Runner -> Edge**：(1) Runner 发送 `runner.register` 带 `recovery: true` + 活动运行 ID。(2) Edge 与已知状态对比：已完成上报，孤儿进程终止。(3) 进行中的运行：Edge 发送 `run.resume` 带 Checkpoint ID。(4) Runner 恢复工作区，重启 Agent。(5) 从恢复点开始流式输出。

### 4.4 断路器（仅远程调用）

三态断路器（Closed -> Open -> HalfOpen）保护 WAN/外部调用：
- **Edge -> Hub** WebSocket 连接（阈值：5 次失败，重置：30s）
- **Edge -> 外部 MCP server** 连接
- **Hub -> 外部 OAuth provider**

不用于 localhost 连接（UI->Edge、Runner->Edge）——这些使用带退避的简单重试。

---

## 5. 用户可见的降级指示器

### 5.1 连接状态（Sidebar 底部，始终可见）

```
绿色  + "Local"              所有本地组件健康（P0，无 Hub）
绿色  + "Hub connected"      Hub 已连接（P1+）
黄色  + "Connecting..."      正在重连尝试 N
黄色  + "Hub offline"        Hub 不可达，本地正常
红色  + "Edge disconnected"  本地 Edge 不可达，UI 无法运行
红色横幅（全宽）              "Runner crashed -- restarting..."（临时，自动解决）
```

### 5.2 降级横幅（上下文内，绝不 Modal）

| 条件 | 横幅 | 操作 |
|------|------|------|
| Hub 离线，本地正常 | "Cloud sync paused. Local execution unaffected." | [Dismiss] |
| Hub 离线 > 5 分钟 | "Hub unreachable for 5 min. Messages sync on reconnect." | [Dismiss] [Status] |
| Runner 不健康 | "Runner not responding. Active runs may be interrupted." | [View Runs] |
| Edge DB 接近容量 | "Local storage running low (85%)." | [Manage Storage] |
| Sync outbox 接近上限 | "9,500/10,000 pending events. Connect to Hub soon." | [Connect Now] |

### 5.3 降级期间的运行状态

| 组件状态 | 运行显示 | 用户操作 |
|---------|---------|---------|
| 全部健康 | 正常流式输出 | 完全控制 |
| Hub 离线 | 正常 + "Offline" 徽章 | 完全本地控制 |
| Edge 重连中 | "Reconnecting..." spinner | 不能启动新运行 |
| Runner 不健康 | "Runner unavailable" + 最后输出 | 取消运行 / 等待 |
| Runner 重启中 | "Restarting runner (attempt 2/3)..." | 等待或强制取消 |
| Agent 崩溃 | "Agent stopped unexpectedly" + 详情 | 从 Checkpoint 重试 / 新运行 |

### 5.4 Toast（4s 自动消失，除非另有说明）

- "Hub connection lost -- retrying in 3s..."（warning，每次重试更新）
- "Hub connection restored"（success, 3s）
- "Runner restarted successfully"（success, 3s）
- "Edge reconnected -- 12 events synced"（info, 4s）
- "Sync outbox at 80% capacity"（warning, 6s）
- "Agent process recovered from checkpoint"（info, 4s）

### 5.5 Mobile 特定（P2+）

| 状态 | Mobile 显示 |
|------|-----------|
| Hub 不可达 | 全屏 "No connection" + [Retry]。缓存的 Conversation 只读。 |
| Desktop Edge 离线 | "Desktop offline" 徽章。输入禁用，占位符 "Desktop is offline"。 |
| 两者均离线 | 全屏错误。仅缓存数据。 |

---

## 6. 实施清单

**P0（当前）**：UI-Edge WS 自动重连；Edge SQLite WAL + `busy_timeout` + 启动时 `integrity_check`；Runner 到 Edge 心跳（10s）；Edge RunnerManager：检测 + 自动重启（最多 3 次）；连接圆点组件（绿/黄/红）。

**P1（强烈建议）**：Edge-Hub 反向 WSS 重连 + 同步重放；Edge `sync_outbox` 表；Hub 侧 Edge 离线检测（90s 超时）；Edge-Hub 断路器；降级横幅；Edge + Hub 每日 `VACUUM INTO` 备份。

**P2（增强）**：Mobile 离线/在线 UX；Hub DB 损坏自动恢复；Runner 重启时从 Checkpoint 恢复运行；韧性指标（重连成功率、降级时长直方图）。

---

## 7. 设计决策

1. **Hub 是可选的，不是必需的**。P0 本地执行必须在无 Hub 时工作。Edge `/readyz` 在 Hub 不可达时返回 `degraded`（而非 `unavailable`）。这是最重要的韧性决策。

2. **Runner 自主缓冲**。当 Edge 临时不可达时，Runner 继续执行并将结果缓冲到本地 EventStore。短暂的 Edge 重启或网络抖动不会丢失工作。

3. **WebSocket 重连是无限的**。不同于 API 调用重试（最多 2 次），WebSocket 重连以 30s 最大间隔永久重试。连接中断不应需要用户手动干预。

4. **降级是环境性的，不是 modal**。连接问题以横幅和状态圆点显示，绝不阻塞 modal。唯一阻塞的是本地 Edge 完全崩溃（应用未运行）。

5. **SQLite WAL 在所有地方是强制的**。在写入期间启用并发读取，确保崩溃安全，无需应用级锁定。所有服务在启动时运行 `integrity_check`，损坏时快速失败。

6. **断路器仅用于远程调用**。Localhost 连接使用简单重试。断路器仅保护快速重试会浪费资源的 WAN/外部调用。

7. **每次重连时进行状态协调**。完整状态重放（错过的 EventStore 事件 + 状态快照）确保 UI 和下游组件在断开后从不持有过期或不一致状态。

8. **无静默降级**。每次组件状态变更都产生 toast + 日志事件。持久状态变更连接圆点。用户始终知晓系统健康状况。

---

## A. 参考资料

- `design-error-handling.md` -- 连接状态（第 2.4 节），自动重试模式（第 3.2 节），层职责（第 4.1 节）
- `design-observability.md` -- 健康检查（第 3 节），心跳间隔 + 离线阈值（第 3.6 节）
- `roadmap-research-to-implementation.md` -- P0-P4 拓扑（第 1 节），离线优先 P0 决策（第 4 节）
- `architecture.md` -- Hub 可选 / Edge 自治 / Runner 仅执行原则、Authority Model、Data Ownership
