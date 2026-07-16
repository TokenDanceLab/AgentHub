---
id: flow-control-event
title: 控制 / 事件 / 证据 / 同步四线流
type: flow
status: active
updated: 2026-07-16
sources:
  - docs/architecture.md
  - docs/architecture/01-hub-server.md
  - docs/architecture/02-edge-server.md
  - docs/architecture/03-runtime-adapters.md
  - docs/architecture/04-frontend-data-flow.md
  - docs/decisions.md
  - api/events.md
  - docs/governance/security-risk-register.md
  - AGENTS.md
tags:
  - data-flow
  - control-plane
  - events
  - sync
  - transcript
related:
  - hub-edge-overview
  - module-hub-server
  - module-edge-server
  - module-api-contracts
owners:
  - Architecture
  - Hub
  - Edge
  - Frontend
summary: >
  AgentHub 的四条核心数据流：控制线（Workbench→Runtime）、事件线（Runtime→Transcript）、
  证据线（Event→Artifact/Preview）、同步线（Edge→Hub→多端）。
---

AgentHub 的核心运行时行为由四条数据流定义。这些流定义了从用户操作到 Agent 执行、再到多端可见的完整路径。所有流以 [architecture.md](../docs/architecture.md) 为权威入口，模块细节见对应 owner 文档。

## 四线总览

| 流 | 方向 | 路径 |
|---|---|---|
| **控制线** | 下行 | Workbench → Platform Adapter → Edge/Hub → Runtime adapter → Runtime |
| **事件线** | 上行 | Runtime → Edge EventStore → Edge/Hub WS → Platform Adapter → Transcript |
| **证据线** | 上行派生 | RunEvent → EvidenceRef → Inspector → Artifact / File / Preview |
| **同步线** | 横向 | Edge EventStore → Hub Sync → Web / Desktop / Mobile viewers |

## 控制线（Control Flow）

控制线是用户意图到达 Agent Runtime 的下行路径。入口永远是 shared workbench 的 UI 组件（composer、审批卡片、再生按钮），不直接启动 CLI 进程。

```
用户操作（composer / 审批 / 再生）
  → Shared UI 调用 platform adapter 的 runs port
  → Desktop: adapter → Local Edge REST → lifecycle → adapter registry → Agent CLI
  → Web:     adapter → Hub REST  → Hub dispatch → Edge relay → adapter → Agent CLI
```

**关键规则**：

- UI 不能直接启动 Agent CLI。始终经过 typed `AgentHubPlatform.runs` port。参见 [AGENTS.md](../AGENTS.md) L53。
- Desktop renderer 不具备 raw process execution 权限；危险操作由 Tauri host typed API + allowlist 控制。参见 [architecture.md](../docs/architecture.md) L55。
- Web 不能持有 TokenDance API key 或 Local Edge 直连能力。控制面板为 Hub-only。参见 [architecture.md](../docs/architecture.md) L54。
- Edge 的 `lifecycle/` 负责 Run 的完整生命周期（queued → started → running → finished/failed/cancelled）。Runtime 选择通过 adapter registry 分发到对应 CLI/SDK adapter。参见 [02-edge-server.md](../docs/architecture/02-edge-server.md) L41-47, [03-runtime-adapters.md](../docs/architecture/03-runtime-adapters.md) L7-27。
- Hub→Edge dispatch 需要 delivery outbox / ACK / retry / dead-letter 语义，避免 fire-and-forget 导致状态永久分歧（ADR-016）。参见 [decisions.md](../docs/decisions.md) L23。

**事件族（控制相关）**：`run.queued`, `run.started`, `run.finished`, `run.failed`, `run.cancelled`。参见 [events.md](../api/events.md) L69。

## 事件线（Event Flow）

事件线是 Agent 运行时产生的事件如何流回 UI 并渲染为 transcript 的上行路径。

```
Agent Runtime（CLI stdout / SDK SSE）
  → Adapter normalize（CLI NDJSON / JSONL → RunEvent）
  → Edge EventStore 持久化
  → Edge WS 推送到 Desktop adapter（本地场景）
  → 或 Hub WS 推送 / Edge 上报（远程 / 多端场景）
  → Platform adapter → transcript normalization
  → ChatViewBridge → TranscriptItem[] → 线性渲染
```

**关键规则**：

- 所有 Agent 原生输出在 adapter 边界 normalise 为统一 `RunEvent` 类型。provider-specific 字段（token、authorization header、绝对路径、provider trace body）必须在进入 transcript 前脱敏。参见 [api/events.md](../api/events.md) L48-49。
- `RunEvent` 映射到 `TranscriptBlock`：text → text, thinking → thinking, tool_call → tool_call, tool_result → tool_result, diff → diff, approval_request → approval, artifact → artifact, deploy → deploy, error → error。参见 [03-runtime-adapters.md](../docs/architecture/03-runtime-adapters.md) L116-128。
- Transcript 按事件时间线性展示。用户消息乐观渲染，不应闪消。Agent 回复、工具调用、审批、子 Agent 报告、Diff、Preview 和结果卡片归一化后渲染。参见 [04-frontend-data-flow.md](../docs/architecture/04-frontend-data-flow.md) L78-85。
- CLI NDJSON/JSONL 只在 Edge adapter 内解析；REST 负责查询和普通 RPC（ADR-002）。参见 [decisions.md](../docs/decisions.md) L10。
- Debug、mock、mode 元数据不进入主聊天流。参见 [AGENTS.md](../AGENTS.md) L101。

**事件族（事件相关，完整清单见 [events.md](../api/events.md)）**：

| 类别 | 代表事件 | Owner |
|---|---|---|
| Runtime adapter | `run.agent.text_delta`, `run.agent.thinking`, `run.agent.tool_call`, `run.agent.tool_result`, `run.agent.file_change`, `run.agent.permission_requested`, `run.agent.permission_decided`, `run.agent.result` | `edge-server/internal/adapters/` |
| Context/rate | `run.agent.context_usage`, `run.agent.context_warning`, `run.agent.context_compaction`, `run.agent.rate_limit`, `run.agent.api_retry` | Edge adapter + metrics |
| Task/subagent | `run.agent.task_started`, `run.agent.task_progress`, `run.agent.sub_agent_status`, `run.agent.sub_agents_complete` | Orchestrator adapter |
| Approval/surface | `run.agent.plan_proposed`, `run.agent.plan_approved`, `run.agent.plan_rejected`, `run.agent.surfaced_diff`, `run.agent.surfaced_artifact` | Edge lifecycle + Hub |
| Hub Agent/Team | `agent.dispatch`, `agent.stream`, `agent.done`, `agent.control`, `team.run.started`, `team.event` | Hub service |

## 证据线（Evidence Flow）

证据线是从 RunEvent 中提取可审查产物的派生路径。它使 Agent 生成的 artifact、文件变更、diff 和预览可被独立审查，而非仅仅在聊天流中一闪而过。

```
RunEvent
  → EvidenceRef（指向具体 Artifact / File / Preview）
  → Inspector 面板（独立于主聊天流）
  → Artifact（产物索引、版本、应用）
  → File（workspace 内文件变更）
  → Preview（Web/Desktop 预览窗口）
```

**关键规则**：

- Artifact index 由 Edge 维护（`edge-server/internal/` artifact store），支持索引、预览和应用。参见 [02-edge-server.md](../docs/architecture/02-edge-server.md) L46。
- `artifact.created`, `preview.ready`, `preview.stopped` 事件由 Edge evidence store 和 preview 系统发出。参见 [events.md](../api/events.md) L71。
- `run.agent.surfaced_artifact`, `run.agent.surfaced_preview`, `run.agent.surfaced_diff`, `run.agent.surfaced_deploy` 提供 surfacing 扩展事件。参见 [events.md](../api/events.md) L82。
- Evidence grade 必须显式区分：fixture / readiness-only / observed / approved-real / production。参见 [architecture.md](../docs/architecture.md) L58。

## 同步线（Sync Flow）

同步线保证 Edge EventStore 中的执行状态能在 Hub 上被多端（Desktop、Web、Mobile）查看和交互。

```
Edge EventStore（本机持久化）
  → Hub Sync（Edge→Hub 上报：状态、事件摘要、产物指针）
  → Hub 持久化（PostgreSQL）
  → Hub WS fanout（推送到所有连接设备）
  → 各端 platform adapter → transcript normalization
```

**关键规则**：

- Hub 负责账号、IM、同步、中继、审计；Edge 负责本地执行和事件。两层各自独立但有明确同步语义。参见 [01-hub-server.md](../docs/architecture/01-hub-server.md) L7-8, ADR-001。
- `agent.stream` 事件从 Edge 上报到 Hub，持久化为 run events，并可投影为聊天消息。Transcript 渲染必须消费 normalized shared blocks，而非原始 Hub frames。参见 [01-hub-server.md](../docs/architecture/01-hub-server.md) L58。
- Hub frame（`{type, seq_id?, payload?}`）与 Edge `EventEnvelope`（含 version/id/seq/type/scope/traceId/sentAt/payload）是不同的协议对象。进入 shared transcript 前需经 Hub runtime/message normalizer 转换。参见 [events.md](../api/events.md) L51-62。
- Hub-Edge delivery 缺少 durable end-to-end delivery contract 是当前 High 风险（AH-SR-049）。需要 Edge outbox/journal、event sequence、idempotent ack、replay/cursor、reconciliation。参见 [security-risk-register.md](../docs/governance/security-risk-register.md) L25。

**事件族（同步相关）**：`auth.ok`, `message.new`, `message.edited`, `message.reaction_added`, `session.created`, `device.online`。参见 [events.md](../api/events.md) L72。

## 流之间的交叉约束

| 约束 | 涉及流 | 描述 |
|---|---|---|
| 身份与 session 分离 | 控制 + 同步 | TokenDance ID 只证明身份，Hub session 决定权限。TokenDance bearer 不能直接授权 `/client/*`、`/web/*`、`/edge/*`。参见 [AGENTS.md](../AGENTS.md) L79-80。 |
| 脱敏边界 | 事件 + 同步 | Provider-specific 字段（token、authorization header、绝对路径）在 adapter 边界脱敏后，才能进入 EventStore、WS 和 transcript。参见 [events.md](../api/events.md) L48-49, AH-SR-048。 |
| Agent 间协作 | 控制 + 事件 + 同步 | Hub typed `TeamAssignment` / `TeamRun` 是 Agent 间协作的事实源；IM message 只是人可读投影，不作为 Agent 决策输入（ADR-006）。参见 [decisions.md](../docs/decisions.md) L14。 |
| 证据等级 | 事件 + 证据 | `run.agent.plan_proposed/approved/rejected/expired` 提供审批证据链，需要真实 Desktop/Web 登录闭环证据（AH-SR-035/036）。参见 [security-risk-register.md](../docs/governance/security-risk-register.md) L19-20。 |
| 远程执行授权 | 控制 + 证据 | Remote/cloud execution 需要 relay/provisioning/device proof/workspace allowlist；queued 或 replayed Hub task 不足以证明真实模型/API 执行。参见 [01-hub-server.md](../docs/architecture/01-hub-server.md) L64, AH-SR-046。 |

## 相关页面

- [[module-hub-server]] — Hub 控制面：session、IM、路由、中继、审计
- [[module-edge-server]] — Edge 执行层：lifecycle、adapter、EventStore
- [[module-api-contracts]] — REST/OpenAPI + WS events 契约
- [[hub-edge-overview]] — Hub/Edge 双层架构全景
- [[module-frontend]] — 前端如何消费这四条流
- [[risk-ah-sr-register]] — 与流相关的当前安全风险
