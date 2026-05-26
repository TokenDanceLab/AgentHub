# AgentTeam 竞品深度研究与长期路线

> 状态：2026-05-26 研究结论，面向 AgentHub P1-P4 产品路线。
> 范围：AgentTeam、多 Agent 编排、Agent 通信、TeamRun、运行时事件和 UI 呈现。

---

## 0. 结论

AgentHub 现在不是没有多 Agent 代码，而是缺少**产品级 AgentTeam 模型**。

当前已有三块能力：

1. Hub IM 层有 `AgentInstance`：能把某个 Agent Profile 加到 group session，再对一个 Agent 触发 `PendingAgentTask`。
2. Desktop bridge 能把 Hub 的 `agent.dispatch` 转成一个 Local Edge `POST /v1/runs`。
3. Edge Runtime 层有本地 `OrchestratorAdapter`、runtime `AgentInstance` registry、in-memory `MessageQueue` 和 `ResultAggregator`，可以作为子 Agent 原型。

但这些还不是 AionUI、LobeHub 或 OpenHands 语境下的 AgentTeam。缺口是：

- 没有 `AgentTeam` / `AgentTeamMember` / `TeamRun` / `TeamTask` / `TeamEvent` 持久模型。
- 没有可查询、可恢复的 `TeamRunState` 聚合，无法从一个团队目标恢复成员、任务、路由决策、审批门、预算和终止原因。
- Agent 间通信只在 Edge 进程内用 channel，不进入 Hub 消息主序列、审计或 replay。
- Orchestrator 主要依赖 Runtime 输出中的调度指令，不是显式 Supervisor/Executor 状态机。
- 当前 dispatch 仍偏 prompt/text JSON 扫描，缺 `CoordinatorRouteDecision` 这类 typed router schema、校验和失败恢复。
- 子 Agent 已有 registry/depth 概念，但缺统一硬上限：最大委派深度、活跃子 Agent 数、重复路由次数、预算和时长。
- `ContextBudget` 已能预警和分配 child budget，但还没有把自动 compact、checkpoint、最小上下文切片和恢复策略纳入 TeamRun。
- Web/Desktop 没有 Team 组合、成员角色、并发树、任务看板、冲突合并、审批队列的完整 UI。
- 权限还没有覆盖“哪个 Agent 可以在什么 Execution Target、workspace、provider budget 下委派谁”。

因此下一阶段路线应从：

```text
AgentProfile -> ExecutionTarget -> Thread -> Run -> RunEvent
```

扩展为：

```text
AgentProfile -> AgentTeam -> TeamRun -> TeamTask -> Run -> RunEvent
                                 -> TeamEvent / TeamMessage / Approval / Artifact
```

AgentTeam 必须是 Hub-visible、可审计、可恢复的产品模型；Edge 本地 subagent 机制只是执行面，不应继续承担产品语义。

---

## 1. 研究来源

### 本地已有研究

| 来源 | 可复用点 |
|---|---|
| `docs/reference/projects/aionui/04-agent-model.md`、`07-gap-analysis.md`、`09-ui-deep-comparison.md` | Team Mode、Leader/Teammate、Team MCP、mailbox、task board、shared workspace、approval badge |
| `docs/reference/projects/cherry-studio/02-ui-and-source-patterns.md`、`03-agent-runtime-lessons.md` | operational Home、Settings primitives、typed blocks、tool group、composer scopes、artifact preview、runtime/Channel/Scheduler 边界 |
| `docs/reference/cross-comparison/02-im-ux.md` | message tree、fork、progressive disclosure、right panel、artifact provenance |
| `docs/reference/cross-comparison/03-orchestration.md` | Supervisor/Worker、@mention、YAML template、delegation loop guard |
| `docs/reference/projects/lobehub/03-source-adoption-map.md` | GroupOrchestrationRuntime 缺口、agent marketplace、branching conversation、artifacts |
| `docs/reference/projects/opencode/`、`codex-cli/`、`goose/` | runtime adapter、built-in agent roles、MCP/extension/provider 边界 |
| `docs/reference/projects/langflow-flowise/03-mcp-integration.md`、`04-source-adoption-map.md` | Supervisor/Worker、工具注册、MCP 暴露和 canvas/workflow 不应成为 AgentHub 主入口的边界 |
| `docs/reference/projects/librechat/`、`openhands/` | child run 隔离、subagent 上限、append-only event、workspace sandbox 和远程 agent server 分层 |

### 公开来源核验

| 项目 | 公开证据 | 对 AgentHub 的意义 |
|---|---|---|
| AionUI | <https://github.com/iOfficeAI/AionUi/blob/main/readme.md> | README 明确写 Multi-Agent Mode、Team Mode、Leader/Teammate、Team MCP Server、async mailbox、shared task board、shared workspace、scheduled automation 和 WebUI/IM channel。 |
| Cherry Studio | <https://github.com/CherryHQ/cherry-studio/blob/main/README.md> | README 强调多 provider、300+ assistants、多模型会话、MCP、topic management、enterprise model/admin/knowledge/access control；本地源码研究补齐 UI primitives。 |
| LobeHub | <https://github.com/lobehub/lobehub/blob/main/README.md> | README 已把 Agent Groups、agent teammates、schedule、workspace、branching conversations、artifacts 和 MCP marketplace 作为产品方向。 |
| OpenHands | <https://github.com/OpenHands/OpenHands/blob/main/README.md> | README 把 Software Agent SDK、CLI、Local GUI、Cloud、Enterprise 分层；云端强调 multi-user、RBAC、conversation sharing。 |
| OpenCode | <https://github.com/sst/opencode/blob/dev/README.md> | README 明确 build/plan 两个内置 agents、`@general` subagent、CLI + Desktop；说明 runtime 内部角色不等于 AgentHub 产品 Agent。 |
| Goose | <https://github.com/aaif-goose/goose/blob/main/README.md> | README 强调 desktop/CLI/API、15+ providers、ACP、70+ MCP extensions；对 AgentHub 的 Runtime/Profile/Extension 边界有参考价值。 |
| Flowise | <https://docs.flowiseai.com/tutorials/supervisor-and-workers> | Supervisor/Worker 的 schema 化路由值得借鉴，但 AgentHub 不应变成 canvas-first 低代码工作流。 |
| LibreChat | <https://www.librechat.ai/docs/features/subagents> | child run 隔离、max depth / max run config、visibility 校验可作为 AgentHub delegation guardrails 参考。 |
| LangChain / CrewAI | <https://docs.langchain.com/oss/python/langchain/multi-agent>、<https://docs.crewai.com/en/concepts/processes> | 动态 supervisor 和可复用流程模板应分层，复杂流程再导出模板，不把第一屏做成流程画布。 |

---

## 2. 当前 AgentHub 真实状态

### 2.1 Hub 层：有 AgentInstance，没有 Team

Hub `AgentInstance` 表示“某个 session 里的一个 Agent”，字段集中在 runtime/profile 选择和 session membership：

```text
agent_instance
  id
  agent_type
  custom_agent_id
  session_id
  inviter_user_id
  workspace_id
  display_name
```

`AddAgentToSession` 会创建 `AgentInstance` 和 `SessionMember`。`TriggerAgentTask` 会：

1. 从触发消息找到 session。
2. 按 `agent_instance_id` / `agent_type` / `custom_agent_id` 选一个 Agent。
3. 创建 `PendingAgentTask`。
4. 通过 Hub WS 或 offline queue 发 `agent.dispatch`。

这证明“群里可以有多个 Agent”，但还不能证明“这些 Agent 形成一个 Team”。缺少：

- team identity；
- team member roles；
- team-level policy；
- team run lifecycle；
- team task assignment；
- team result aggregation；
- team audit/replay。

### 2.2 Desktop 层：一个 dispatch 对应一个 Edge run

Desktop `useHubIntegration` 的职责是把 Hub task 转成 Local Edge run：

```text
Hub agent.dispatch
  -> Desktop receives payload
  -> ensure local Edge thread
  -> POST /v1/runs
  -> ack/fail/stream back to Hub
```

这条桥接必须保留，但它仍是单任务桥。AgentTeam 需要在它之上新增 TeamRun 视角：

```text
TeamRun
  -> TeamTask[research] -> Run
  -> TeamTask[build]    -> Run
  -> TeamTask[review]   -> Run
  -> TeamTask[test]     -> Run
```

UI 不应只显示 N 个散落 task，而要显示一个 TeamRun 下的任务树、成员状态、冲突和最终合并结果。

### 2.3 Edge 层：有本地 subagent 原型，但不是产品编排

Edge 当前有：

- runtime `agents.Registry`：记录子 Agent 的 parent、depth、status、runId；
- `agents.Queue`：per-agent channel；
- `OrchestratorAdapter`：包装 Claude Code system prompt；
- dispatch interceptor：扫描结构化 dispatch 指令并 spawn sub-agent run；
- `ResultAggregator`：子 run 结束后发 all-children-complete event；
- `/v1/agent-instances`：查看 runtime registry。

这是重要基础，但要收敛：

1. Edge `AgentInstance` 是运行期对象，不能和 Hub `AgentInstance` 混用。
2. in-memory queue 不能作为长期 Agent 通信事实源。
3. 子 Agent spawn/result 必须写入 append-only `RunEvent` / `TeamEvent`。
4. Orchestrator 需要明确状态机和失败恢复，不应只依赖 prompt 和文本 JSON。

---

## 3. 竞品模式拆解

### 3.1 AionUI：最接近 AgentTeam 的现成产品形态

AionUI 的优势不是聊天 UI，而是把 Team 当成一等使用场景：

- Leader 接收用户目标。
- Leader 拆分任务并委派 Teammate。
- Teammate 并行执行。
- Team MCP Server 提供 assign/read/report/status 这类协作工具。
- async mailbox 传递结果。
- shared task board 显示任务状态。
- shared workspace 让成员围绕同一目录工作。
- 每个 agent 有独立 permission dialog 和 pending badge。
- 支持 dynamic scaling，silent agent 可失败升级和移除。

AgentHub 应采纳：

| AionUI 模式 | AgentHub 落点 |
|---|---|
| Leader/Teammate | `AgentTeamMember.role = leader / teammate / reviewer / tester / operator` |
| Team MCP Server | Hub/Edge `TeamCoordinationTool`，提供 assignment/message/status/result |
| async mailbox | Hub `team_messages` + Edge local queue cache |
| task board | `TeamTask` 状态机和 Web/Desktop TeamRun panel |
| shared workspace | `ExecutionTarget.workspace_allowlist` + team workspace policy |
| per-agent approvals | `Approval.scope = team_task/run/agent`，UI 汇总 pending badge |
| dynamic scaling | `TeamRun` running 时允许增删 member，但要写审计事件 |

不应采纳：

- 把所有 Team 语义只放本地 SQLite。AgentHub 有 Hub 网络和多端审计，Team 必须 Hub-visible。
- 直接让所有成员共享同一目录且无 worktree/target policy。AgentHub 的远程/云执行必须保留 target/workspace allowlist。
- YOLO/Full-Auto 作为默认行为。可以有模式，但必须受 Hub policy、workspace、risk class 和 audit 约束。

### 3.2 Cherry Studio：可复用 UI 结构，不可复用信任边界

Cherry 的主要价值：

- Home 是 operational workspace，不是营销 landing。
- Settings 用 row/group primitives 保持一致。
- 消息拆成 typed blocks，tool blocks 可 grouped rendering。
- composer 有 scope registry。
- artifact/code preview 有 source/preview/split/open/download 等成熟交互。
- provider/model/MCP 信息架构成熟。

AgentHub 采纳：

| Cherry 模式 | AgentTeam 场景落点 |
|---|---|
| operational Home | 两个 Home 显示 active TeamRuns、pending approvals、target health、failed handoffs |
| typed message blocks | TeamEvent 投影为 assignment/result/approval/artifact/conflict blocks |
| tool group waiting state | TeamRun 等人、等审批、等 target、等 reviewer 都用同一 waiting semantics |
| composer scopes | `team-command`、`team-task`、`review-comment`、`agent-handoff` scopes |
| artifact preview | TeamRun 最终产物与各成员产物 side-by-side |
| Settings primitives | Team、Profile、Target、Schedule、MCP、Provider 页统一布局 |

不应采纳：

- renderer/local persisted state 作为事实源。
- provider secret 放前端持久化。
- Web 直连 Local Edge。
- 第三方 provider 直登绕过 TokenDance ID。

### 3.3 LobeHub：Agent Groups 和 agent-as-unit-of-work 的产品信号

LobeHub 的公开方向明确把 Agent Groups、agent teammates、schedule、workspace、memory、MCP marketplace 和 artifacts 放在同一个产品叙事里。对 AgentHub 的启示是：

- 市场不是单个 prompt 模板市场，而应演进到 Team template / workflow template。
- Schedule 不应只是 cron，它应该能绑定 AgentTeam、Profile、Target 和 workspace。
- Workspace 是组织协作边界，不只是本地目录。
- Memory 要 white-box、可编辑、可见；Team memory 必须有 visibility 和 retention。

AgentHub 不能照搬：

- 纯云端 chat app 的执行模型。AgentHub 真实差异是 Local/Remote/Cloud Edge 与真实 CLI Runtime。
- 把 Agent Groups 做成抽象营销概念而没有 Run/Task/Event 可审计闭环。

### 3.4 OpenHands：SDK / CLI / Local GUI / Cloud / Enterprise 分层

OpenHands 的分层对 AgentHub 有直接启发：

| OpenHands 分层 | AgentHub 对应 |
|---|---|
| Software Agent SDK | Edge `AgentAdapter` + `RunProcessContext` + future Team executor |
| CLI | 本地 Runtime adapters：Codex/Claude Code/OpenCode |
| Local GUI | Desktop + Local Edge |
| Cloud | Hub + Cloud Edge |
| Enterprise | TokenDance ID + Hub authz + audit + org/team |

AgentHub 路线应避免把 Cloud 能力和本地 P0 混在同一个验收口径里。TeamRun 可以先在 Local Edge 上完成，再扩展到 remote/cloud target。

### 3.5 OpenCode / Goose：Runtime 内部 agent roles 不是产品 Team

OpenCode 的 `build` / `plan` / `@general` 和 Goose 的 provider/ACP/MCP extension 说明一个边界：

- Runtime 内部可以有 agent role 或 subagent。
- AgentHub 仍要把它们归一为 Runtime capability。
- 产品上的 Agent Profile / AgentTeam / TeamTask 不能依赖某个 Runtime 的私有角色模型。

因此 AgentHub 需要两层适配：

```text
Runtime native role/subagent
  -> AgentHub RunEvent / ToolCall / SubRun projection
  -> TeamTask / TeamEvent aggregation
```

### 3.6 Flowise / LibreChat / LangChain / CrewAI：Supervisor 和守护栏

这组项目的共同启发不是让 AgentHub 改成 workflow builder，而是让“委派”从 prompt 技巧升级成受 schema 和策略约束的运行协议：

- Supervisor 输出应是 `CoordinatorRouteDecision`：`next_worker`、`instructions`、`reasoning`、`finish`、`confidence`、`blocked_reason`，并经过 schema 校验。
- 复杂流程可以从稳定 TeamRun 拓扑导出模板；首版不要求用户画 DAG。
- 子 Agent 必须有 hard guardrails：`MAX_DELEGATION_DEPTH`、`MAX_ACTIVE_SUBAGENTS_PER_RUN`、`MAX_ROUTE_REPEATS`、`MAX_TASKS_PER_TEAM_RUN`、budget 和 timeout。
- 上下文不能广播给所有成员。每个 TeamTask 应有最小必要 input refs、artifact refs 和 conversation slice。
- Human-in-the-loop 必须是 TeamRun / TeamTask 状态，包含 pending、timeout、deny、resume 和 replay，不只是前端弹窗。
- ReactFlow/DAG 只能作为 TeamRunState 的可视化投影或模板编辑器，不替代 IM 主入口。

---

## 4. 推荐 AgentTeam 模型

### 4.1 核心实体

| 实体 | 核心字段 | 说明 |
|---|---|---|
| `AgentTeam` | `id`, `owner_id`, `workspace_id`, `name`, `description`, `visibility`, `default_target_policy`, `created_by` | 用户/团队可管理的协作模板。 |
| `AgentTeamMember` | `team_id`, `profile_id`, `role`, `capability_tags`, `priority`, `max_parallel_tasks`, `budget_share`, `target_preferences` | Team 中的成员配置，不直接绑定 Runtime secret。 |
| `TeamRun` | `id`, `team_id`, `thread_id`, `trigger_message_id`, `status`, `goal`, `created_by`, `started_at`, `finished_at`, `budget`, `trace_id` | 一次团队协作执行。 |
| `TeamTask` | `id`, `team_run_id`, `assignee_member_id`, `parent_task_id`, `status`, `objective`, `input_refs`, `run_id`, `attempt`, `risk_level` | 可并行、可重试、可审批的一项子任务。 |
| `TeamMessage` | `id`, `team_run_id`, `from_member_id`, `to_member_id`, `task_id`, `type`, `payload`, `created_at` | Agent 间通信事实源，可投影为 IM 消息。 |
| `TeamEvent` | `seq`, `team_run_id`, `task_id`, `type`, `payload`, `visibility`, `created_at` | append-only 团队事件源，支持 replay 和审计。 |
| `TeamArtifact` | `team_run_id`, `task_id`, `artifact_id`, `role`, `source_run_id` | 让最终产物和成员产物可追溯。 |
| `TeamRunState` | `team_run_id`, `members`, `tasks`, `dependencies`, `route_decisions`, `approvals`, `budgets`, `terminal_reason`, `updated_at` | 从 `TeamEvent` / `RunEvent` 派生的可查询 snapshot，不替代事件源。 |
| `CoordinatorRouteDecision` | `team_run_id`, `task_id`, `next_worker`, `instructions`, `reasoning`, `finish`, `blocked_reason`, `correlation_id` | Supervisor 的 typed route 输出，替代文本 JSON dispatch 作为长期目标。 |

### 4.2 状态机

```text
TeamRun
  draft
  -> queued
  -> planning
  -> dispatching
  -> running
  -> waiting_for_approval
  -> merging
  -> done
  -> failed / cancelled / expired

TeamTask
  pending
  -> assigned
  -> running
  -> waiting_for_input
  -> waiting_for_approval
  -> result_reported
  -> accepted
  -> rejected
  -> retrying
  -> done
  -> failed / cancelled / expired
```

状态机规则：

- `TeamRun.done` 必须由所有 required task terminal + merge/summary task 完成触发。
- `TeamTask.result_reported` 不等于 accepted；Leader 或人类 reviewer 可以 reject 并创建 retry task。
- approval 是 blocking state，不能只做 UI 展示。
- task retry 必须保留 attempt 和 parent_task_id，不覆盖历史。
- cancellation 必须向子 `Run` 传播。

### 4.3 事件族

```text
team.run.created
team.run.started
team.plan.proposed
team.member.added
team.member.removed
team.task.assigned
team.task.started
team.task.progress
team.task.waiting
team.task.result
team.task.rejected
team.task.retrying
team.approval.requested
team.approval.decided
team.conflict.detected
team.merge.started
team.merge.finished
team.run.done
team.run.failed
```

这些事件应与现有 `run.agent.*` 形成层级关系：

```text
TeamEvent(team.task.started)
  -> RunEvent(run.queued)
  -> RunEvent(run.agent.tool_call)
  -> RunEvent(run.agent.file_change)
  -> RunEvent(run.finished)
TeamEvent(team.task.result)
```

### 4.4 通信模型

第一阶段不需要做复杂 P2P agent bus。建议：

1. Hub 是 Team communication SSOT：`team_messages` / `team_events` 可 replay。
2. Edge 本地 queue 是运行缓存：断线或重启后从 Hub replay 恢复。
3. Agent 对 Agent 的消息先是 structured event，再投影到 IM timeline。
4. 所有 Agent message 必须有 sender、receiver、task_id、correlation_id。
5. broadcast 只允许在 TeamRun scope 内，不能跨 workspace。

---

## 5. UI 信息架构

### 5.1 AgentTeam Builder

首版 UI 不做画布。采用 dense command-center layout：

- 左侧：Team 列表和模板。
- 中间：成员表格（Profile、Role、Runtime、Model、Target、Capabilities、Budget、Policy）。
- 右侧：选中成员详情、审批策略、workspace allowlist、MCP/Skill 依赖。

必要操作：

- 从 Agent Profile 添加成员。
- 设置 Leader。
- 设置每个成员的 Execution Target preference。
- 选择 Team workspace。
- 配置 max parallel、max depth、timeout、approval mode。
- 运行 dry-run readiness：Runtime availability、target online、workspace allowlist、MCP health、secret-free config。

### 5.2 TeamRun Console

TeamRun Console 应比普通 RunDetail 更像任务控制台：

```text
Header: goal / status / elapsed / active agents / pending approvals
Left: task tree / board
Center: team transcript and typed event blocks
Right: artifacts / diffs / approvals / target health / member logs
Bottom: scoped composer
```

借鉴 Cherry 的 typed blocks 和 AionUI task board：

- assignment block；
- progress block；
- tool group block；
- file diff block；
- approval block；
- conflict block；
- artifact block；
- result summary block。

### 5.3 两个 Home

Home 只展示 action-first 状态，不做 marketing hero：

| Home | 应显示 |
|---|---|
| Desktop Home | Local Edge health、active TeamRuns、pending approvals、target/workspace health、recent artifacts、failed runs、Runtime availability |
| Web Home | Hub session、remote Desktop online、active TeamRuns、assigned approvals、target inventory、recent artifacts、OIDC/session warnings |

Web 仍必须 Hub-only；所有 Runtime 操作深链到 Hub session 和 Desktop/Edge bridge。

---

## 6. 安全和权限

AgentTeam 比单 Agent 更危险，因为它把自动委派、并行执行和共享 workspace 叠在一起。必须把以下规则前置：

| 风险 | 规则 |
|---|---|
| 越权委派 | 每次 `team.task.assigned` 都检查 current user、team、profile、target、workspace 权限。 |
| 跨 target 泄露 | Team member 的 target preference 只能从 owner-scoped `ExecutionTarget` 选择。 |
| workspace 逃逸 | TeamRun 继承 `workspace_allowlist`，子 Run 不得扩大。 |
| secret 扩散 | TeamEvent/TeamMessage 不存 provider key、token、真实生产路径。 |
| auto approve | YOLO/Full-Auto 只能在 low-risk workspace 和 explicit policy 下启用，并写审计。 |
| remote/cloud | 远程/云 target 必须有 device proof、remote approval、audit buffer 和 relay routing。 |
| loop 爆炸 | max depth、max parallel、max tasks、budget、timeout 都是 TeamRun 字段。 |

---

## 7. Roadmap 建议

### A. 近期：AgentTeam 契约和 UI 空壳（1-2 周）

目标：把产品对象立起来，但不声称远程/云完成。

- Hub model/migration：`agent_teams`、`agent_team_members`。
- API：`GET/POST /web/agent-teams`、`GET/PATCH/DELETE /web/agent-teams/{id}`。
- Web/Desktop Settings：Team list、member table、readiness summary。
- docs：OpenAPI、events、product/system/implementation guide 同步。
- 验收：owner-scoped CRUD、跨 owner 403/404、Web Hub-only boundary。

### B. 近期：TeamRunState + 结构化路由（1-2 周）

目标：把当前 prompt-only subagent dispatch 收敛到 typed route 和可恢复 snapshot。

- 定义 `CoordinatorRouteDecision` schema 和 `team.route.decided` / `team.route.rejected` 事件。
- 保留旧文本 JSON dispatch 兼容，但新 TeamRun 只消费 typed route。
- 新增 TeamRunState projection：members、tasks、dependencies、approvals、budget、terminal reason。
- Guardrails：max depth、max active subagents、max route repeats、max tasks、timeout、child budget。
- Context：每个 TeamTask 使用最小 input refs、artifact refs、conversation slice；超预算时触发 compact/checkpoint，而不是把完整 thread 广播给所有成员。
- 验收：非法 route 被拒绝并写 `team.route.rejected`；Edge/Hub replay 后 TeamRunState 可恢复。

### C. 近期：TeamRun 最小闭环（2-3 周）

目标：一个 TeamRun 能派发两个本地 Profile，并在 UI 聚合。

- Hub model/migration：`team_runs`、`team_tasks`、`team_events`。
- API：`POST /web/team-runs`、`GET /web/team-runs/{id}`、`GET /web/team-runs/{id}/events`。
- Dispatch：TeamTask 复用现有 `/web/agent-tasks`，每个 task 绑定 `run_id`。
- UI：TeamRun Console 显示 task board、member status、pending approval count、result blocks。
- 验收：Codex + Claude Code 或 Codex + OpenCode 两个真实 Runtime Profile 的 local TeamRun smoke。

### D. 中期：Supervisor/Executor 收敛（3-5 周）

目标：把 Edge prompt-driven orchestrator 收敛为显式状态机。

- 定义 `TeamSupervisor` interface：plan、assign、observe、merge、finish。
- Edge `OrchestratorAdapter` 只做 Runtime adapter，不再承载产品 Team state。
- TeamTask assignment 写 Hub `TeamEvent`，Edge spawn 写 `RunEvent`。
- ResultAggregator 输出 `team.task.result`，并支持 retry/reject。
- loop guard：max depth、max iterations、worker repeat guard、budget。
- 验收：失败子 task 能 retry，取消 TeamRun 能取消子 Run，Hub replay 后 UI 可恢复。

### E. 中期：Artifact / Approval / Conflict 一等化（3-4 周）

目标：让 TeamRun 的价值可见。

- Team artifact index：每个 artifact 追溯到 member/task/run/tool。
- Approval aggregation：TeamRun header 汇总 pending/decided/expired。
- Conflict detection：同文件多 agent 修改、不同结论、失败和重试分组。
- UI：side-by-side artifacts/diffs，result comparison。
- 验收：两个 Agent 同改一文件时 UI 标出 conflict 并要求人类决策。

### F. 长期：Remote/Cloud TeamRun（Q3-Q4）

目标：TeamRun 可以跨 Local/Remote/Cloud Edge，但仍保持 Hub-only Web 和 Hub authz。

- `target_id` dispatch route 完成。
- target-bound pending queue。
- remote approval proof。
- Cloud Edge provisioning / lease / quota。
- workspace allowlist 同步和远程 artifact proxy。
- 验收：Web 启动 TeamRun，分别派到当前 Desktop 和一个 Remote/Cloud target，Hub 可 replay 全部 TeamEvent，审批和 artifact 可追溯。

### G. 长期：Team Template / Market / Schedule（Q4+）

目标：把 Team 从一次配置变成可复用资产。

- AgentTeam template 发布/安装。
- Team capability declaration。
- Scheduler 绑定 TeamRun。
- Feishu/Lark card 触发 TeamRun，但身份仍走 TokenDance ID 映射。
- Team memory、retention、visibility 和 audit export。

---

## 8. 立即不做

- 不做 Langflow/Flowise 式 canvas-first builder。AgentHub 是 IM-native，拓扑从 Thread/TeamRun 中涌现。
- 不把 AionUI 的本地 SQLite Team SSOT 原样搬进 AgentHub；Hub 必须掌握 Team SSOT。
- 不把 Runtime 内置 role 当产品 AgentTeam。
- 不让 Web 直接连接 Local Edge 或 Runtime。
- 不默认启用 YOLO/Full-Auto。
- 不把 AgentTeam 和远程/云 target 一口气绑定成 8/8 完成口径。

---

## 9. 下一批建议 worktree

| 分支 | 写入范围 | 目标 |
|---|---|---|
| `feat/agentteam-contract` | `hub-server/`、`api/`、`app/web/src/api`、`app/desktop/src/api`、docs | AgentTeam/Member CRUD 契约和 owner boundary。 |
| `feat/teamrun-local-smoke` | `hub-server/`、`app/web`、`app/desktop`、docs | TeamRun/TeamTask/TeamEvent 本地双 Runtime 最小闭环。 |
| `feat/teamrun-console-ui` | `app/shared`、`app/web`、`app/desktop` | task board、typed team blocks、approval summary、artifact slots。 |
| `feat/team-supervisor-state-machine` | `edge-server/internal/lifecycle`、`edge-server/internal/adapters`、`hub-server` | 显式 Supervisor/Executor、retry/reject/cancel/replay。 |
| `feat/team-schedule-template` | `hub-server`、`app/web`、`app/desktop` | Team template、schedule、market readiness。 |

每个分支都必须保持 Web Hub-only、Hub-issued session 授权、Execution Target owner boundary 和 secret-free docs。
