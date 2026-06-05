# ADR Index

最后更新：2026-06-03

本目录保存 AgentHub 项目已采纳的架构决策记录（Architecture Decision Records）。ADR 解释"为什么当时这样决定"，不自动覆盖当前主文档。若 ADR 与 `docs/architecture/system-architecture.md`、`docs/architecture/implementation-guide.md` 或 `api/` 契约冲突，以当前主文档和契约为准，并在后续新增 ADR 记录变更原因。

## 阅读规则

- ADR 不作为 backlog。实现任务以 `docs/roadmap.md`、`docs/roadmaps/` 和当前 issue/PR 为准。
- ADR 不替代 API 契约。REST 以 `api/openapi.yaml` 为准，事件以 `api/events.md` 为准。
- ADR 中的旧称呼需要按当前术语理解：Agent Runtime、Agent Profile、Agent Configuration、Execution Target。
- 早期出现的独立 Runner、Runner registry、Runner 直连等说法应按当前 Edge lifecycle + AgentAdapter 模型重解释。

## 状态表

### 基础设施决策（2026-05-24 ~ 05-26）

| ADR | 标题 | 当前状态 | 备注 |
|-----|------|----------|------|
| ADR-001 | [Hub-Edge 双层架构](ADR-001-hub-edge-architecture.md) | 已采纳 | Hub/Edge 分离仍成立；Desktop 是 Edge Node，执行能力在 Edge 内部 lifecycle/adapters |
| ADR-002 | [WebSocket + NDJSON 事件协议](ADR-002-websocket-ndjson.md) | 已采纳 | WebSocket typed events 和 CLI NDJSON/JSONL 解析方向仍成立；具体事件类型以 `api/events.md` 为准 |
| ADR-003 | [Zustand + TanStack Query 状态管理](ADR-003-zustand-tanstack-query.md) | 已采纳 | 前端状态分层决策仍可作为客户端实现依据；细节以当前 `app/desktop` 和 `app/shared` 代码为准 |
| ADR-004 | [Go 进程编排 + Adapter 模式](ADR-004-go-process-orchestration.md) | 已采纳 | Go `os/exec` + AgentAdapter 是当前执行边界权威；应与系统架构文档的 Runtime/Profile/Target 术语一起阅读 |
| ADR-005 | [Git Worktree 隔离 + Subagent 模式](ADR-005-worktree-subagent-isolation.md) | 已采纳 | Worktree 隔离和 subagent 协作原则仍成立；具体任务分发规则以 `AGENTS.md` 和当前 roadmap 为准 |
| ADR-006 | [Agent 间通信模型](ADR-006-agent-communication-model.md) | 已采纳 (2026-05-26) | Agent 间通信走结构化委派（TeamAssignment），不走自由聊天。Hub 是 Agent 通信的单一事实源 |

### 实现决策（2026-06-03）

| ADR | 标题 | 当前状态 | 备注 |
|-----|------|----------|------|
| ADR-007 | [三运行时统一适配器架构](ADR-007-unified-adapter-architecture.md) | 已采纳 | AgentAdapter 接口 + AdapterRegistry + EventEmitter 统一事件模型，支持 Claude/Codex/OpenCode |
| ADR-008 | [Glass Token 设计系统](ADR-008-glass-token-design-system.md) | 已采纳 | `--glass-*` CSS 变量系统，26 个语义化变量，替代 797 处 rgba() 硬编码 |
| ADR-009 | [SettingsPage 渐进式拆分策略](ADR-009-settings-page-refactoring.md) | 已采纳 | 三阶段拆分：Section 提取 + CSS 模块化 + Lazy Loading。当前已降至 765 行 |
| ADR-010 | [MCP Server 端点设计](ADR-010-mcp-server-endpoint.md) | 已采纳 | JSON-RPC 2.0 MCP Server，8 tools，Streamable HTTP Transport |
| ADR-011 | [前端 Monorepo 架构](ADR-011-frontend-monorepo.md) | 已采纳 | pnpm workspace monorepo：shared/desktop/web/mobile 四包 |

## 需要新增 ADR 的候选主题

这些主题已有主文档方向，但尚未形成独立 ADR：

- 独立 `runner/` 组件合并进 Edge lifecycle/adapters 的正式决策记录
- Agent Runtime、Agent Profile、Agent Configuration、Execution Target 四个术语边界的正式决策记录
- `/v1/runners` 兼容 API 是否保留、重命名或迁移为 Runtime/Profile API 的决策记录
