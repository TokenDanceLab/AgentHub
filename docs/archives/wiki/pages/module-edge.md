---
id: module-edge
title: Edge Server 模块：lifecycle/adapters/store、runners 兼容残留、capability/outbox 缺口
type: module
status: active
updated: 2026-07-16
sources:
  - edge-server/internal/lifecycle/
  - edge-server/internal/adapters/
  - edge-server/internal/store/
  - edge-server/internal/events/
  - edge-server/internal/runners/
  - edge-server/internal/hub/callback.go
  - docs/architecture.md
  - docs/architecture/02-edge-server.md
  - docs/architecture/03-runtime-adapters.md
  - docs/decisions.md
  - docs/governance/security-risk-register.md
  - AGENTS.md
tags:
  - edge
  - lifecycle
  - adapters
  - store
  - runners-compat
  - capability-gap
  - outbox
related:
  - module-hub-server
  - hotspot-edge-runners-compat
  - flow-control-run
  - flow-event-transcript
  - risk-ah-sr-register
summary: >
  Edge Server（`edge-server/`）负责本地 Agent 执行：lifecycle 管理 Run 状态机、adapters 统一 CLI/SDK 协议、
  SQLite EventStore 持久化事件流、hub callback 上报 Hub；`internal/runners/` 是兼容残留包，
  delivery outbox / per-run capability / remote read authz 仍为 Open 高风险缺口。
---

# module-edge：Edge Server 模块

Edge Server 是 AgentHub 的本机执行层，运行于 Desktop 本地（端口 3210）或作为 Hub 路由的远端 Edge。其核心职责：管理本地项目、Thread、Run 的生命周期，统一不同 Agent CLI/SDK 的协议为 `RunEvent` 流，持久化事件和产物索引。

## 架构位置

```text
Desktop workbench → Desktop adapter → Local Edge (3210) → AgentAdapter → CLI/SDK
Web workbench    → Web adapter     → Hub → relay    → Edge      → AgentAdapter
```

Edge 不直接面向 Web 浏览器；Web 只能通过 Hub relay 到达远端 Edge。Desktop renderer 不能获得 raw process execution 权限——危险能力经过 typed Tauri host API allowlist。

## 源文件地图

| 包 | 路径 | 职责 |
|---|---|---|
| Lifecycle | `edge-server/internal/lifecycle/` | Run 状态机、进程执行器、证据门、故障升级链、DecisionLoop |
| Adapters | `edge-server/internal/adapters/` | `AgentAdapter` 接口、CLI/SDK 解析器、Registry、事件映射 |
| Store | `edge-server/internal/store/` | 内存 `Store` + SQLite 持久化，Reader/Writer/Repository 契约 |
| Events | `edge-server/internal/events/` | EventBus（订阅/广播）、EventLog（append-only JSON-lines） |
| Runners | `edge-server/internal/runners/` | 兼容残留包——见下方 [[#runners-兼容残留]] |
| Hub callback | `edge-server/internal/hub/callback.go` | Edge→Hub 直连上报（ack/stream/done/fail），最多 3 次指数退避重试 |
| Agents | `edge-server/internal/agents/` | Agent 注册表、消息队列 |
| Router | `edge-server/internal/router/` | 任务分类路由 |
| RunnerCtx | `edge-server/internal/runnerctx/` | Context Builder：prompt、memory、context budget、compaction |
| Skills | `edge-server/internal/skills/` | Skill 发现与解析 |
| cc-switch | `edge-server/internal/ccswitch/` | 动态模型路由集成（可选，优雅降级） |
| Security | `edge-server/internal/security/` | 调用来源校验 |
| JWT | `edge-server/internal/jwtutil/` | per-run capability token 校验 |
| MCP | `edge-server/internal/mcp/` | MCP-compatible capability 暴露 |
| Diff | `edge-server/internal/diff/` | Diff 计算与应用 |

## Lifecycle 状态机

`RunExecutor` 接口（`lifecycle/executor.go`）定义运行状态转换入口：

```
queued → started → running → finished / failed / cancelled / completed_with_issues
```

关键组件：

| 组件 | 文件 | 职责 |
|---|---|---|
| ProcessExecutor | `process_executor.go` | 启动 agent CLI 子进程、管理 stdin/stdout pipe、超时与优雅关闭 |
| DecisionLoop | `decision_loop.go` | 包装 adapter 事件流，step 计数、maxSteps 强制、工具审批门控 |
| EvidenceGate | `evidence_gate.go` | 运行前/后证据验证门 |
| FaultEscalation | `fault_escalation.go` | 三层故障升级链：自动重试 → AI review → replan |
| EnvSanitizer | `env_sanitizer.go` | 运行环境变量脱敏 |

ProcessExecutor 配置 `RunTimeout`（默认 30 分钟）、`ShutdownGracePeriod`（默认 10 秒），Unix 下先 SIGTERM 再 SIGKILL。

## Adapter 注册表

所有 adapter 实现统一 `AgentAdapter` 接口（`adapters/adapter.go`）：

```go
BuildCommand(ctx) → (path, args, env, workDir)
ParseStream(ctx, stdout, stdin, emitter, run) → error
NeedsStdin() → bool
Available() → bool
```

已注册 adapter（详见 [03-runtime-adapters.md](../../docs/architecture/03-runtime-adapters.md)）：

| Adapter | ID | 类型 | 状态 |
|---|---|---|---|
| Claude Code | `claude-code` | CLI `stream-json` | 真实 CLI 验证通过 |
| Codex | `codex` | CLI | PreflightCheck 预检 `OPENAI_API_KEY` |
| OpenCode | `opencode` | CLI | `--session` 仅 resume 时传递 |
| Anthropic SDK | `anthropic-sdk` | SDK HTTP | 直连 Messages API + SSE streaming，指数退避重试 |
| OpenAI SDK | `openai-sdk` | SDK HTTP | 直连 Chat Completions API + SSE streaming |
| Orchestrator | `orchestrator` | 编排 | 包装 Claude Code + dispatch interceptor，含 Rule Engine、Plan Approval Gate、Fan-Out Pool、Failure Recovery |
| Runtime Manifest | fixture | fixture | 仅测试/开发辅助，不计入生产 adapter |

事件标准化路径：

```text
CLI NDJSON/SDK SSE → Adapter ParseStream → RunEvent → EventBus → EventLog + WS 推送
```

## Store：内存 + SQLite 双层

`Store`（`store/store.go`）是核心内存数据结构，管理 Project、Thread、Run、Item、Pin、Diff、Artifact、Preview、UserProfile、AgentProfile、Settings 的全量 CRUD。`SQLiteStore`（`store/sqlite_store.go`）通过 snapshot 持久化到 SQLite（WAL 模式，5 分钟一次 checkpoint），支持崩溃恢复。

Run 清理策略：终端状态 runs（completed/failed/cancelled/completed_with_issues）按 `TerminalTTL` 超时或 `MaxTerminalRunsPerThread` 上限自动清理，级联删除关联 diffs/artifacts/previews/items。

Store 不内置 delivery outbox 或 journal——这是已知缺口（见下节）。

## EventBus 与 EventLog

`EventBus`（`events/bus.go`）基于 channel 的发布/订阅模型，支持 4 worker 并发 observer、子 channel 缓冲（256）、gap detection（`system.gap` 事件）。`EventLog` 是 append-only JSON-lines 文件（默认 50 MiB 上限，自动截断保留尾部 75%）。

EventBus 通过 `PersistFn` 钩子先持久化（EventLog.Append）再广播。

## 与 Hub 的通信

| 方向 | 路径 | 机制 |
|---|---|---|
| Hub → Edge | REST callbacks | Hub 通过 `POST /edge/...` 下发给 Edge |
| Edge → Hub | callback client | `edge-server/internal/hub/callback.go` 直连上报 ack/stream/done/fail |

当前 callback 是 **fire-and-forget + 客户端重试**（最多 3 次、指数退避 1s/2s/4s），不持久化未送达事件。这是 delivery outbox 缺口（[[#capability-缺口]]）。

## Runners 兼容残留

`edge-server/internal/runners/` 包含一个轻量 `Registry`（内存 map，`RunnerInfo{ID, Name, Status, Capabilities}`），不含执行逻辑。这个包是早期 `runner/` 目录废弃后的兼容摘要层。

**重要**：`AGENTS.md` 明确："`edge-server/internal/runners/` 是兼容摘要包；`/v1/runners` 不代表新的业务 Agent 模型"。Agent 产品模型的主线是 AgentProfile + AgentAdapter + ExecutionTarget，不是 Runner。前端不应以 runner-centric UI 驱动设置面板（见 `AH-SR-044`：runner compatibility health 进入 Desktop/Web settings/workbench 与 Runtime adapter + Execution Target 模型不一致）。

## Capability 缺口

以下缺口来自 `docs/governance/security-risk-register.md` 和 `docs/decisions.md`：

### P0：Hub-Edge delivery outbox（AH-SR-049 / ADR-016）

**当前状态**：Open。Edge→Hub callback 虽有客户端重试，但缺少：

- **Edge outbox/journal**：离线或 Hub 不可达时缓存事件，恢复后按序重放
- **Event sequence + idempotent ack**：防止重复投递
- **Replay/cursor**：支持从断点恢复
- **Reconciliation**：端到端对账检测状态分歧

ADR-016 已 Accept：Hub→Edge dispatch 需要 delivery outbox / ACK / retry / dead-letter 语义。但落地代码仅有客户端重试，尚未实现 durable delivery contract。

### P0：per-run capability token（AH-SR-046）

**当前状态**：Open。Edge run-start 缺少绑定 Hub user、Edge device、target、project/workspace 和 action 的 per-run capability。当前 JWT 校验（`jwtutil/`）已存在基础框架，但尚未绑定细粒度 scope。

需要：route-scoped run-start token/capability 和 wrong-target/project/action/stale 的 negative tests。

### P1：Remote Edge read authz（AH-SR-045）

**当前状态**：Open。Remote Edge read API 认证后缺少 route/target/workspace/user-action 级授权。需要增加 scoped authorization 和代表性 negative tests。

### P1：Adapter debug log 脱敏验证（AH-SR-048）

**当前状态**：Mitigated in repo; runtime/log verification required。Edge 启动日志已脱敏（`env_sanitizer.go` 过滤 API key、路径等），但真实 adapter debug 日志仍需验证不泄露 prompt、MCP、config、image path 或 session。

### P1：Runner compatibility UI 清理（AH-SR-044）

Runner compatibility health 进入 Desktop/Web settings/workbench，与 Runtime adapter + Execution Target 产品模型不一致。应用 Runtime inventory + Execution Target health 替代 runner-centric UI 假设。

## 安全边界

- Desktop 文件操作必须经过 allowlist 和 typed Host API
- Edge 不直接暴露文件系统给 Hub
- Hub→Edge 执行请求通过 REST callbacks，Edge 校验后才启动 runtime
- Edge 暴露 MCP-compatible capability 时以 Edge auth、tool schema、transport 为准
- TokenDance API key 不得暴露给浏览器 UI

## 验证命令

```powershell
cd edge-server; go test ./... -short -count=1
```

涉及 adapter 集成测试：`go test ./internal/adapters/... -run Integration -count=1`

## 相关页面

- [[module-hub-server]]——Hub 与 Edge 的同步、中继、路由关系
- [[hotspot-edge-runners-compat]]——runners 兼容残留清理计划
- [[flow-control-run]]——控制线：Workbench → adapter → Edge → CLI/SDK
- [[flow-event-transcript]]——事件线：Runtime → EventStore → WS → Transcript
- [[risk-ah-sr-register]]——AH-SR-045/046/048/049 关闭条件
- [[architecture-seams]]——lifecycle/adapter/store 边界与缝合线
