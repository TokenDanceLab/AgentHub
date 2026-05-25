# ADR Index

日期：2026-05-25

本目录保存已采纳的架构决策记录。ADR 解释“为什么当时这样决定”，不自动覆盖当前主文档。若 ADR 与 `docs/architecture/system-architecture.md`、`docs/architecture/implementation-guide.md` 或 `api/` 契约冲突，以当前主文档和契约为准，并在后续新增 ADR 记录变更原因。

## 阅读规则

- ADR 不作为 backlog。实现任务以 `docs/roadmap.md`、`docs/roadmaps/` 和当前 issue/PR 为准。
- ADR 不替代 API 契约。REST 以 `api/openapi.yaml` 为准，事件以 `api/events.md` 为准。
- ADR 中的旧称呼需要按当前术语理解：Agent Runtime、Agent Profile、Agent Configuration、Execution Target。
- 早期出现的独立 Runner、Runner registry、Runner 直连等说法应按当前 Edge lifecycle + AgentAdapter 模型重解释。

## 状态表

| ADR | 当前状态 | 备注 |
|---|---|---|
| `ADR-001-hub-edge-architecture.md` | 已采纳，需用当前三层术语阅读。 | Hub/Edge 分离仍成立；当前主文档进一步明确 Desktop 是 Edge Node，执行能力在 Edge 内部 lifecycle/adapters，不再是独立 Runner 组件。 |
| `ADR-002-websocket-ndjson.md` | 已采纳。 | WebSocket typed events 和 CLI NDJSON/JSONL 解析方向仍成立；具体事件类型以 `api/events.md` 和当前实现为准。 |
| `ADR-003-zustand-tanstack-query.md` | 已采纳。 | 前端状态分层决策仍可作为客户端实现依据；细节以当前 `app/desktop` 和 `app/shared` 代码为准。 |
| `ADR-004-go-process-orchestration.md` | 已采纳，当前执行边界权威。 | Go `os/exec` + AgentAdapter 是当前独立 Runner 替代方案。它应与 `docs/architecture/system-architecture.md` 的 Agent Runtime/Profile/Execution Target 术语一起阅读。 |
| `ADR-005-worktree-subagent-isolation.md` | 已采纳。 | Worktree 隔离和 subagent 协作原则仍成立；具体任务分发规则以 `AGENTS.md` 和当前 roadmap 为准。 |

## 需要新增 ADR 的候选主题

这些主题已有主文档方向，但尚未形成独立 ADR：

- 独立 `runner/` 组件合并进 Edge lifecycle/adapters 的正式决策记录。
- Agent Runtime、Agent Profile、Agent Configuration、Execution Target 四个术语边界的正式决策记录。
- `/v1/runners` 兼容 API 是否保留、重命名或迁移为 Runtime/Profile API 的决策记录。
