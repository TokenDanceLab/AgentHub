# AgentHub Archive Index

日期：2026-05-25

本文是 `docs/archive/` 的阅读索引。归档文档保留历史方案、早期规格和设计取舍记录，不再作为当前实现的权威来源。

## 当前权威文档

当前实现和后续开发以这些文档为准：

| 主题 | 权威文档 |
|---|---|
| 产品定位和验收范围 | `docs/architecture/product-requirements.md` |
| 架构、组件职责、术语边界 | `docs/architecture/system-architecture.md` |
| 实现阶段、API 规则、工程边界 | `docs/architecture/implementation-guide.md` |
| REST 契约 | `api/openapi.yaml`、`api/README.md`、`api/conventions.md` |
| WebSocket 事件契约 | `api/events.md` |
| 当前进展和接手状态 | `docs/handoff/STATE.md` |
| 持续开发台账 | `docs/roadmap.md`、`docs/roadmaps/` |

跨 TokenDance workspace 的身份、统一登录、设计系统和文档治理以仓库上层 `../docs/` 为准。生产拓扑、DNS、TLS、机器状态和部署实情属于 `C:\Users\Ding\server\STATE.md` 及 server workspace，不应复制到本仓文档。

## 当前架构判定基准

阅读旧文档时，先用以下基准判断是否仍可采用：

- 当前产品形态是 **Hub / Edge / Desktop** 三层。Desktop 是一个 Edge Node，不只是 UI 壳。
- Edge 是本地、远程或云端执行节点，负责执行生命周期、上下文、审批、事件和产物索引。
- 早期独立 `runner/` 组件已废弃。执行能力现在由 `edge-server/internal/lifecycle/` 和 `edge-server/internal/adapters/` 承担。
- Claude Code、Codex、OpenCode 是 **Agent Runtime**，不是业务 Agent 本身。
- 用户选择和管理的是 **Agent Profile**。Profile 由 Runtime、模型、配置、Skill/MCP、workspace、审批策略和 Execution Target 组成。
- **Agent Configuration** 是 Profile 的可编辑配置集合，例如 `AGENTS.md`、memory、system instructions、上下文预算、Skill、MCP 工具白名单和模型参数。
- **Execution Target** 必须显式建模为 Local Edge、Remote Edge、Cloud Edge 或 Hub Relay Target。
- UI 不直接控制 Agent CLI，也不直接访问远程 Runner。远程执行必须经过 Edge 或 Hub Relay。
- 主协议是 REST JSON API + WebSocket typed events。Protobuf、Connect-RPC、JSON-RPC 只作为历史参考或未来可选 bridge。

## 归档文档状态

### 历史方案 - 不作为实现依据

这些文档包含已被当前架构替代的 Hub-Edge-Runner、独立 Runner、Runner API、远程 Runner 直连或早期目录规划：

| 文档 | 状态 | 阅读方式 |
|---|---|---|
| `architecture.md` | 历史方案 | 记录早期 Hub-Edge-Runner 三层和独立 Runner 设想。当前以 `docs/architecture/system-architecture.md` 的 Hub/Edge/Desktop + AgentAdapter 为准。 |
| `topology.md` | 历史方案 | 可参考 Edge Node、relay、direct 的场景拆分，但其中 Runner/Cloud Runner/Local Runner 术语需改读为 Edge execution target。 |
| `architecture-optimization.md` | 历史方案 | 记录 2026-05-21 的架构优化思路。独立 RunnerEndpoint 和 `runner/` 目录建议已过期。 |
| `agent-loop.md` | 历史方案 | Run 流程可参考，所有 Edge -> Runner API 描述已被 Edge lifecycle + AgentAdapter 替代。 |
| `module-boundaries.md` | 历史方案 | 早期模块边界记录。`runner/` 归属已过期，当前执行边界在 Edge 内部 lifecycle/adapters。 |
| `protocol.md` | 历史方案 | REST + WebSocket 原则仍可参考，但 `api/events.schema.json` 和 Edge <-> Runner local API 描述不是当前权威。 |
| `implementation-plan.md` | 历史计划 | P0-P3 计划已完成并被当前主文档、roadmap 和 handoff 状态替代。 |
| `project-management.md` | 历史流程 | 只作早期流程记录。当前分支和协作规则以 `AGENTS.md`、`docs/governance/branch-governance.md`、`docs/roadmap.md` 为准。 |
| `backend.md` | 历史路线图 | 自声明 superseded（2026-05-23），后端路线图已合并到 `docs/roadmap.md`。所有待办项实际已完成。 |
| `frontend.md` | 历史路线图 | 自声明 superseded（2026-05-23），前端路线图已合并到 `docs/roadmap.md`。所有待办项实际已完成。 |
| `client-handoff.md` | 历史交接 | 2026-05-22 历史快照，引用已废弃的 `runner/` 目录、旧分支名 `feat/client-dev`、旧 PR #26。当前客户端接手入口为 `docs/handoff/STATE.md`。 |
| `desktop-shell-layout-progress-2026-05-25.md` | 进度记录 | Desktop shell 布局进度快照。已完成项已合入 `docs/roadmap.md` batch B，8 项后续 TODO 已提取到群聊评论。 |

### 可参考原则 - 需要按新术语重解释

这些文档仍含有有价值的原则，但不能逐字照搬旧对象名：

| 文档 | 可保留价值 | 必须重解释的部分 |
|---|---|---|
| `authority.md` | Conversation / Execution / Artifact / Memory authority 拆分仍有参考价值。 | `ExecutionAuthority.runnerId` 应改读为 Edge execution target + adapter/run context，不再指独立 Runner 组件。 |
| `data-plane.md` | UI 不直接访问远程执行节点、artifact 字节靠近 Edge 的原则仍成立。 | `Local Runner Fast Path`、`UI -> Local Runner` 已不应作为当前实现路径。当前应通过 Edge 授权和 Edge 提供的数据面能力表达。 |
| `workspace.md` | Workspace/worktree 隔离原则仍可参考。 | Runner 创建/管理 worktree 的说法应改读为 Edge lifecycle/workspace 能力。 |
| `memory.md` | Context Builder 和 memory 归属原则仍可参考。 | 需与当前 Agent Configuration/Profile 术语对齐。 |
| `data-model.md` | Project、Thread、Run、Artifact 等概念可参考。 | 任何独立 Runner 字段或 authority 字段应对齐当前 schema。 |
| `approvals.md` | 审批前置、风险分级、可审计原则仍可参考。 | 审批执行点应落在 Edge lifecycle/adapter 边界。 |
| `codex-app-reference.md` | Codex App 作为产品体验参考仍可读。 | 不代表 AgentHub 当前架构或 API 契约。 |
| `product-model.md` | IM-first、多 Agent 工作台的产品表达仍可参考。 | Agent 身份需用 Runtime/Profile/Configuration/Execution Target 术语重写。 |
| `glossary.md` | 可作为历史术语对照。 | 其中 Runner、Desktop Edge、Cloud Edge、Agent Profile 等定义已落后于当前主文档。 |
| `language-policy.md` | 中文优先、保留代码标识英文的规则仍可参考。 | 当前长期规则以 `AGENTS.md` 和 `docs/governance/document-standards.md` 为准。 |

### Build Specs

`docs/archive/build-specs/` 是早期大规格集合，不是当前 backlog 或实现任务来源。

| 目录或文件 | 状态 | 阅读方式 |
|---|---|---|
| `build-specs/backend/01-protocol.md` | 历史参考 | 类型设计可参考，实际契约以 `api/openapi.yaml` 和 `api/events.md` 为准。 |
| `build-specs/backend/02-go-services.md` | 历史方案 | 包含 `runner/`、Protobuf、旧目录设计，不作为当前工程结构依据。 |
| `build-specs/backend/03-eventstore-memory.md` | 可参考原则 | EventStore 和 memory 原则可参考，具体实现以 Edge store/events 当前代码为准。 |
| `build-specs/backend/04-adapter-sdk.md` | 历史参考 | Adapter 方向仍相关，但开发者 SDK/manifest 不是当前交付面。 |
| `build-specs/backend/05-context-builder.md` | 可参考原则 | Context 管线可参考，需合并进 Agent Configuration/Profile 语义。 |
| `build-specs/backend/06-concurrency-limits.md` | 历史参考 | 并发目标可参考，Runner 并发模型需改为 Edge lifecycle 并发模型。 |
| `build-specs/backend/07-observability.md` | 可参考原则 | 日志、指标、健康检查原则可参考，指标名称以当前代码为准。 |
| `build-specs/backend/08-error-handling.md` | 可参考原则 | 错误分类和 UX 原则可参考，错误码以 `api/conventions.md` 和实现为准。 |
| `build-specs/backend/09-testing-strategy.md` | 可参考原则 | 测试分层原则可参考，实际命令以 `AGENTS.md`、`docs/handoff/STATE.md` 为准。 |
| `build-specs/backend/10-graceful-degradation.md` | 历史参考 | 韧性原则可参考，Runner -> Edge 心跳和 Runner 自主缓冲已过期。 |
| `build-specs/backend/11-model-fallback.md` | 可参考原则 | Provider 降级思路可参考，不代表当前模型路由实现。 |
| `build-specs/backend/12-workspace-lifecycle.md` | 可参考原则 | Workspace 生命周期可参考，Runner 集成段需改读为 Edge lifecycle。 |
| `build-specs/backend/13-protobuf-schema.md` | 历史方案 | Protobuf schema 不是当前主协议。 |
| `build-specs/backend/14-scaffold-services.md` | 历史方案 | 包含旧 `runner/` 构建和 Connect/Protobuf 规划，不采用。 |
| `build-specs/backend/15-websocket-reliability.md` | 历史参考 | WS replay 和可靠性原则可参考，Runner-Edge 分层需更新。 |
| `build-specs/backend/16-hub-server-requirements.md` | 历史参考 | Hub 产品需求可参考，实际 Hub API/DB/迁移以代码和主文档为准。 |
| `build-specs/frontend/01-desktop-ux.md` | 历史参考 | 早期 UI 规格可参考，当前 UI 以 `app/desktop`、Storybook 和最新设计系统为准。 |
| `build-specs/frontend/02-monorepo.md` | 历史方案 | 旧 monorepo 规划不作为当前目录依据。 |
| `build-specs/frontend/03-agent-identity.md` | 可参考原则 | Agent 身份表达需改为 Runtime/Profile/Configuration/Execution Target。 |
| `build-specs/frontend/04-global-search.md` | 可参考原则 | 功能设想可参考，不是当前任务。 |
| `build-specs/frontend/05-keyboard-shortcuts.md` | 可参考原则 | 交互原则可参考，实际快捷键以后续 UI 文档为准。 |
| `build-specs/frontend/06-markdown-rendering.md` | 可参考原则 | Markdown 渲染选型可参考，实际依赖以代码为准。 |
| `build-specs/frontend/07-micro-interactions.md` | 可参考原则 | 微交互建议可参考，需服从当前视觉方向。 |
| `build-specs/frontend/08-theme-system.md` | 可参考原则 | 主题原则可参考，当前 tokens 以 `app/shared` 和 `app/desktop` 实现为准。 |
| `build-specs/frontend/09-accessibility.md` | 可参考原则 | 无障碍 checklist 可参考。 |
| `build-specs/frontend/10-data-portability.md` | 可参考原则 | 导入导出设想可参考，不是当前交付面。 |
| `build-specs/frontend/11-session-sharing.md` | 历史参考 | 协作分享原则可参考，authority 字段需更新。 |
| `build-specs/frontend/12-cli-wizard.md` | 历史方案 | 旧 Edge + Runner daemon、Runner API、端口 39731 规划不采用。 |
| `build-specs/frontend/13-plugin-marketplace.md` | 远期参考 | 插件市场不是当前交付面，Runner 模型需更新。 |
| `build-specs/frontend/14-performance-budget.md` | 可参考原则 | 性能预算思路可参考，指标和链路需按当前 Desktop/Edge 实现更新。 |

## 冲突提示

遇到以下说法时，按历史内容处理，不要直接复制到新文档或代码注释：

- `Hub-Edge-Runner` 作为当前架构总称。
- 独立根目录 `runner/`、`agenthub-runner`、Runner API、Runner HTTP 端口。
- UI 直接访问 Local Runner 或 Remote Runner。
- Cloud Runner 作为独立于 Edge 的执行节点。
- `RunnerEndpoint` 作为长期主对象。
- Edge 只做 Runner 管理，而不负责执行生命周期。
- `api/events.schema.json` 作为当前事件权威。
- Protobuf、Connect-RPC、JSON-RPC 作为主协议。
- 把 Claude Code、Codex、OpenCode 直接称为业务 Agent，而不是 Agent Runtime。

## 根 docs 归档建议

根目录中仍有少量旧 handoff/roadmap 文档包含独立 Runner 或旧分支信息。受本轮写入范围限制，未移动这些文件；建议见 `docs/archive/stale-docs-2026-05-25.md`。
