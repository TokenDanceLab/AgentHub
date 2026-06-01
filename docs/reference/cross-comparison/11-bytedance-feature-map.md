# bytedance.md 功能映射

最后更新：2026-06-01

本文把外部 `bytedance.md` 教学/需求简报映射到当前仓库证据。它是功能差距矩阵，不是任何旧 Trump 分支、归档 worktree 或口头进度的可信记录。

状态口径：

- 已实现：当前分支源码和测试能证明链路存在。
- 部分完成：已有有效源码，但仍缺产品、端到端、部署态或 UI 证据。
- 规划中：设计存在，但当前分支没有足够实现证据。
- 证据缺失：不能对外声称完成。

## 当前北极星

AgentHub 应保持“IM-native Agent collaboration + real Runtime execution”：

```text
TokenDance ID -> Hub session/device proof -> Hub IM/task dispatch
  -> Desktop/Edge execution target -> Agent Runtime adapter
  -> typed RunEvent / Approval / Artifact projection -> Web/Desktop/Mobile surfaces
```

产品不应转成 workflow canvas 克隆。竞品中值得借鉴的是 durable thread、trace、run history、append-only event log、审批恢复和 artifact 生命周期；AgentHub 的用户对象仍是 Agent Profile、Execution Target、Thread、Run、RunEvent、Approval 和 Artifact。

## 功能矩阵

| bytedance.md 范围 | 当前状态 | 当前证据 | 缺口 / 下一验收 |
|---|---|---|---|
| 会话列表 | 部分完成 | Hub sessions 与 Web thread 查询：`hub-server/internal/handler/session.go`、`app/web/src/api/threadQueries.ts`；IM 列表视图：`app/web/src/views/IMView.tsx`、`app/desktop/src/views/IMView.tsx` | Pin/archive/search/sort 还没有跨 Web/Desktop 证明。 |
| 单 Agent 聊天 | 部分完成，Desktop 本地链路已实测 | Web 先写 Hub message 再触发 `/web/agent-tasks`：`app/web/src/layouts/WebLayout.tsx`；Hub 会选择用户指定 Runtime：`hub-server/internal/service/agent.go`；Desktop -> Edge -> Claude Code 已完成同一 thread 三轮真实上下文 QA，证据见 `docs/handoff/STATE.md` 与 `.tmp/desktop-context-real-thread-after-fix.png` | 还需要一次部署态 smoke：Web -> Hub -> Desktop -> Edge -> Codex/Claude Code/OpenCode -> Hub message。 |
| 群聊与 @Agent | 部分完成 | Hub group session、agent instance 和邀请链路存在；Desktop `views/IMView.tsx` + IM 子组件 (IMContactList/IMMessageView/IMMessageInput)；Web `views/IMView.tsx`；`PromptInput.tsx` @Agent mention | 仍需要一个 Hub group session / TeamRun 内两个真实 Runtime Profile 的 E2E transcript。 |
| 文本/代码/diff/文件/预览/部署消息 | 部分完成 | Hub message model 有 8 个 ContentType 常量：text/code/diff/image/file/link_card/deploy_card：`hub-server/internal/model/message.go`；Web ChatView 渲染 text/code/tool/file/result block：`app/web/src/components/ChatView.tsx` | 图片/附件 UX、预览卡、部署状态卡和 artifact-specific persistence 仍需产品测试。 |
| 回复/引用/重新生成/复制/apply diff/preview | 部分完成 | Web ChatView 有复制/重试 UI；Hub message handler 有 Reply/Recall/Pin/ListPins + SendMessage/GetMessages/GetIncrementalMessages (12 handler funcs)：`hub-server/internal/handler/message.go` | Apply diff、quote UI、regenerate 语义和 preview-open 验收未跨端完成。 |
| 上下文连续性与 pinned context | 部分完成，Desktop 同 thread 已实测 | Hub message history、Edge thread/run model 和 Desktop 本地 chat reducer 都存在；Desktop 真实 Claude Code 三轮 QA 证明同一 Edge thread 能 resume 上下文并正确渲染回复；Edge `context_budget.go` + `decision_loop.go` | 还需要证明 Hub thread history 与 pinned messages 会被一致送入各 runtime 的 context builder。 |
| Orchestrator / 调度者 Agent 与 subagent | 部分完成，后端切片增强 | Edge `OrchestratorAdapter` (`orchestrator.go` + `orchestrator_dispatch.go` + `orchestrator_e2e_test.go`) 和 `decision_loop.go`；Hub 已有 `AgentTeam`、`AgentTeamRun`、`AgentTeamTask`、`AgentTeamEvent`、`TeamRunState`，typed `CoordinatorRouteDecision`、route guardrails、approval/conflict API（共 22 struct 类型）：`hub-server/internal/model/agent_team.go`、`hub-server/internal/service/agent_team.go`、`hub-server/internal/handler/agent_team.go`；Desktop bridge 会把 runtime route decision POST 到 Hub：`app/desktop/src/hooks/useHubIntegration.ts` | 产品级未完成：缺两个真实 Runtime Profile 的 local TeamRun smoke，缺 Desktop/Web TeamRun Console、task board、member status、subagent activity row、typed team blocks、pending approval count 和结果聚合 UI。不能声称 bytedance 调度者 Agent/subagent 要求已全部实现。 |
| Claude Code adapter | 已实现，有 caveat | `edge-server/internal/adapters/claude_code.go`；live smoke 记录在 `docs/handoff/STATE.md` | 阻塞式 human-in-the-loop stdin `can_use_tool` 回写仍是单独安全验收。 |
| Codex adapter | 已实现，有 caveat | `edge-server/internal/adapters/codex.go`；消费 `codex exec --json` 风格 JSONL 事件 | streaming app-server 模式和 resume/session UX 仍是后续工作。 |
| OpenCode adapter | 已实现，有 caveat | `edge-server/internal/adapters/opencode.go`；OpenCode JSON 输出映射到 text/tool/file/result events | OpenCode server/SSE 模式尚未成为主适配路径。 |
| 用户自建 Agent | 部分完成 | Hub CustomAgent model/service 和 Web profile mapping 存在 | 对话式创建、版本、市场审核、安装统计仍在规划。 |
| Agent 联系人头像/名称/能力标签 | 部分完成 | Settings surfaces 和 Hub agent profile API 存在 | Contacts-style 跨端 UX 与 capability tag 编辑未完成。 |
| Artifact 预览/编辑 | 部分完成 | Diff 与 RunDetail 组件存在；Desktop/Web 能显示 output/tool/file blocks | 全屏编辑器、iframe preview、版本历史、本地 apply/discard workflow 需要 E2E 证明。 |
| 部署发布 | 规划中 | deploy card content type 存在 | 静态/容器/package deploy flow 和 preview URL cards 未端到端实现。 |
| Web 完整 IM + editor | 部分完成 | Web Hub-only shell、Hub chat、settings/profile/task surfaces 已存在；Web visual QA 135 screenshots | Web 还缺 artifact editor、durable run history panel 和 production auth smoke。 |
| Desktop 本地文件/进程管理 | 部分完成，Desktop QA 增强 | Desktop -> Local Edge -> Runtime adapters 是当前最强实现链路；本轮补了模型 catalog、附件、工作区选择、自定义指令、真实 Claude Code context QA 和客户端截图证据 (14 screenshots)，详见 `docs/handoff/STATE.md` | Packaged TokenDance ID login/logout/reconnect、TeamRun Console 和跨端 Hub smoke 仍未关闭。 |
| Mobile 轻量 IM/approval/preview | 部分完成 | Mobile visual QA 通过 (173 screenshots, 390px scrollWidth 零溢出)；shared `MessageBubble`/`ActivityCard`/`CodePreviewCard` integration | Native/light mobile approval 与 preview flow 仍不是完整产品面。 |
| TokenDance ID 真实身份 | 部分完成 | Hub OIDC authorize/callback/session gate：`hub-server/internal/service/oidc.go`、`hub-server/internal/handler/oidc.go` (4 OIDC funcs)、`hub-server/internal/middleware/auth.go`；Web/Desktop 登录入口存在；Desktop PKCE (15 refs: code_challenge/code_verifier)：`app/desktop/src/api/hubAuth.ts` | 需要部署态真实登录 smoke：login -> Hub callback -> Hub session -> WebSocket auth -> logout/reconnect。 |
| Runtime 事件显示 | 部分完成，本轮 Desktop 增强 | Web 在 `app/web/src/utils/hubAdapters.ts` 解析 runtime payload；RunDetail projection 已消费 text/tool/file blocks；Hub 已新增最小 typed RunEvent 持久化 (`agent_run_event.go`: AgentRunEvent/Input/Filter/Summary)、`GET /web/agent-tasks/{id}/events` 和 `agent.stream` 消费；Desktop bridge 已按 `event_type + payload` 回传结构化 runtime event；Desktop ChatView 已修复 runId 去重、历史 replay、thinking 折叠、长输出折叠和 agent runtime label | 还需要把 token/step/elapsed/approval/artifact 摘要从文本投影提升为一等 UI，并补 TeamRun/多 Agent live E2E 截图。两个 Home 仍保持 product/docs 站点边界，不作为 runtime 控制台。 |
| 审批 | 部分完成，模型增强 | AgentTeam 有 `TeamApprovalState` / `TeamApprovalDecision` / `TeamApprovalEdgeControl` typed model；hub service `DecideApproval` / `ResolveConflict` / `redeliverDecidedApproval`；run-scoped REST 决策登记 | Blocking stdin `can_use_tool` 回写仍是单独安全验收。 |

## 8 个执行场景覆盖

| 场景 | 状态 | 证据 |
|------|:--:|------|
| 1. Desktop 本地离线 | 已实现 | Desktop -> Local Edge -> Claude Code/Codex/OpenCode 完整闭环 |
| 2. Desktop 本地在线 Hub | 基本实现 | Hub OIDC exchange + local session + WS auth 链路落地；Desktop PKCE 15 refs |
| 3. SSH 远程 Desktop | 未实现 | Remote Edge 注册/路由/授权未落地 |
| 4. Desktop Relay 远程 Desktop | 未实现 | Hub Relay 到任意远程 Desktop Edge 未成为通用产品链路 |
| 5. Desktop 直连云 | 未实现 | Cloud Edge / hosted target 仍是架构目标 |
| 6. Desktop Relay 到云 | 未实现 | Hub -> Cloud Edge 调度未落地 |
| 7. Web -> Desktop 最小闭环 | 基本实现 | Web -> Hub task -> Desktop bridge (`useHubIntegration.ts`) -> Local Edge -> typed stream -> Web |
| 8. Web -> Cloud | 未实现 | 依赖 Cloud Edge 注册、Hub relay routing |

当前：3/8 场景可运行（2 基本实现 + 1 已实现），5/8 远程/云端/relay 场景仍为架构规划。

## 竞品方向参考

- OpenHands 最接近 AgentHub 下一阶段需要的事件架构：append-only、类型化事件既是 agent memory，也是 service integration point。AgentHub 应借鉴原则，而不是照搬对象模型：Hub 要持久化 typed RunEvent，再投影到聊天、timeline、审计和 artifact。
- Dify workflow logs/events 证明 replay/resume 是产品能力，不只是调试能力。AgentHub Web 重连后应能恢复 run stream，而不是只看到最终 chat message。
- LangGraph threads/checkpoints 证明 thread state 与 run execution 要分层。AgentHub 应让 Hub Thread 成为 durable conversation container，让 Edge RunEvent/Artifact 成为执行证据。
- OpenCode server 暴露 sessions、status、diffs、permissions、tools、MCP、agents 和 SSE events。AgentHub Edge 仍要保持 Hub-safe protocol，但下一轮 adapter 可以参考 server mode，而不是只依赖 CLI batch parsing。

公开参考入口：`https://github.com/All-Hands-AI/OpenHands`、`https://github.com/langgenius/dify`、`https://github.com/langchain-ai/langgraph`、`https://github.com/sst/opencode`。

## 下一批 P0/P1 交付顺序

1. 部署态 TokenDance ID smoke：真实登录 Hub、Hub session、WebSocket auth、logout/reconnect；仓库只保存脱敏证据。
2. Runtime history UI：在 Web 已消费 Hub typed RunEvent 的基础上，补状态筛选、token/step/elapsed/approval/artifact 摘要；Home 站点只保留登录态入口和深链。
3. Runtime UI parity：Web/Desktop RunDetail 和 ChatView 使用同一套 text/tool/file/result/usage/approval projection，并补 live E2E 截图。
4. 多 Agent / AgentTeam local smoke：一个 Hub TeamRun 或 group session，两个真实 Runtime Profile，Supervisor typed route (DecisionLoop -> OrchestratorAdapter -> CoordinatorRouteDecision)、Hub TeamEvent replay、Desktop/Web TeamRun Console 和可见聚合 transcript。
5. Artifact lifecycle：diff/file/artifact cards 支持 open preview、apply/discard、version history 和安全路径边界。
6. Remote Edge 场景：SSH 远程 Desktop、Hub Relay 远程 Desktop、Cloud Edge 直连云 — 补注册/路由/授权/workspace policy。 
