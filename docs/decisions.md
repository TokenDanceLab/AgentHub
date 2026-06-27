# AgentHub Decisions

最后更新：2026-06-28

本文件是当前架构决策摘要。旧 ADR 全文已外迁到 `docs/history.md` 指向的 TokenDance docs archive；旧正文只作追溯，不覆盖 `AGENTS.md`、`docs/architecture.md`、`docs/architecture/`、`api/` 或当前源码事实。

| ID | 状态 | 当前结论 | Owner | 仍有效 |
|---|---|---|---|---|
| ADR-001 | Accepted | AgentHub 保持 Hub/Edge 双层架构：Hub 负责账号、IM、同步、路由、审计；Edge 负责本地执行、adapter、workspace、事件和本地持久化。 | Architecture / Hub / Edge | 是 |
| ADR-002 | Accepted | 运行事件走 typed WebSocket event stream；CLI NDJSON/JSONL 只在 Edge adapter 内解析，REST 负责查询和普通 RPC。 | API / Edge / Frontend | 是 |
| ADR-003 | Accepted | 服务端状态使用 TanStack Query，客户端 UI 临时状态使用 Zustand；具体实现以 `app/shared`、Desktop/Web 当前代码为准。 | Frontend | 是 |
| ADR-004 | Accepted | Edge 使用 Go `os/exec` + AgentAdapter 管理 Agent CLI/SDK runtime，进程生命周期由 Edge lifecycle 承担。 | Edge | 是 |
| ADR-005 | Accepted, updated 2026-06-27 | worktree 隔离、短分支、PR 合并和清理仍是并行 Agent 工作的基本规则；模型/供应商路由改由 `AGENTS.md` 和 active skills 约束。 | Repository governance | 是，已更新 |
| ADR-006 | Accepted | Agent 间协作以 Hub typed TeamAssignment / TeamRun 为事实源；IM message 只是人可读投影，不作为 Agent 决策输入。 | Hub / Product model | 是 |
| ADR-007 | Accepted | Edge runtime 统一到 AgentAdapter + Registry + EventEmitter；新增 runtime 通过 adapter 接口接入，不让前端感知 CLI 差异。 | Edge adapters | 是 |
| ADR-008 | Accepted, partially superseded | 设计 token 化原则仍有效；旧 `--glass-*` 细节是历史实现，当前共享设计合同以 TokenDance design docs、OKLCH/CSS Modules 和 `--td-*` intent 为准。 | Frontend design | 部分有效 |
| ADR-009 | Accepted, historical | SettingsPage 拆分为 section/primitives/lazy lanes 的方向有效；是否已完成以当前 Desktop/Web settings 代码为准，不作为新 backlog。 | Frontend settings | 历史有效 |
| ADR-010 | Accepted | Edge 暴露 MCP-compatible capability 时以 Edge auth、tool schema、transport 和当前 endpoint 代码为准；不要为每个外部工具做专用协议。 | Edge MCP | 是 |
| ADR-011 | Accepted | 前端保持 pnpm workspace / shared package 架构；Desktop/Web/Mobile 共享类型和 UI contract，平台能力留在各平台 adapter。 | Frontend platform | 是 |
| ADR-013 | Accepted, historical | Hub app 启动入口应保持职责拆分：wiring、events、background、admin、router 等边界清楚；当前文件布局以源码为准。 | Hub server | 是 |
| ADR-014 | Accepted, partially realized | Agent team service 应按 CRUD、member、run、compete、routing、events 等领域拆分；当前落地情况以 `hub-server/internal/service/` 为准。 | Hub service | 部分有效 |
| ADR-015 | Accepted | 避免服务间循环依赖；优先窄接口、构造函数显式依赖和事件中介，不用 setter 注入掩盖循环。 | Hub architecture | 是 |
| ADR-016 | Accepted | Hub->Edge dispatch 需要 delivery outbox / ACK / retry / dead-letter 语义，避免 fire-and-forget 造成状态永久分歧。 | Hub reliability | 是 |
| ADR-017 | Accepted | Hub/Edge 授权区分身份令牌和 per-run capability token；真实安全边界以当前 JWT/capability 实现和风险登记表为准。 | Edge auth / Security | 是 |

## Archive

Full ADR bodies are archived in TokenDanceLab/docs under `archive/agenthub/repo/docs/adr/`. See [history.md](history.md) for the exact archive commit and follow-up tracking.
