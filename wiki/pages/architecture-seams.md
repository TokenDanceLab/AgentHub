---
id: architecture-seams
title: 非协商边界与平台缝合线
type: overview
status: active
updated: 2026-07-16
sources:
  - AGENTS.md
  - docs/architecture.md
  - docs/decisions.md
  - docs/governance/security-risk-register.md
  - api/openapi.yaml
  - api/events.md
tags:
  - architecture
  - boundaries
  - seams
  - cleanup
  - non-negotiable
related:
  - hub-edge-overview
  - ssot-map
  - module-hub-server
  - module-edge-server
  - module-shared-workbench
  - flow-control-run
  - flow-event-transcript
  - risk-ah-sr-register
  - risk-evidence-grade-confusion
  - production-live-hk3
summary: >
  AgentHub 的六条非协商架构边界、五层结构缝合线、平台 contract 及授权/证据门禁。所有边界以 docs/architecture.md 和 AGENTS.md 为 SSOT。
---

AgentHub 架构的关键约束已经以**非协商边界**形式写死在 `docs/architecture.md`。本页编译这些边界、它们背后的 ADR 决策、安全风险关联，以及跨层缝合线的具体含义。修改任何边界前必须先读 SSOT 并走架构决策流程。

## 六条非协商边界

| # | 边界 | 含义 | SSOT |
|---|---|---|---|
| 1 | **UI 不启动 CLI** | UI 层不能直接 `spawn` Agent CLI 进程；执行必须经过 Platform Adapter -> Edge/Hub -> Runtime Adapter 控制线。 | `docs/architecture.md` 边界 1 |
| 2 | **Web 无权持有本机能力** | Web 不能持有 TokenDance API key、本机文件系统能力、Local Edge 直连。Web 只能通过 Hub/Web adapter 访问远端能力。 | `docs/architecture.md` 边界 2；`AGENTS.md` §2 共享边界 |
| 3 | **Desktop renderer 无 raw process 权限** | Desktop 的 React renderer 不能获得操作系统级进程执行权限。危险能力必须经过 typed Tauri host API 和 allowlist。本地执行由 Local Edge 承担。 | `docs/architecture.md` 边界 3；`AGENTS.md` §2 |
| 4 | **TokenDance ID 只证明身份** | Hub 权限由 Hub-local membership/resource/action 决定，不由 TokenDance ID 直接推导。TokenDance bearer 不能直接授权 `/client/*`、`/web/*`、`/edge/*`。 | `docs/architecture.md` 边界 4；`AGENTS.md` §4 授权；ADR-017 |
| 5 | **统一 transcript contract** | 所有 Agent 来源（Codex、OpenCode、Claude Code 等）必须 normalize 到统一 transcript contract 后再渲染。消息流按事件时间线性展示，不区分 runtime 来源。 | `docs/architecture.md` 边界 5；ADR-002 |
| 6 | **证据等级不可混淆** | Mock、fixture、observed、approved-real、production 必须显式区分。stub/fixture/readiness-only 不能冒充真实登录、真实模型/API、packaged Desktop 或 release。 | `docs/architecture.md` 边界 6；`AGENTS.md` §10 验证纪律；[[risk-evidence-grade-confusion]] |

## 五层结构与缝合线

```text
Desktop 链路:
  Shared UI -> Desktop Platform Adapter -> Local Edge -> Hub Server -> Runtime Adapter -> CLI/SDK

Web 链路:
  Shared UI -> Web Platform Adapter -> Hub Server -> Edge routing/relay -> Edge Server -> Runtime Adapter
```

| 层 | 目录 | 缝合线（与其他层的契约点） |
|---|---|---|
| Shared UI | `app/shared/` | 只消费 `AgentHubPlatform` interface，不直接调用 Tauri invoke、Hub client、Edge client。通用组件禁止在各平台复制本地副本。 |
| Desktop | `app/desktop/` | Tauri shell + typed host API。只有 `app/desktop/src-tauri/` 可放 Tauri/Rust native 能力。Renderer 与 host 之间有明确的 capability allowlist。 |
| Web | `app/web/` | Hub session only。不能有 Local Edge loopback、TokenDance API key 或 `sessionStorage` 裸存 Hub session（参见 [[risk-ah-sr-register]] AH-SR-037）。 |
| Edge | `edge-server/` | 本地执行不依赖 Hub。Hub 只进入账号、云端 IM、多端同步、远程查看/审批、设备路由、中继和审计场景。 |
| Hub | `hub-server/` | TokenDance ID relying party。Hub-issued session 管理权限；TokenDance bearer 只证明身份。 |

关键缝合规则：

- **API 契约**写在 `api/`（`openapi.yaml` + `events.md`），是唯一的协议事实源。
- **前端**：Desktop/Web/Mobile 共享类型和 UI contract（ADR-011），平台能力留在各平台 adapter。
- **后端**：避免服务间循环依赖，优先窄接口、构造函数显式依赖和事件中介（ADR-015）。
- **Edge adapter**：CLI NDJSON/JSONL 只在 Edge adapter 内解析，前端不感知 CLI 差异（ADR-002、ADR-007）。

## 控制线 vs 数据线

| 线 | 路径 | 关键约束 |
|---|---|---|
| 控制线 | `Workbench -> Platform Adapter -> Edge/Hub -> Runtime Adapter -> Runtime` | UI 不直接启动 CLI（边界 1）；Web 不经此线获取 Local Edge（边界 2） |
| 事件线 | `Runtime -> Edge EventStore -> Edge/Hub WS -> Platform Adapter -> Transcript` | 所有来源归一化到 transcript contract（边界 5）；typed WebSocket only（ADR-002） |
| 证据线 | `RunEvent -> EvidenceRef -> Inspector -> Artifact/File/Preview` | 证据等级不可混淆（边界 6）；参考 `real-e2e-acceptance` skill |
| 同步线 | `Edge EventStore -> Hub Sync -> Web/Desktop/Mobile viewers` | Hub-Edge delivery 需要 durable contract：outbox/ACK/retry/dead-letter（ADR-016；[[risk-ah-sr-register]] AH-SR-049） |

## 授权边界缝合

```text
TokenDance ID (身份证明，不授权)
       |
       v
Hub Server (Hub-local membership/resource/action 决定权限)
       |
       +-- Hub-issued session -> Web/Desktop UI
       +-- per-run capability token -> Edge run-start
```

| 缝合点 | 当前状态 | SSOT |
|---|---|---|
| TokenDance bearer 不等于 Hub session | Desktop/Web 使用 Hub-issued session；bearer 不能直接授权 `/client/*`、`/web/*`、`/edge/*` | `AGENTS.md` §4；ADR-017；[[risk-ah-sr-register]] AH-SR-002 |
| Remote Edge read API authz | 认证后缺少 route/target/workspace/user-action 级授权 | [[risk-ah-sr-register]] AH-SR-045 |
| Edge run-start per-run capability | 缺少绑定 Hub user、Edge device、target、project/workspace 和 action 的 capability token | [[risk-ah-sr-register]] AH-SR-046 |
| Web session 存储 | 仍用 `sessionStorage` 保存 Hub session；缺少 BFF/HttpOnly cookie 或 accepted alternative | [[risk-ah-sr-register]] AH-SR-037 |

## 产品模型缝合

[AgentHub 架构概览](../docs/architecture.md) 定义了七个核心概念，每个概念有自己的 owner 层：

| 概念 | Owner 层 | 跨层缝合规则 |
|---|---|---|
| Agent Runtime | Edge adapter registry | 新增 runtime 通过 `AgentAdapter` 接口接入，前端不感知 CLI 差异（ADR-007） |
| Agent Profile | Hub profile store / Edge local profile | 本地执行不依赖 Hub profile；Hub profile 用于云端 IM 和协作 |
| Agent Configuration | Edge Context Builder + Hub store | Profile 的上下文、Skill、MCP、模型参数、审批策略由 Edge Context Builder 组装 |
| Execution Target | Edge registration + Hub routing | 一次 Run 的执行位置：local、remote、cloud、relay |
| Conversation | Hub/Edge conversation store | 用户可见 IM 会话；Agent 间协作以 Hub typed TeamAssignment/TeamRun 为 SSOT（ADR-006） |
| Run Session | Edge lifecycle + EventStore | 一次执行生命周期和事件序列；进程生命周期由 Edge lifecycle 承担（ADR-004） |
| Artifact | Edge artifact index + workspace | Agent 产物索引、预览、应用和版本 |

## 关联模块

- [[hub-edge-overview]] — Hub/Edge 双层平面总图
- [[module-hub-server]] — Hub Server 模块边界
- [[module-edge-server]] — Edge Server 模块边界
- [[module-shared-workbench]] — 共享工作台 contract
- [[flow-control-run]] — 控制线端到端流程
- [[flow-event-transcript]] — 事件到 transcript 流程
- [[risk-ah-sr-register]] — 安全风险登记表中与本页边界直接相关的项
- [[risk-evidence-grade-confusion]] — 证据等级混淆风险
- [[production-live-hk3]] — 生产环境事实指针

## 变更规则

修改任何一条非协商边界前：

1. 先在 `docs/decisions.md` 新增 ADR 或更新已有 ADR 状态。
2. 同步 `docs/architecture.md` 边界列表。
3. 检查是否触发 `docs/governance/security-risk-register.md` 新风险。
4. 刷新本页并同步 `index.md` 摘要。
5. High/Critical 安全风险未修复、未验证或未 accepted 前阻断公开发布。
