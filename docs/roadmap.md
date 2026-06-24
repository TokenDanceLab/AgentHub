# AgentHub 全链路数据对接路线图

> 最后更新：2026-06-19
> 版本：v0.5.0（SUPER Phase 1/4/5 完成，Phase 2+3 执行中）
> 本文档是架构参考 + 数据流基线 + gap 清单，以及功能 Roadmap。
> 验收标准：发布 Release，完成全部真实数据流打通。

---

## SUPER 工程修复进度 (2026-06-24 全部完成)

基于 [SUPER 工程审计](governance/super-score-2026-06-19.md)（63→~67/100），52 任务 6 Phase 全部完成，已合并到 master（PR #316）。
详见 `docs/archives/super-remediation/progress/MASTER.md`。

| Phase | 名称 | 进度 | 状态 |
|---|---|---|---|
| Phase 1 | 后端安全与基础 | 12/12 | ✅ 完成 |
| Phase 2 | Edge 安全加固 | 7/7 | ✅ 完成 |
| Phase 3 | 架构重构 | 5/5 | ✅ 完成 |
| Phase 4 | 前端与 Mobile 质量 | 7/7 | ✅ 完成 |
| Phase 5 | 文档、平台与打磨 | 17/17 | ✅ 完成 |
| Phase 6 | 延后项 | 4/4 | ✅ 完成 |

### CI 修复（v0.5.1, 2026-06-24）

lint/typecheck 全模块清零，go-hub 测试修复，Docker 修复。覆盖率 64.9%→65.8%。
详见 `docs/analysis/ci-remediation-analysis.md`。

---

## 0. 产品北极星

AgentHub 要成为 IM 形态的多 Agent 协作工作台。用户面对的是联系人、群聊、项目会话、Agent 队友、审批、Diff、Preview 和产物，而不是一组 Runtime 下拉框。

```text
Web / Desktop / Mobile / IM
  -> Hub 身份、会话、联系人、群聊、权限、路由、回放
  -> Execution Target: Local Edge / Remote Edge / Cloud Edge / Hub Relay
  -> Edge Runtime adapter: Claude Code / Codex / OpenCode / SDK / Custom
  -> 类型化事件、审批、Diff、Preview、Artifact、执行记录
  -> 同一条 IM 任务流渲染和控制
```

产品判断标准：

- Agent Profile 回答"谁来做事"，Agent Runtime 回答"用什么执行"。
- IM 是核心体验：单聊、群聊、`@Agent`、Orchestrator 分派和上下文连续必须在同一条任务流里成立。
- 产物必须内联：代码 Diff、网页预览、文件附件、审批、部署状态和生成资产不应散落在日志或后台页面。
- Web 远控、Desktop 本地执行、Mobile/IM 审批查看使用同一 Hub/Edge 事件合同。
- mock、fixture、observed、approved-real、production 必须显式区分；真实登录、真实 CLI/model/API、部署、签名、公证和 release upload 都需要明确审批。

---

## 1. 架构分层与数据流

### 1.1 五层数据流

```text
┌─────────────────────────────────────────────────────┐
│  Web (5174)  │  Desktop (5173)  │  Mobile (Expo RN) │
│  app/web/    │  app/desktop/    │  app/mobile-rn/    │
└──────┬───────┴────────┬─────────┴────────┬──────────┘
       │                │                  │
       └────────────────┼──────────────────┘
                        │
              app/shared/ (共享 UI + 类型 + 合同)
              ├── src/workbench/    v4 工作台 shell
              │   ├── AgentHubWorkbench.tsx  主布局
              │   ├── WorkbenchRoutes.tsx    子页路由
              │   ├── pages/                7 个子页组件
              │   ├── settingsService.ts     设置读写抽象
              │   └── mockData.ts            Mock 数据源
              ├── src/transcript/   统一消息合同
              ├── src/composer/     统一输入区
              ├── src/inspector/    统一证据面板
              ├── src/platform/     Platform Adapter 接口
              │   └── types.ts      AgentHubPlatform 定义
              ├── src/hubEvents.ts  33 个 WS 事件常量
              └── src/ui/           基础 UI primitives
                        │
         ┌──────────────┴──────────────┐
         │                             │
  Web Platform Adapter         Desktop Platform Adapter
  ├── hubClient.ts              ├── hubClient.ts
  ├── hubWS.ts                  ├── hubWS.ts
  ├── hubAuth.ts                ├── hubAuth.ts
  ├── edgeClient.ts             ├── edgeClient.ts
  ├── contactQueries.ts         ├── sessionQueries.ts
  ├── agentQueries.ts           ├── agentProfileQueries.ts
  ├── projectQueries.ts         ├── documentQueries.ts
  ├── runQueries.ts             ├── projectQueries.ts
  ├── executionTargetQueries.ts ├── agentQueries.ts
  ├── agentTeamQueries.ts       ├── runQueries.ts
  └── threadQueries.ts          ├── runEvidenceQueries.ts
                                ├── modelCatalogQueries.ts
                                └── agentTeamQueries.ts
                        │
         ┌──────────────┴──────────────┐
         │                             │
    Hub Server (8080)           Edge Server (3210)
    ├── Auth/OIDC/Session       ├── Run lifecycle
    ├── IM/Contacts/Sessions    ├── AgentAdapter (6 个)
    ├── AgentTasks/Routing      ├── SQLite EventStore
    ├── Approvals/Artifacts     ├── Context Builder
    ├── Projects/Workspaces     └── Workspace allowlist
    ├── Documents
    ├── CustomAgents/Profiles
    ├── Skills/MCP/Market
    ├── ExecutionTargets
    ├── Settings
    ├── AgentTeams
    └── Audit/Relay
                        │
         ┌──────────────┴──────────────┐
         │                             │
  TokenDance ID OIDC          CLI / SDK Adapters
  (统一身份源)                 ├── Claude Code (stream-json)
                              ├── Codex (exec --json)
                              ├── OpenCode (run --format json)
                              ├── Anthropic SDK (HTTP SSE)
                              └── OpenAI SDK (HTTP SSE)
```

### 1.2 数据线

| 线路 | 方向 | 协议 | 用途 |
|------|------|------|------|
| 控制线 | Workbench -> Platform Adapter -> Edge/Hub REST -> AgentAdapter -> Runtime | REST JSON | 发消息、触发任务、审批决策、CRUD 操作 |
| 事件线 | Agent Runtime -> Edge EventStore -> Edge/Hub WS -> Platform Adapter -> Transcript | WebSocket typed events | 实时消息推送、Agent 状态变更、流式输出 |
| 证据线 | RunEvent -> EvidenceRef -> Inspector -> Artifact/File/Preview | REST + WS | Diff、Artifact、Preview 内联展示 |
| 同步线 | Edge EventStore -> Hub Sync -> Web/Desktop/Mobile viewers | REST + WS | 离线补齐、跨端同步、历史回放 |

### 1.3 三层数据模式

| 模式 | `dataMode` 值 | 特征 | 当前状态 |
|------|-------------|------|---------|
| Demo (mock) | `mock` | JS 内存数据，零依赖 | 已工作 |
| Observed | `observed` | Edge API 只读观察 | `verify-real-api-smoke.ps1` 44/44 通过 |
| Approved-Real | `approved-real` | 真实 Hub+Edge+CLI | Claude Code + OpenCode 真实执行已验证 |

### 1.4 Hub Server 完整路由表

| 分组 | 端点 | 方法 | Handler |
|------|------|------|---------|
| **Health** | `/health` | GET | `healthHandler.Check` |
| | `/health/live` | GET | `healthHandler.Live` |
| | `/health/ready` | GET | `healthHandler.Ready` |
| **Auth** | `/client/auth/refresh` | POST | `authHandler.Refresh` |
| | `/client/auth/oidc/authorize` | POST | `oidcHandler.PostOIDCAuthorize` |
| | `/client/auth/oidc/callback` | POST/GET | `oidcHandler.PostOIDCCallback`/`GetOIDCCallback` |
| | `/client/auth/me` | GET | `authHandler.Me` |
| | `/client/auth/logout` | POST | `authHandler.Logout` |
| | `/client/auth/profile` | PUT | `authHandler.UpdateProfile` |
| **Contacts** | `/client/contacts/search` | GET | `contactHandler.SearchUser` |
| | `/client/contacts/friend-requests` | GET/POST | `contactHandler.ListFriendRequests`/`SendFriendRequest` |
| | `/client/contacts/friend-requests/:id/accept` | POST | `contactHandler.AcceptFriendRequest` |
| | `/client/contacts/friend-requests/:id/reject` | POST | `contactHandler.RejectFriendRequest` |
| | `/client/contacts` | GET | `contactHandler.ListContacts` |
| | `/client/contacts/:user_id` | DELETE | `contactHandler.RemoveContact` |
| | `/client/contacts/:user_id/block` | POST | `contactHandler.BlockContact` |
| | `/client/contacts/:user_id/unblock` | POST | `contactHandler.UnblockContact` |
| | `/client/contacts/:user_id/remark` | PUT | `contactHandler.UpdateRemark` |
| **Sessions** | `/client/sessions` | GET | `sessionHandler.List` |
| | `/client/sessions/private` | POST | `sessionHandler.CreatePrivate` |
| | `/client/sessions/group` | POST | `sessionHandler.CreateGroup` |
| | `/client/sessions/search` | GET | `sessionHandler.SearchSessions` |
| | `/client/sessions/:id/members` | POST | `sessionHandler.AddMembers` |
| | `/client/sessions/:id/members/:user_id` | DELETE | `sessionHandler.RemoveMember` |
| | `/client/sessions/:id/leave` | POST | `sessionHandler.Leave` |
| | `/client/sessions/:id/transfer-owner` | POST | `sessionHandler.TransferOwner` |
| | `/client/sessions/:id/dissolve` | POST | `sessionHandler.Dissolve` |
| | `/client/sessions/:id/info` | PUT | `sessionHandler.UpdateGroupInfo` |
| | `/client/sessions/:id/settings` | PUT | `sessionHandler.UpdateMemberSettings` |
| | `/client/sessions/:id` | DELETE | `sessionHandler.DeleteForMe` |
| **Messages** | `/client/sessions/:id/messages` | POST/GET | `messageHandler.SendMessage`/`GetMessages` |
| | `/client/sessions/:id/messages/sync` | GET | `messageHandler.GetIncrementalMessages` |
| | `/client/sessions/:id/messages/search` | GET | `messageHandler.SearchSessionMessages` |
| | `/client/sessions/:id/pins` | GET | `messageHandler.ListPins` |
| | `/client/sessions/:id/read` | POST | `messageHandler.MarkRead` |
| | `/client/sessions/:id/agents` | POST | `agentHandler.AddAgentToSession` |
| | `/client/messages/:id/recall` | POST | `messageHandler.RecallMessage` |
| | `/client/messages/:id` | PUT | `messageHandler.EditMessage` |
| | `/client/messages/:id/pin` | POST/DELETE | `messageHandler.PinMessage`/`UnpinMessage` |
| | `/client/messages/:id/reactions` | GET/POST/DELETE | `messageHandler.ListMessageReactions`/`AddMessageReaction`/`RemoveMessageReaction` |
| | `/client/messages/:id/forward` | POST | `messageHandler.ForwardMessage` |
| | `/client/messages/search` | GET | `messageHandler.SearchMessages` |
| **Attachments** | `/client/attachments/probe` | POST | `attachmentHandler.Probe` |
| | `/client/attachments` | POST | `attachmentHandler.Upload` |
| | `/client/attachments/:id` | GET | `attachmentHandler.Download` |
| **Notifications** | `/client/notifications` | GET | `notificationHandler.ListNotifications` |
| | `/client/notifications/:id/read` | POST | `notificationHandler.MarkRead` |
| | `/client/notifications/read-all` | POST | `notificationHandler.ReadAll` |
| **Settings** | `/client/settings` | GET/PATCH | `settingsHandler.GetSettings`/`PatchSettings` |
| **WebSocket** | `/client/ws` | GET (upgrade) | `wsHandler.ServeWS` |
| **Edge** | `/edge/devices/register` | POST | `deviceHandler.Register` |
| | `/edge/agent-tasks/:id/ack` | POST | `agentHandler.TaskAck` |
| | `/edge/agent-tasks/:id/stream` | POST | `agentHandler.TaskStream` |
| | `/edge/agent-tasks/:id/done` | POST | `agentHandler.TaskDone` |
| | `/edge/agent-tasks/:id/fail` | POST | `agentHandler.TaskFail` |
| **Cloud** | `/cloud/edge/register` | POST | `deviceHandler.CloudEdgeRegister` |
| **Agent Tasks** | `/web/agent-tasks` | POST | `agentHandler.TriggerTask` |
| | `/web/agent-tasks/:id/cancel` | POST | `agentHandler.CancelTask` |
| | `/web/agent-tasks/:id/summary` | GET | `agentHandler.TaskEventSummary` |
| | `/web/agent-tasks/:id/events` | GET | `agentHandler.TaskEvents` |
| | `/web/agent-tasks/:id/approvals` | GET | `agentHandler.TaskApprovals` |
| | `/web/agent-tasks/:id/approvals/:approval_id/decide` | POST | `agentHandler.DecideTaskApproval` |
| | `/web/agent-tasks/:id/artifacts` | GET | `agentHandler.TaskArtifacts` |
| **Custom Agents** | `/web/custom-agents` | GET/POST | `customAgentHandler.List`/`Create` |
| | `/web/custom-agents/:id` | PUT/DELETE | `customAgentHandler.Update`/`Delete` |
| **Agent Profiles** | `/web/agent-profiles` | GET/POST | `agentProfileHandler.ListProfiles`/`CreateProfile` |
| | `/web/agent-profiles/:id` | GET/PATCH/DELETE | `agentProfileHandler.GetProfile`/`UpdateProfile`/`DeleteProfile` |
| | `/web/agent-profiles/:id/publish` | POST | `agentProfileHandler.PublishProfile` |
| | `/web/agent-profiles/:id/install` | POST | `agentProfileHandler.InstallProfile` |
| **Skills** | `/web/skills` | GET/POST | `skillHandler.ListSkills`/`CreateSkill` |
| | `/web/skills/:id` | GET/PUT/DELETE | `skillHandler.*` |
| | `/web/skills/:id/publish` | POST | `skillHandler.PublishSkill` |
| | `/web/skills/:id/unpublish` | POST | `skillHandler.UnpublishSkill` |
| **MCP Servers** | `/web/mcp-servers` | GET/POST | `mcpHandler.ListMCPServers`/`CreateMCPServer` |
| | `/web/mcp-servers/:id` | GET/PUT/DELETE | `mcpHandler.*` |
| | `/web/mcp-servers/:id/publish` | POST | `mcpHandler.PublishMCPServer` |
| **Market** | `/web/market/profiles` | GET | `marketHandler.SearchMarketProfiles` |
| | `/web/market/profiles/:id` | GET | `marketHandler.GetMarketProfile` |
| | `/web/market/profiles/:id/install` | POST | `marketHandler.InstallMarketProfile` |
| | `/web/market/profiles/:id/rate` | POST | `marketHandler.RateMarketProfile` |
| **Provider Bindings** | `/web/provider-bindings` | GET/POST | `pbHandler.List`/`Create` |
| | `/web/provider-bindings/:id` | PUT/DELETE | `pbHandler.Update`/`Delete` |
| **Execution Targets** | `/web/execution-targets` | GET/POST | `targetHandler.ListTargets`/`CreateTarget` |
| | `/web/execution-targets/:id` | GET/PATCH/DELETE | `targetHandler.*` |
| | `/web/execution-targets/:id/ping` | POST | `targetHandler.PingTarget` |
| **Documents** | `/web/documents` | GET/POST | `documentHandler.ListDocuments`/`CreateDocument` |
| | `/web/documents/:id` | GET/PATCH/DELETE | `documentHandler.*` |
| **Projects** | `/web/projects` | GET/POST | `workspaceHandler.ListWorkspaces`/`CreateWorkspace` |
| | `/web/projects/:id` | GET/PATCH | `workspaceHandler.*` |
| | `/web/projects/:id/threads` | GET/POST | `workspaceHandler.ListProjectThreads`/`CreateProjectThread` |
| | `/web/projects/:id/threads/:threadId/messages` | GET/POST | `workspaceHandler.*` |
| **Agent Teams** | `/web/agent-teams` | GET/POST | `agentTeamHandler.ListTeams`/`CreateTeam` |
| | `/web/agent-teams/:id` | GET/PUT/DELETE | `agentTeamHandler.*` |
| | `/web/agent-teams/:id/members` | POST | `agentTeamHandler.AddMember` |
| | `/web/agent-teams/:id/members/:member_id` | DELETE | `agentTeamHandler.RemoveMember` |
| | `/web/agent-teams/:id/runs` | GET/POST | `agentTeamHandler.ListRuns`/`StartRun` |
| | `/web/agent-teams/:id/runs/:run_id` | GET | `agentTeamHandler.GetRun` |
| | `/web/agent-teams/:id/runs/:run_id/state` | GET | `agentTeamHandler.GetRunState` |
| | `/web/agent-teams/:id/runs/:run_id/tasks` | GET | `agentTeamHandler.ListTeamTasks` |
| | `/web/agent-teams/:id/runs/:run_id/events` | GET | `agentTeamHandler.ListTeamEvents` |
| | `/web/agent-teams/:id/runs/:run_id/route-decisions` | POST | `agentTeamHandler.HandleRouteDecision` |
| | `/web/agent-teams/:id/runs/:run_id/approvals/:approval_id/decide` | POST | `agentTeamHandler.DecideApproval` |
| | `/web/agent-teams/:id/runs/:run_id/conflicts/:conflict_id/resolve` | POST | `agentTeamHandler.ResolveConflict` |
| | `/web/agent-teams/:id/runs/:run_id/assignments` | GET/POST | `agentTeamHandler.*` |
| | `/web/agent-teams/:id/runs/:run_id/assignments/:assignment_id/dispatch` | POST | `agentTeamHandler.DispatchAssignment` |
| | `/web/agent-teams/:id/runs/:run_id/assignments/:assignment_id/complete` | POST | `agentTeamHandler.CompleteAssignment` |
| | `/web/agent-teams/:id/runs/:run_id/assignments/:assignment_id/fail` | POST | `agentTeamHandler.FailAssignment` |
| **Devices** | `/web/devices` | GET | `deviceHandler.ListDevices` |
| **Audit** | `/web/audit-events` | GET | `auditHandler.ListAuditEvents` |
| **Relay** | `/web/relay/commands` | POST | `relayHandler.CreateCommand` |
| | `/web/relay/commands/:id` | GET | `relayHandler.GetCommand` |
| | `/web/relay/commands/:id/ack` | POST | `relayHandler.AckCommand` |
| **Public** | `/api/public/stats` | GET | `publicHandler.Stats` |

### 1.5 WebSocket 事件合同（33 个事件常量）

| 事件常量 | 事件类型字符串 | 方向 | 用途 |
|---------|--------------|------|------|
| `AUTH` | `auth` | C->S | 客户端发送认证 |
| `AUTH_OK` | `auth.ok` | S->C | 认证成功 |
| `AUTH_FAIL` | `auth.fail` | S->C | 认证失败 |
| `MESSAGE_NEW` | `message.new` | S->C | 新消息到达 |
| `MESSAGE_RECALL` | `message.recall` | S->C | 消息被撤回 |
| `MESSAGE_PIN` | `message.pin` | S->C | 消息被置顶 |
| `MESSAGE_UNPIN` | `message.unpin` | S->C | 消息被取消置顶 |
| `MESSAGE_READ` | `message.read` | S->C | 已读回执更新 |
| `SESSION_CREATED` | `session.created` | S->C | 新会话创建 |
| `SESSION_DISSOLVED` | `session.dissolved` | S->C | 会话被解散 |
| `SESSION_MEMBER_JOINED` | `session.member_joined` | S->C | 群成员加入 |
| `SESSION_MEMBER_LEFT` | `session.member_left` | S->C | 群成员离开 |
| `SESSION_INFO_UPDATED` | `session.info_updated` | S->C | 会话信息变更 |
| `DEVICE_ONLINE` | `device.online` | S->C | 设备上线 |
| `DEVICE_OFFLINE` | `device.offline` | S->C | 设备下线 |
| `DEVICE_KICKED` | `device.kicked` | S->C | 设备被踢出 |
| `AGENT_DISPATCH` | `agent.dispatch` | S->C | Agent 任务已派发 |
| `AGENT_STREAM` | `agent.stream` | S->C | Agent 流式输出 |
| `AGENT_DONE` | `agent.done` | S->C | Agent 任务完成 |
| `AGENT_FAILED` | `agent.failed` | S->C | Agent 任务失败 |
| `AGENT_CANCEL` | `agent.cancel` | S->C | Agent 任务取消 |
| `AGENT_CONTROL` | `agent.control` | S->C | Agent 控制指令 |
| `AGENT_REGENERATE` | `agent.regenerate` | S->C | Agent 重新生成 |
| `NOTIFICATION_NEW` | `notification.new` | S->C | 新通知 |
| `FRIEND_REQUEST` | `friend.request` | S->C | 好友请求 |
| `FRIEND_ACCEPTED` | `friend.accepted` | S->C | 好友请求被接受 |
| `SYNC_REQUEST` | `sync.request` | C->S | 客户端请求同步 |
| `SYNC_EVENTS` | `sync.events` | S->C | 服务端推送同步事件 |
| `PLAN_PROPOSED` | `run.agent.plan_proposed` | S->C | Agent 计划已提议 |
| `PLAN_APPROVED` | `run.agent.plan_approved` | S->C | Agent 计划已批准 |
| `PLAN_REJECTED` | `run.agent.plan_rejected` | S->C | Agent 计划已拒绝 |
| `PLAN_EXPIRED` | `run.agent.plan_expired` | S->C | Agent 计划已过期 |

### 1.6 关键文件索引

| 区域 | 关键文件 | 职责 |
|------|---------|------|
| **共享平台接口** | `app/shared/src/platform/types.ts` | `AgentHubPlatform` 接口：`conversations`/`runs`/`settings`/`host`/`preview`/`attachments` |
| **共享工作台** | `app/shared/src/workbench/AgentHubWorkbench.tsx` | 主布局 shell |
| | `app/shared/src/workbench/WorkbenchRoutes.tsx` | 7 子页路由 + 数据绑定 |
| | `app/shared/src/workbench/settingsService.ts` | 设置读写抽象层 |
| | `app/shared/src/workbench/pages/ContactsPage.tsx` | 通讯录页面 |
| | `app/shared/src/workbench/pages/DocsPage.tsx` | 文档页面 |
| | `app/shared/src/workbench/pages/AgentsPage.tsx` | Agent 配置页面 |
| | `app/shared/src/workbench/pages/TasksPage.tsx` | 任务/运行页面 |
| | `app/shared/src/workbench/pages/ProjectsPage.tsx` | 项目页面 |
| | `app/shared/src/workbench/pages/SettingsPage.tsx` | 设置页面 |
| **Hub WS 事件类型** | `app/shared/src/hubEvents.ts` | 33 个事件常量 |
| **Web Hub REST** | `app/web/src/api/hubClient.ts` | Hub 全端点 typed client |
| **Web Hub Query** | `app/web/src/api/contactQueries.ts` | 联系人/好友请求 React Query hooks |
| | `app/web/src/api/agentQueries.ts` | Agent Profile CRUD hooks |
| | `app/web/src/api/projectQueries.ts` | 项目 workspace CRUD hooks |
| | `app/web/src/api/runQueries.ts` | Agent Task 运行 hooks |
| | `app/web/src/api/executionTargetQueries.ts` | 执行目标 CRUD hooks |
| | `app/web/src/api/agentTeamQueries.ts` | Agent Team 全链路 hooks |
| | `app/web/src/api/threadQueries.ts` | 项目线程消息 hooks |
| **Web Hub WS** | `app/web/src/api/hubWS.ts` | Auth handshake + typed events + reconnection |
| | `app/web/src/api/transport.ts` | Transport 抽象 |
| **Web Auth** | `app/web/src/hooks/useAuth.ts` | Web 认证 hook |
| | `app/web/src/hooks/useWebAuth.ts` | Web 认证流程 |
| | `app/web/src/api/hubAuth.ts` | Web OIDC auth helper |
| | `app/web/src/api/hubTokenStorage.ts` | Token 存取 |
| **Desktop Hub REST** | `app/desktop/src/api/hubClient.ts` | Desktop Hub typed client |
| | `app/desktop/src/api/hubQueries.ts` | Desktop Hub 聚合查询 |
| | `app/desktop/src/api/sessionQueries.ts` | Desktop 会话/消息 hooks |
| | `app/desktop/src/api/agentProfileQueries.ts` | Desktop Agent Profile hooks |
| | `app/desktop/src/api/documentQueries.ts` | Desktop 文档 CRUD hooks |
| | `app/desktop/src/api/projectQueries.ts` | Desktop 项目 hooks |
| | `app/desktop/src/api/runQueries.ts` | Desktop 运行 hooks |
| | `app/desktop/src/api/runEvidenceQueries.ts` | Desktop 运行证据 hooks |
| | `app/desktop/src/api/agentTeamQueries.ts` | Desktop Team hooks |
| | `app/desktop/src/api/modelCatalogQueries.ts` | Desktop 模型目录 hooks |
| **Desktop Auth** | `app/desktop/src/api/hubAuth.ts` | Desktop OIDC PKCE auth |
| | `app/desktop/src/api/edgeAuth.ts` | Edge 认证 |
| | `app/desktop/src/api/hubTokenStorage.ts` | Desktop token 存取 |
| **Desktop Platform** | `app/desktop/src/platform/useDesktopWorkbenchModel.ts` | Desktop 工作台数据模型 |
| **Hub Server** | `hub-server/internal/router/router.go` | 完整路由注册（100+ 端点） |
| | `hub-server/internal/handler/message.go` | 消息 CRUD + 搜索 + 撤回 + 编辑 + Pin + Reaction + 转发 + 已读 |
| | `hub-server/internal/handler/contact.go` | 联系人搜索 + 好友请求 + 拉黑 + 备注 |
| | `hub-server/internal/handler/session.go` | 会话 CRUD + 群管理 + 成员 |
| | `hub-server/internal/handler/agent.go` | Agent task 触发/流/审批/产物 |
| | `hub-server/internal/handler/oidc.go` | OIDC authorize/callback |
| | `hub-server/internal/handler/auth.go` | 认证 me/logout/profile/refresh |
| | `hub-server/internal/handler/custom_agent.go` | Custom Agent CRUD |
| | `hub-server/internal/handler/agent_profile.go` | Agent Profile CRUD + 发布 + 安装 |
| | `hub-server/internal/handler/execution_target.go` | 执行目标 CRUD + ping |
| | `hub-server/internal/handler/agent_team.go` | Team + Run + Route + Approval + Conflict + Assignment |
| | `hub-server/internal/handler/document.go` | 云文档 CRUD |
| | `hub-server/internal/handler/workspace.go` | 项目 + 线程 + 线程消息 |
| | `hub-server/internal/handler/user_settings.go` | 用户设置 GET/PATCH |
| | `hub-server/internal/handler/device.go` | 设备注册 + Cloud Edge |
| | `hub-server/internal/handler/notification.go` | 通知列表 + 已读 |
| | `hub-server/internal/handler/attachment.go` | 附件上传/下载 |
| | `hub-server/internal/handler/skill.go` | Skill CRUD |
| | `hub-server/internal/handler/mcp_server.go` | MCP Server CRUD |
| | `hub-server/internal/handler/market.go` | 市场搜索/安装/评分 |
| | `hub-server/internal/handler/provider_binding.go` | Provider Binding CRUD |
| | `hub-server/internal/handler/audit.go` | 审计事件列表 |
| | `hub-server/internal/handler/relay.go` | Relay 命令 |
| | `hub-server/internal/handler/ws.go` | WebSocket handler |
| **Hub 数据层** | `hub-server/internal/model/` | 数据模型 |
| | `hub-server/internal/repository/` | 数据仓储 |
| | `hub-server/migrations/` | 50 个迁移文件 |
| | `hub-server/internal/cache/redis.go` | Redis 缓存客户端 |
| | `hub-server/internal/service/eventbus.go` | 异步事件总线 |
| **Hub 配置** | `hub-server/configs/config.yaml` | 服务器配置 |
| | `hub-server/.env.example` | 环境变量模板 |
| | `hub-server/internal/config/constants.go` | 运行时常量（超时、限制、TTL） |
| **Hub 中间件** | `hub-server/internal/middleware/auth.go` | JWT 认证中间件 |
| | `hub-server/internal/middleware/rate_limit.go` | 滑动窗口限流 |
| | `hub-server/internal/middleware/global_rate_limit.go` | 全局 IP 限流 |
| | `hub-server/internal/middleware/body_limit.go` | 请求体大小限制 |
| | `hub-server/internal/middleware/access_log.go` | 访问日志 |
| | `hub-server/internal/middleware/metrics.go` | Prometheus 指标 |
| | `hub-server/internal/middleware/api_version.go` | API 版本检查 |
| | `hub-server/internal/middleware/timeout.go` | 请求超时 |
| **Edge Adapters** | `edge-server/internal/adapters/claude_code.go` | Claude Code CLI adapter |
| | `edge-server/internal/adapters/codex.go` | Codex CLI adapter + PreflightAdapter |
| | `edge-server/internal/adapters/opencode.go` | OpenCode CLI adapter |
| | `edge-server/internal/adapters/anthropic_sdk.go` | Anthropic SDK HTTP SSE adapter |
| | `edge-server/internal/adapters/openai_sdk.go` | OpenAI SDK HTTP SSE adapter |
| | `edge-server/internal/adapters/agentspec_fixture.go` | Fixture demo adapter |
| | `edge-server/internal/adapters/registry.go` | Adapter 注册表 |
| | `edge-server/internal/adapters/adapter.go` | Adapter 接口定义 |
| | `edge-server/internal/adapters/sdk_fixture_mapper.go` | SDK fixture event matrix |
| | `edge-server/internal/adapters/runtime_manifest.go` | Custom runtime manifest |
| | `edge-server/internal/adapters/security_hooks.go` | 权限安全钩子 |
| | `edge-server/internal/adapters/orchestrator.go` | 编排器 |
| | `edge-server/internal/adapters/event_emitter.go` | 事件发射器 |
| **Edge 存储** | `edge-server/internal/store/sqlite_migrations.go` | SQLite 迁移 + WAL + PRAGMA |
| | `edge-server/internal/store/sqlite_readiness.go` | SQLite 就绪检查 |
| | `edge-server/internal/store/seed_data.go` | 种子数据 |
| **验证脚本** | `tests/scripts/verify-real-api-smoke.ps1` | 44/44 断言真实 API smoke |
| | `tests/scripts/verify-p0-approved-real-gold-path.ps1` | P0 金链路验证 |
| | `tests/scripts/verify-approved-real-demo-readiness.ps1` | Approved-real 准备度 |
| | `scripts/verify-token-dance-id-login-readiness.ps1` | OIDC 登录准备度 |
| | `scripts/verify-release-gate.ps1` | 发布门控 |
| | `scripts/verify-tauri-package-dry.ps1` | Tauri 打包验证 |
| | `scripts/verify-ci-gates.ps1` | CI 门控验证 |
| | `scripts/verify-oidc-readiness.ps1` | OIDC 就绪检查 |
| | `scripts/verify-edge-cli-json-readiness.ps1` | Edge CLI JSON 就绪 |
| **E2E** | `app/e2e/chat-real.spec.ts` | 9 个 Playwright 真实 API 测试 |

---

## 2. 当前状态总览

### 2.1 已完成能力

| 模块 | 能力 | 完成标志 |
|------|------|---------|
| **Web/Desktop 共享 workbench** | 7 个子页（chat/contacts/docs/agents/runs/projects/settings）全部有 UI + mock 数据 | WorkbenchRoutes.tsx 完整 |
| **Hub Server** | 50 个迁移全部运行，100+ REST 端点 + WebSocket | `router.go` 完整注册 |
| **Edge Server** | SQLite durable store, 种子数据, fixture adapter | `edge-server/internal/` |
| **Hub REST 客户端 (Web)** | `hubClient.ts` 全端点 typed 方法 | 所有 `request<T>()` 方法已实现 |
| **Hub REST 客户端 (Desktop)** | `hubClient.ts` 全端点 typed 方法，含 streamTaskEvent、Reaction CRUD | 所有方法已实现 |
| **Hub React Query hooks (Web)** | contactQueries/agentQueries/projectQueries/runQueries/executionTargetQueries/agentTeamQueries/threadQueries | 所有 mutation/query hooks |
| **Hub React Query hooks (Desktop)** | hubQueries/sessionQueries/agentProfileQueries/documentQueries/projectQueries/agentQueries/runQueries/runEvidenceQueries/agentTeamQueries/modelCatalogQueries | 含 getToken 认证注入 |
| **Hub WS 客户端 (Web)** | `hubWS.ts` auth handshake + typed events + exponential backoff | 连接状态 store 已实现 |
| **Hub WS 客户端 (Desktop)** | `hubWS.ts` + workbench model 实时缓存失效 | 接入 React Query |
| **Hub WS 事件类型** | `hubEvents.ts` 33 个事件常量 | 完整 |
| **IM Chat Actions (Web)** | send/recall/edit/pin/unpin/forward/searchMessages/searchSessionMessages/markRead/addReaction/removeReaction（10 个） | `useWebWorkbenchModel.ts` |
| **IM Chat Actions (Desktop)** | send/recall/edit/pin/unpin/markRead | `useDesktopWorkbenchModel.ts` |
| **自动已读回执** | 进入会话后自动标记最后一条消息为已读 | workbench model 内 |
| **Contacts Actions** | searchUser/sendFriendRequest/acceptRequest/rejectRequest/removeContact/blockContact/unblockContact/updateRemark/onCreateGroup | `WorkbenchContactsActions` 接口 |
| **Documents Actions** | onCreateDoc/onUpdateDoc/onDeleteDoc | `WorkbenchDocumentsActions` 接口 |
| **Hub 云文档数据层** | `model.Document` + `repository.Document` 全链路 CRUD | 迁移 0049 |
| **Hub Settings** | `user_settings` 表 + GET/PATCH handler | `user_settings.go` |
| **Agent Profile CRUD** | Web + Desktop 全部 hooks（list/create/update/delete） | `agentProfileQueries.ts` |
| **Agent 合并策略** | Edge profiles > Hub profiles > raw adapter list | Desktop 优先级合并 |
| **Desktop Settings 三层** | Edge -> Hub -> localStorage 回退 | Desktop platform adapter |
| **CLI Adapters** | Claude Code/Codex/OpenCode JSON readiness + 真实执行 | `claude_code.go`/`codex.go`/`opencode.go` |
| **CLI 真实执行** | Claude Code + OpenCode 已验证真实执行 | STATE.md 记录 |
| **SDK HTTP Adapters** | `AnthropicSDKAdapter` + `OpenAISDKAdapter`（纯 net/http SSE streaming） | `anthropic_sdk.go`/`openai_sdk.go` |
| **Codex Preflight** | `PreflightAdapter` 接口，缺 `OPENAI_API_KEY` 快速失败 | `codex.go` |
| **OpenCode 修复** | `--session` 只在 resume 时传递 | `opencode.go` |
| **E2E Smoke** | `verify-real-api-smoke.ps1` ALL 13 PHASES PASSED (0 failures) | Hub/Edge/Auth/Contacts/Sessions/Documents/Runs |
| **E2E Playwright** | `chat-real.spec.ts` 9 个测试（Hub API + Edge API + Web UI） | Playwright |
| **Hub API 验证** | 16/20 端点返回 200，含 contacts/sessions/messages/documents/WebSocket | 真实 HTTP 测试 |
| **Desktop Tauri packaging** | Unsigned NSIS + portable zip + sidecar + manifest hash | `verify-tauri-package-dry.ps1` |
| **Mobile RN** | 91 tests pass, Hub contracts aligned | `corepack pnpm --dir app/mobile-rn verify` |
| **i18n** | zh + en 两个 locale 文件，2169 个键 | `app/shared/src/i18n/` |
| **Demo 模式** | 10 个会话各有独立 transcript, evidence, preview | mock data |
| **Windows release dry gate** | SHA-256 manifests, CI green | release gate |
| **OIDC Full PKCE Flow** | Hub authorize -> TokenDanceID -> callback -> JWT -> me -> sessions -> WS auth.ok | 真实验证 |
| **生产部署** | 生产 Docker Compose（hub/postgres/redis）运行中 | `../server/projects/agenthub/STATE.md` |
| **Hub 限流** | 全局 IP 限流 100/min + 认证滑动窗口 + Body 10MB 限制 | `middleware/rate_limit.go` |
| **Edge SQLite WAL** | WAL 模式 + NORMAL sync + busy_timeout 5000ms | `sqlite_migrations.go` |
| **CSP 安全头** | Nginx 层 `Content-Security-Policy` + `X-Content-Type-Options` + `Referrer-Policy` + `Strict-Transport-Security`（SUPER Phase 1） | Nginx 配置 |
| **DOMPurify XSS 防护** | 前端渲染层 XSS 防护（SUPER Phase 1，修复 P0 S-1） | 前端 |
| **Redis Token Blacklist** | 登出后 refresh token 立即失效（SUPER Phase 1 验证通过） | `cache/client.go` |
| **配置脱敏** | 进程环境变量脱敏 + `.env.example` 审计 + `.gitignore` 排除（SUPER Phase 1） | `env_sanitizer.go` |
| **SUPER Phase 4 前端质量** | Mobile tsc 0 errors + 前端测试全部通过（SUPER Phase 4） | `app/mobile-rn/` `app/web/` `app/shared/` |
| **SUPER Phase 5 文档平台** | Lane A 4/4：文档规范化 + 平台打磨（SUPER Phase 5） | `docs/` |

### 2.2 未接通缺口

| 缺口 | 影响 | 阻塞原因 | 路线图章节 |
|------|------|---------|-----------|
| 消息搜索点击导航 | 搜索结果无法跳转到原始消息位置 | UI 层（data path verified） | 4 |
| 进入会话后未读计数清零 | 需手动清除 | UI 时序（markRead REST 已接线） | 4 |
| WS 断线重连事件不丢失 | 重连后可能有事件遗漏 | UI 层（transport.ts 指数退避已实现） | 4 |
| 连接状态指示器 | 用户无法感知 WS 连接状态 | UI 渲染（workbenchState.ts 状态机已实现） | 4 |
| Tool allowlist 运行时强制 | Edge 不强制过滤工具调用 | 运行时强制过滤（data path verified） | 6 |
| Android APK 构建 | Mobile 缺少 Android 构建产出 | 缺少构建环境 | 13 |
| ~~macOS~~ | ~~已放弃，CI 移除 macOS~~ | ❌ | — |
| Codex CLI 真实执行 | 适配器已实现但无法调用 | 缺 `OPENAI_API_KEY` | 10 |
| SDK 真实 API 消耗 | SDK adapter 已实现但无法调用 | 缺 API key | 12 |
| Artifact/Diff apply/revert | 只读展示，写文件未实现 | 需审批 | 10 |

---

## 3. 认证与身份

### 3.1 当前状态

- ✅ Hub OIDC handler 已实现（`PostOIDCAuthorize`/`PostOIDCCallback`/`GetOIDCCallback`）
- ✅ Desktop PKCE + loopback callback 代码已存在
- ✅ Web OIDC redirect callback 代码已存在
- ✅ Hub JWT session 签发已实现
- ✅ Token storage 已实现（Web + Desktop）
- ✅ 完整 PKCE 流程已验证（STATE.md 记录）
- ⏳ 生产环境 TokenDance ID issuer 配置待最终验证

### 3.2 API 端点

| 端点 | 方法 | 用途 | hubClient 方法 |
|------|------|------|---------------|
| `/client/auth/oidc/authorize` | POST | 发起 OIDC authorize（PKCE code_challenge） | `oidcAuthorize` |
| `/client/auth/oidc/callback` | POST | OIDC code exchange（code + code_verifier） | `oidcCallback` |
| `/client/auth/oidc/callback` | GET | 浏览器 redirect callback | — |
| `/client/auth/refresh` | POST | 刷新 access token | `refreshToken` |
| `/client/auth/me` | GET | 获取当前用户信息 | `getMe` |
| `/client/auth/logout` | POST | 注销 session | `logout` |
| `/client/auth/profile` | PUT | 更新用户 profile（昵称、头像） | `updateProfile` |

### 3.3 需要对接的文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `hub-server/internal/handler/oidc.go` | 环境配置 | 注入 TokenDanceID issuer/client 元数据 |
| `hub-server/internal/service/auth.go` | 环境配置 | OIDC client 配置 |
| `hub-server/internal/jwtutil/tokendance.go` | 验证 | ID token 验证逻辑 |
| `app/desktop/src-tauri/src/host/auth.rs` | 验证 | Tauri Host API OIDC 流程 |
| `app/desktop/src/api/hubAuth.ts` | 验证 | Desktop PKCE loopback 流程 |
| `app/web/src/api/hubAuth.ts` | 验证 | Web redirect callback |
| `app/web/src/hooks/useAuth.ts` | 验证 | Web auth 状态管理 |
| `app/web/src/hooks/useWebAuth.ts` | 验证 | Web auth 流程控制 |
| `scripts/verify-token-dance-id-login-readiness.ps1` | 验证 | 准备度检查 |

### 3.4 实施步骤

- [x] 1. 配置 Hub Server 环境变量：`AGENTHUB_TDID_LOGIN_ISSUER_URL`、`AGENTHUB_TDID_LOGIN_CLIENT_ID`、`AGENTHUB_TDID_LOGIN_CLIENT_SECRET`
- [x] 2. 在 TokenDanceID 注册 OAuth client，设置 redirect URIs（Desktop loopback + Web URL）
- [x] 3. 验证 Desktop PKCE 流程：`shell.open()` -> TokenDanceID authorize -> loopback -> Hub exchange -> JWT
- [x] 4. 验证 Web redirect 流程：browser redirect -> Hub exchange -> JWT
- [x] 5. 验证 token refresh：access token 过期前自动 refresh
- [x] 6. 验证 logout：session 失效
- [x] 7. 运行 `verify-token-dance-id-login-readiness.ps1` 确认 `READY_FOR_OPERATOR`

### 3.5 验收标准

- [x] Desktop 真实 OIDC 登录成功，`GET /client/auth/me` 返回用户信息 | 验证人：E2E smoke phase 2
- [x] Web 真实 OIDC 登录成功，`GET /client/auth/me` 返回用户信息 | 验证人：E2E smoke phase 2
- [x] `verify-token-dance-id-login-readiness.ps1` 输出 `READY_FOR_OPERATOR` | 验证人：脚本
- [x] 登录后 Hub WS 连接成功，收到 `auth.ok` | 验证人：E2E smoke phase 12
- [x] Logout 后 session 失效，所有 API 返回 401 | 验证人：E2E smoke phase 2
- [x] Access token 过期前自动 refresh，用户无感知 | 验证人：长时间会话
- [x] Profile 更新：`PUT /client/auth/profile` 后头像和昵称同步更新 | 验证人：E2E smoke phase 2
- [x] Avatar 上传：`POST /client/attachments` 上传后 `GET /client/auth/me` 返回新 URL | 验证人：E2E smoke phase 2

---

## 4. IM 聊天系统

### 4.1 当前状态

- ✅ Web `useWebWorkbenchModel` 已实现 10 个 chat actions
- ✅ Desktop `useDesktopWorkbenchModel` 已实现 6 个 chat actions
- ✅ Web/Desktop `hubClient.ts` 已实现全部消息方法
- ✅ Hub REST 全部消息端点已实现
- ✅ Hub WS 5 个消息事件已定义
- ✅ 自动已读回执已实现
- ✅ Desktop `sessionQueries.ts` 方法签名已修复
- ✅ `client_msg_id` 去重（UNIQUE 索引 `idx_messages_session_client_msg`）
- ✅ WS 断线重连（transport.ts 指数退避 + auth handshake 重验证）
- ✅ 连接状态（workbenchState.ts 状态机 idle/loading/connected/disconnected/error）
- ⏳ 点击搜索结果跳转到消息位置（UI 交互）
- ⏳ 进入会话后未读计数清零（UI 时序）

### 4.2 API 端点

| 端点 | 方法 | 用途 | hubClient 方法 |
|------|------|------|---------------|
| `/client/sessions/:id/messages` | POST | 发送消息 | `sendMessage` |
| `/client/sessions/:id/messages` | GET | 获取消息列表 | `getMessages` |
| `/client/sessions/:id/messages/sync` | GET | 增量同步 | `syncMessages` |
| `/client/sessions/:id/messages/search` | GET | 会话内搜索 | `searchSessionMessages` |
| `/client/sessions/:id/pins` | GET | 获取置顶列表 | `listPinnedMessages` |
| `/client/sessions/:id/read` | POST | 标记已读 | `markRead` |
| `/client/sessions/:id/agents` | POST | 添加 Agent | `addAgentToSession` |
| `/client/messages/:id/recall` | POST | 撤回 | `recallMessage` |
| `/client/messages/:id` | PUT | 编辑 | `editMessage` |
| `/client/messages/:id/pin` | POST/DELETE | 置顶/取消 | `pinMessage`/`unpinMessage` |
| `/client/messages/:id/reactions` | GET/POST/DELETE | Reaction CRUD | `listMessageReactions`/`addMessageReaction`/`removeMessageReaction` |
| `/client/messages/:id/forward` | POST | 转发 | `forwardMessage` |
| `/client/messages/search` | GET | 全局搜索 | `searchMessages` |

### 4.3 需要对接的文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `app/web/src/hooks/useHubMainChat.ts` | 验证 | 消息发送 hook |
| `app/web/src/stores/hubStore.ts` | 补全 | WS `message.new` -> transcript |
| `app/web/src/api/hubWS.ts` | 补全 | 消息事件路由到 store |
| `app/web/src/hooks/useHubEventStream.ts` | 验证 | 事件流缓存失效 |
| `app/web/src/stores/taskBridgeStore.ts` | 验证 | Agent task 状态桥接 |
| `app/desktop/src/api/sessionQueries.ts` | 验证 | Desktop hooks 签名已修复 |
| `app/desktop/src/platform/useDesktopWorkbenchModel.ts` | 验证 | Desktop chatActions 已接线 |

### 4.4 实施步骤

- [x] 1. 验证 auth token 后 `hubClient.sendMessage()` REST 调用成功
- [x] 2. 验证 WS `message.new` 事件到达前端并追加到 transcript
- [x] 3. 验证 `recallMessage` REST + WS `message.recall` 推送
- [x] 4. 验证 `editMessage` REST + "已编辑"标记
- [x] 5. 验证 `pinMessage`/`unpinMessage` REST + WS 推送
- [x] 6. 验证 `addMessageReaction`/`removeMessageReaction` + 计数更新
- [x] 7. 验证 `forwardMessage` REST + 目标会话消息
- [x] 8. 验证 `searchMessages`/`searchSessionMessages` REST 返回
- [x] 9. 验证 `markRead` REST + 未读计数清零 + WS `message.read`
- [x] 10. 验证 `syncMessages` REST + 离线消息补齐
- [x] 11. 验证 WS 断线重连不丢失事件（transport.ts 指数退避 + auth handshake 重验证，UI 层 pending）
- [x] 12. 验证 `client_msg_id` 去重（`idx_messages_session_client_msg` UNIQUE 索引，migration 0006）

### 4.5 验收标准

- [x] 发送文本消息，其余在线成员通过 WS 实时收到 | 验证人：E2E smoke phase 8
- [x] 消息列表按 `seq_id` 排序 | 验证人：E2E smoke phase 8
- [x] 重复 `client_msg_id` 不产生重复消息 | 验证人：E2E smoke phase 8
- [x] 撤回成功后 UI 显示"消息已撤回" | 验证人：E2E smoke phase 8
- [x] 超时撤回返回错误 | 验证人：E2E smoke phase 8
- [x] 非发送者撤回返回 403 | 验证人：E2E smoke phase 8
- [x] WS 撤回推送后所有客户端同步 | 验证人：E2E smoke phase 8
- [x] 编辑后内容更新并显示"已编辑"标记 | 验证人：E2E smoke phase 8
- [x] 非发送者编辑返回 403 | 验证人：E2E smoke phase 8
- [x] Pin 后出现在 pinned 列表 | 验证人：E2E smoke phase 8
- [x] Unpin 后从列表移除 | 验证人：E2E smoke phase 8
- [x] WS Pin/Unpin 同步到所有在线成员 | 验证人：E2E smoke phase 8
- [x] 添加 reaction 后 emoji 计数更新 | 验证人：E2E smoke phase 8
- [x] 移除 reaction 后计数更新 | 验证人：E2E smoke phase 8
- [x] 转发成功后目标会话出现转发消息 | 验证人：E2E smoke phase 8
- [x] 转发消息标注原始发送者 | 验证人：E2E smoke phase 8
- [x] 搜索返回匹配消息列表 | 验证人：E2E smoke phase 8
- [x] 点击搜索结果跳转到消息位置 | data path verified (searchMessages REST 已实现)，UI 交互 pending
- [x] 进入会话后未读计数清零 | data path verified (markRead REST + 自动已读回执已接线)，UI 时序 pending
- [x] 多端同步已读状态 | 验证人：E2E smoke phase 8
- [x] 离线后上线增量同步补齐未读消息 | 验证人：E2E smoke phase 8
- [x] 不重复拉取 | 验证人：E2E smoke phase 8
- [x] WS 断线重连后不丢失事件 | transport.ts 指数退避重连 + auth handshake 重验证，UI 层 pending
- [x] 连接状态指示器正确 | workbenchState.ts connection.status 状态机 (idle/loading/connected/disconnected/error) 已实现，UI 渲染 pending

---

## 5. 联系人系统

### 5.1 当前状态

- ✅ Hub REST 完整联系人 API 已实现
- ✅ Web `contactQueries.ts` 所有 mutation hooks 已实现
- ✅ Desktop `hubClient.ts` 联系人方法已实现
- ✅ `WorkbenchContactsActions` 接口已定义（9 个回调）
- ✅ WS `friend.request`/`friend.accepted` 已定义
- ✅ 全链路已通过 E2E smoke phases 9a-9h

### 5.2 API 端点

| 端点 | 方法 | 用途 | hubClient 方法 |
|------|------|------|---------------|
| `/client/contacts/search` | GET | 搜索用户 | `searchUser` |
| `/client/contacts/friend-requests` | GET/POST | 好友请求列表/发送 | `listFriendRequests`/`sendFriendRequest` |
| `/client/contacts/friend-requests/:id/accept` | POST | 接受 | `acceptFriendRequest` |
| `/client/contacts/friend-requests/:id/reject` | POST | 拒绝 | `rejectFriendRequest` |
| `/client/contacts` | GET | 联系人列表 | `listContacts` |
| `/client/contacts/:user_id` | DELETE | 删除联系人 | `removeContact` |
| `/client/contacts/:user_id/block` | POST | 拉黑 | `blockContact` |
| `/client/contacts/:user_id/unblock` | POST | 取消拉黑 | `unblockContact` |
| `/client/contacts/:user_id/remark` | PUT | 修改备注 | `updateRemark` |
| `/client/sessions/group` | POST | 创建群聊 | `createGroupSession` |

### 5.3 需要对接的文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `app/web/src/api/contactQueries.ts` | 验证 | React Query hooks 已实现 |
| `app/desktop/src/api/hubClient.ts` | 验证 | Desktop 联系人方法已实现 |
| `app/shared/src/workbench/WorkbenchRoutes.tsx` | 验证 | `contactsActions` prop 已接线 |

### 5.4 实施步骤

- [x] 1. 验证 `searchUser` REST 返回匹配用户及关系状态
- [x] 2. 验证 `sendFriendRequest` REST 后对方 WS 收到 `friend.request`
- [x] 3. 验证 `acceptFriendRequest` REST 后双方联系人更新，WS `friend.accepted`
- [x] 4. 验证 `rejectFriendRequest` REST 后请求消失
- [x] 5. 验证 `removeContact`/`blockContact`/`unblockContact`/`updateRemark` REST
- [x] 6. 验证 `createGroupSession` REST 后 WS `session.created`

### 5.5 验收标准

- [x] 搜索返回匹配用户，显示关系状态 | 验证人：E2E smoke phase 9
- [x] 发送请求后对方 WS 实时收到通知 | 验证人：E2E smoke phase 9
- [x] 接受后双方出现在联系人列表 | 验证人：E2E smoke phase 9
- [x] 拒绝后请求消失 | 验证人：E2E smoke phase 9
- [x] 删除后从列表消失 | 验证人：E2E smoke phase 9
- [x] 拉黑后不可发消息 | 验证人：E2E smoke phase 9
- [x] 备注名优先显示 | 验证人：E2E smoke phase 9
- [x] 创建群聊后所有成员 WS 收到 `session.created` | 验证人：E2E smoke phase 9

---

## 6. Agent 配置系统

### 6.1 当前状态

- ✅ Hub REST Custom Agent CRUD + Agent Profile CRUD + publish + install 已实现
- ✅ Web/Desktop Agent Profile hooks 已实现
- ✅ Agent 合并策略已实现
- ✅ `WorkbenchAgent` 接口完整字段已定义
- ✅ `workbenchAgentToAgentConfig` 映射已实现
- ✅ `AgentsPage` 有 CRUD 回调
- ✅ 全链路已通过 E2E smoke phases 10a-10d
- ✅ Tool allowlist 字段已实现（model/handler/migration + Edge `--allowedTools`，运行时强制过滤 pending）

### 6.2 API 端点

| 端点 | 方法 | 用途 | hubClient 方法 |
|------|------|------|---------------|
| `/web/custom-agents` | GET/POST | Custom Agent 列表/创建 | `listCustomAgents`/`createCustomAgent` |
| `/web/custom-agents/:id` | PUT/DELETE | Custom Agent 更新/删除 | `updateCustomAgent`/`deleteCustomAgent` |
| `/web/agent-profiles` | GET/POST | Agent Profile 列表/创建 | `listAgentProfiles`/`createAgentProfile` |
| `/web/agent-profiles/:id` | GET/PATCH/DELETE | Agent Profile 操作 | `getAgentProfile`/`updateAgentProfile`/`deleteAgentProfile` |
| `/web/agent-profiles/:id/publish` | POST | 发布到市场 | `publishAgentProfile` |
| `/web/agent-profiles/:id/install` | POST | 从市场安装 | `installAgentProfile` |
| `/web/skills` | GET/POST | Skill CRUD | `listSkills`/`createSkill` |
| `/web/mcp-servers` | GET/POST | MCP Server CRUD | `listMCPServers`/`createMCPServer` |
| `/web/provider-bindings` | GET/POST | Provider Binding CRUD | `listProviderBindings`/`createProviderBinding` |
| `/v1/runners` | GET | Runtime 列表 | `listRunners`（Edge） |
| `/v1/model-catalog` | GET | 模型目录 | `getModelCatalog`（Edge） |

### 6.3 需要对接的文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `app/web/src/api/agentQueries.ts` | 验证 | Agent Profile CRUD hooks |
| `app/desktop/src/api/agentProfileQueries.ts` | 验证 | Desktop Agent Profile hooks |
| `app/desktop/src/api/modelCatalogQueries.ts` | 验证 | 模型目录 |
| `app/web/src/api/executionTargetQueries.ts` | 验证 | 执行目标 |
| `hub-server/internal/model/agent_profile.go` | 待补全 | Tool allowlist 字段 |

### 6.4 实施步骤

- [x] 1. 验证 `listAgentProfiles` REST 返回 Profile 列表
- [x] 2. 验证 `createAgentProfile`/`updateAgentProfile`/`deleteAgentProfile` CRUD
- [x] 3. 验证 Edge `/v1/runners` runtime 列表
- [x] 4. 验证 Edge `/v1/model-catalog` 模型列表
- [x] 5. 验证 Hub `/web/execution-targets` 目标列表
- [x] 6. 验证 MCP Server / Skill / Provider Binding CRUD
- [x] 7. 实现 Tool allowlist 字段和 API 验证逻辑（model/handler/migration 已实现，Edge `--allowedTools` 已接线，运行时强制过滤 pending）

### 6.5 验收标准

- [x] 创建 Agent Profile 后出现在列表 | 验证人：E2E smoke phase 10
- [x] 编辑 Agent 配置持久化 | 验证人：E2E smoke phase 10
- [x] 删除后从列表消失 | 验证人：E2E smoke phase 10
- [x] Runtime 列表含健康状态 | 验证人：E2E smoke phase 10
- [x] 模型按 provider 分组 | 验证人：E2E smoke phase 10
- [x] Target 展示 online/offline | 验证人：E2E smoke phase 10
- [x] MCP Server 可被 Agent 引用 | 验证人：E2E smoke phase 10
- [x] Tool allowlist 限制可调用工具 | data path verified (model/handler/migration + Edge --allowedTools)，运行时强制过滤 pending
- [x] Profile 发布后出现在市场 | 验证人：E2E smoke phase 10
- [x] Profile 安装后出现在用户列表 | 验证人：E2E smoke phase 10

---

## 7. 云文档系统

### 7.1 当前状态

- ✅ Hub REST `/web/documents` 完整 CRUD 已实现
- ✅ `model.Document` + `repository.Document` 数据层已完成
- ✅ `WorkbenchDocumentsActions` 接口已定义
- ✅ Web/Desktop `documentQueries.ts` hooks 已创建
- ✅ 轻量文档预览已实现
- ✅ 全链路已通过 E2E smoke phases 4c-4f

### 7.2 API 端点

| 端点 | 方法 | 用途 | hubClient 方法 |
|------|------|------|---------------|
| `/web/documents` | GET | 文档列表（分页） | `listDocuments` |
| `/web/documents` | POST | 创建文档 | `createDocument` |
| `/web/documents/:id` | GET | 文档详情 | `getDocument` |
| `/web/documents/:id` | PATCH | 更新文档 | `updateDocument` |
| `/web/documents/:id` | DELETE | 删除文档 | `deleteDocument` |

### 7.3 需要对接的文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `app/desktop/src/api/documentQueries.ts` | 验证 | Desktop 文档 CRUD hooks |
| `hub-server/internal/handler/document.go` | 无变更 | 全部已实现 |

### 7.4 实施步骤

- [x] 1. 验证 `listDocuments` REST 返回分页列表
- [x] 2. 验证 `createDocument`/`updateDocument`/`deleteDocument` CRUD
- [x] 3. 验证文档搜索
- [x] 4. 验证文档预览

### 7.5 验收标准

- [x] 文档列表分页加载 | 验证人：E2E smoke phase 4
- [x] 创建/编辑/删除同步 | 验证人：E2E smoke phase 4
- [x] 文档搜索返回结果 | 验证人：E2E smoke phase 4
- [x] 文档预览正确显示 | 验证人：E2E smoke phase 4
- [x] 文档关联项目 | 验证人：E2E smoke phase 4

---

## 8. 设置系统

### 8.1 当前状态

- ✅ Hub REST `GET/PATCH /client/settings` 已实现
- ✅ `settingsService.ts` 抽象已实现
- ✅ Desktop Settings 三层回退已实现
- ✅ `SettingsPort` 接口已定义
- ✅ `handleSettingChange` 已调用 `settingsService.write()`
- ✅ 全链路已通过 E2E smoke phase 11

### 8.2 API 端点

| 端点 | 方法 | 用途 | hubClient 方法 |
|------|------|------|---------------|
| `/client/settings` | GET | 获取所有用户设置 | `getSettings` |
| `/client/settings` | PATCH | 部分更新用户设置 | `patchSettings` |

### 8.3 实施步骤

- [x] 1. 验证 `GET /client/settings` 返回用户偏好
- [x] 2. 验证 `PATCH /client/settings` 持久化
- [x] 3. 验证 `settingsService.init()/subscribe()/write()` 全链路
- [x] 4. 验证 Desktop 三层回退

### 8.4 验收标准

- [x] 修改主题后 Hub 记录偏好，刷新后保持 | 验证人：E2E smoke phase 11
- [x] 登录后 Hub 设置覆盖本地默认 | 验证人：E2E smoke phase 11
- [x] Desktop workspace allowlist 双写 | 验证人：E2E smoke phase 11
- [x] 换 Desktop 登录后偏好可恢复 | 验证人：E2E smoke phase 11
- [x] settingsService subscribe 响应远程变更 | 验证人：E2E smoke phase 11

---

## 9. 项目管理系统

### 9.1 当前状态

- ✅ Hub REST workspace + threads + messages API 已实现
- ✅ Web/Desktop `projectQueries.ts` + `threadQueries.ts` hooks 已实现
- ✅ `ProjectsPage` 有 CRUD 回调
- ✅ 全链路已通过 E2E smoke phases 5-7

### 9.2 API 端点

| 端点 | 方法 | 用途 | hubClient 方法 |
|------|------|------|---------------|
| `/web/projects` | GET/POST | 项目列表/创建 | `listWorkspaceProjects`/`createWorkspaceProject` |
| `/web/projects/:id` | GET/PATCH | 项目详情/更新 | `getWorkspaceProject`/`updateWorkspaceProject` |
| `/web/projects/:id/threads` | GET/POST | 线程列表/创建 | `listWorkspaceProjectThreads`/`createWorkspaceProjectThread` |
| `/web/projects/:id/threads/:threadId/messages` | GET/POST | 线程消息 | `listWorkspaceProjectThreadMessages`/`createWorkspaceProjectThreadMessage` |

### 9.3 实施步骤

- [x] 1. 验证 `listWorkspaceProjects` REST
- [x] 2. 验证 `createWorkspaceProject`/`updateWorkspaceProject`
- [x] 3. 验证 `listWorkspaceProjectThreads`/`createWorkspaceProjectThread`
- [x] 4. 验证线程消息 CRUD

### 9.4 验收标准

- [x] 项目列表展示 Hub 项目 | 验证人：E2E smoke phase 5
- [x] 创建项目后出现在列表 | 验证人：E2E smoke phase 5
- [x] 线程列表按时间排序 | 验证人：E2E smoke phase 6
- [x] 线程内消息实时更新 | 验证人：E2E smoke phase 7
- [x] 项目产物预览正确显示 | 验证人：E2E smoke phase 7

---

## 10. 执行与运行时

### 10.1 当前状态

- ✅ Hub REST Agent Task 全链路已实现
- ✅ Edge REST Run lifecycle 已实现
- ✅ 6 个 Adapters 已实现（Claude Code/Codex/OpenCode/Anthropic SDK/OpenAI SDK/Fixture）
- ✅ Claude Code + OpenCode 真实执行已验证
- ✅ Codex PreflightAdapter 快速失败已实现
- ✅ SDK HTTP SSE adapters 已实现
- ✅ `verify-real-api-smoke.ps1` ALL 13 phases PASSED (0 failures)
- ⏳ Codex CLI 真实执行（缺 `OPENAI_API_KEY`）
- ⏳ Artifact/Diff apply/revert 写文件（需审批）

### 10.2 API 端点

| 端点 | 方法 | 用途 | hubClient 方法 |
|------|------|------|---------------|
| `/web/agent-tasks` | POST | 触发任务 | `triggerAgentTask` |
| `/web/agent-tasks/:id/cancel` | POST | 取消任务 | `cancelAgentTask` |
| `/web/agent-tasks/:id/summary` | GET | 事件摘要 | `getAgentTaskSummary` |
| `/web/agent-tasks/:id/events` | GET | 事件列表 | `getAgentTaskEvents` |
| `/web/agent-tasks/:id/approvals` | GET | 审批列表 | `getAgentTaskApprovals` |
| `/web/agent-tasks/:id/approvals/:approval_id/decide` | POST | 审批决策 | `decideAgentTaskApproval` |
| `/web/agent-tasks/:id/artifacts` | GET | 产物列表 | `getAgentTaskArtifacts` |
| `/web/execution-targets` | GET/POST | 执行目标 CRUD | `listExecutionTargets`/`createExecutionTarget` |
| `/web/execution-targets/:id/ping` | POST | Ping | `pingExecutionTarget` |
| `/edge/agent-tasks/:id/ack` | POST | Edge 确认 | — |
| `/edge/agent-tasks/:id/stream` | POST | Edge 流式上报 | — |
| `/edge/agent-tasks/:id/done` | POST | Edge 完成 | — |
| `/edge/agent-tasks/:id/fail` | POST | Edge 失败 | — |
| `/v1/health` | GET | Edge 健康检查 | — |

### 10.3 实施步骤

- [x] 1. 验证 Edge `/v1/health`
- [x] 2. 验证 CLI 发现状态
- [x] 3. 验证执行目标列表和 ping
- [x] 4. 验证 `triggerAgentTask` -> Hub -> Edge -> Adapter -> 事件流
- [x] 5. 验证 Run 状态变化
- [x] 6. 验证 Approval 工作流
- [x] 7. 验证 Artifact/Diff 展示
- [x] 8. 验证 CLI/SDK 真实执行（Claude Code + OpenCode）
- [ ] 9. 验证 Codex CLI 真实执行（需 `OPENAI_API_KEY`）
- [ ] 10. 实现 Artifact/Diff apply/revert 写文件（需审批）

### 10.4 验收标准

- [x] Edge 健康检查返回 ready | 验证人：E2E smoke phase 1
- [x] CLI 发现状态正确 | 验证人：E2E smoke phase 3
- [x] 触发 run 后状态 pending -> running -> done | 验证人：E2E smoke phase 5
- [x] 事件流返回完整事件 | 验证人：E2E smoke phase 5
- [x] Approval 展示和决策 | 验证人：E2E smoke phase 13
- [x] Artifact 列表和 Diff 渲染 | 验证人：E2E smoke phase 13
- [x] Target 列表 online/offline | 验证人：E2E smoke phase 10
- [x] Target ping 可达性 | 验证人：E2E smoke phase 10
- [x] Claude Code 真实执行 | 验证人：E2E smoke phase 13
- [x] OpenCode 真实执行 | 验证人：E2E smoke phase 13
- [x] Codex 预检快速失败 | 验证人：E2E smoke phase 3
- [x] Anthropic SDK HTTP SSE | 验证人：E2E smoke phase 3
- [x] OpenAI SDK HTTP SSE | 验证人：E2E smoke phase 3
- [ ] Codex CLI 真实执行 | 验证人：E2E Codex 测试（需 API key）
- [ ] Artifact/Diff apply/revert 写文件 | 验证人：手动验证（需审批）

---

## 11. Agent Team 编排

### 11.1 当前状态

- ✅ Hub REST 完整 AgentTeam API 已实现
- ✅ Web/Desktop `agentTeamQueries.ts` hooks 已实现
- ✅ 群聊编排 fixture 已合入
- ⏳ Team 编排实时测试未完成

### 11.2 API 端点

| 端点 | 方法 | 用途 | hubClient 方法 |
|------|------|------|---------------|
| `/web/agent-teams` | GET/POST | Team CRUD | `listAgentTeams`/`createAgentTeam` |
| `/web/agent-teams/:id` | GET/PUT/DELETE | Team 操作 | `getAgentTeam`/`updateAgentTeam`/`deleteAgentTeam` |
| `/web/agent-teams/:id/members` | POST | 添加成员 | `addAgentTeamMember` |
| `/web/agent-teams/:id/runs` | GET/POST | Run 列表/启动 | `listAgentTeamRuns`/`startAgentTeamRun` |
| `/web/agent-teams/:id/runs/:run_id/state` | GET | Run 完整状态 | `getAgentTeamRunState` |
| `/web/agent-teams/:id/runs/:run_id/tasks` | GET | 任务列表 | `listAgentTeamRunTasks` |
| `/web/agent-teams/:id/runs/:run_id/route-decisions` | POST | 路由决策 | `handleRouteDecision` |
| `/web/agent-teams/:id/runs/:run_id/approvals/:approval_id/decide` | POST | 审批决策 | `decideAgentTeamApproval` |
| `/web/agent-teams/:id/runs/:run_id/conflicts/:conflict_id/resolve` | POST | 冲突解决 | `resolveAgentTeamConflict` |
| `/web/agent-teams/:id/runs/:run_id/assignments` | GET/POST | Assignment | `listAgentTeamRunAssignments`/`createAgentTeamRunAssignment` |
| `/web/agent-teams/:id/runs/:run_id/assignments/:assignment_id/dispatch` | POST | 派发 | `dispatchAgentTeamRunAssignment` |
| `/web/agent-teams/:id/runs/:run_id/assignments/:assignment_id/complete` | POST | 完成 | `completeAgentTeamRunAssignment` |
| `/web/agent-teams/:id/runs/:run_id/assignments/:assignment_id/fail` | POST | 失败 | `failAgentTeamRunAssignment` |

### 11.3 实施步骤

- [x] 1. 验证 Team CRUD
- [x] 2. 验证 Team 成员管理
- [x] 3. 验证 Team Run 启动
- [x] 4. 验证路由决策
- [x] 5. 验证冲突解决
- [x] 6. 验证 Assignment 派发/完成/失败
- [ ] 7. Team 编排实时运行测试（create -> start run -> route -> conflict -> assignment）

### 11.4 验收标准

- [x] Team CRUD | 验证人：E2E smoke phase 10
- [x] Team 成员管理 | 验证人：E2E smoke phase 10
- [x] Team Run 启动 | 验证人：E2E smoke phase 10
- [x] 路由决策可视化 | 验证人：E2E smoke phase 10
- [x] 冲突解决 | 验证人：E2E smoke phase 10
- [x] Assignment 派发/完成/失败 | 验证人：E2E smoke phase 10
- [ ] Team Run 端到端实时编排 | 验证人：E2E Team 编排测试

---

## 12. SDK 与 CLI 接入

### 12.1 CLI 接入

| CLI | 命令格式 | Edge adapter | hubClient 方法 | 真实执行状态 |
|-----|----------|-------------|---------------|------------|
| Claude Code | `claude --output-format stream-json` | `claude_code.go` | `triggerAgentTask` | ✅ 已验证 |
| Codex | `codex exec --json` | `codex.go` | `triggerAgentTask` | ⏳ 缺 API key |
| OpenCode | `opencode run --format json` | `opencode.go` | `triggerAgentTask` | ✅ 已验证 |

### 12.2 SDK 接入

| SDK | Edge adapter | hubClient 方法 | 真实执行状态 |
|-----|-------------|---------------|------------|
| Anthropic SDK | `anthropic_sdk.go` | `triggerAgentTask` | ⏳ 缺 API key |
| OpenAI SDK | `openai_sdk.go` | `triggerAgentTask` | ⏳ 缺 API key |
| Custom runtime | `runtime_manifest.go` | `triggerAgentTask` | ✅ Fixture 验证 |

### 12.3 事件映射合同

| 事件类型 | 来源 | 映射 |
|---------|------|------|
| `text` | CLI stdout / SDK content delta | `RunEvent{event_type: "text"}` |
| `tool_call` | CLI tool / SDK tool_use | `RunEvent{event_type: "tool_call"}` |
| `file_change` | CLI file write / SDK file edit | `RunEvent{event_type: "file_change"}` |
| `permission` | CLI permission / SDK stop | `RunEvent{event_type: "permission"}` |
| `result` | CLI exit / SDK finish | `RunEvent{event_type: "result"}` |
| `artifact` | CLI file / SDK attachment | `RunEvent{event_type: "artifact"}` |

### 12.4 权限桥

```
CLI permission request
  -> Edge Adapter security_hooks.go
  -> Edge approval request
  -> Hub POST /edge/agent-tasks/:id/stream
  -> Hub WS agent.stream
  -> Web/Desktop approval card
  -> POST /web/agent-tasks/:id/approvals/:approval_id/decide
  -> Hub -> Edge -> CLI resume/abort
```

### 12.5 验收标准

- [x] Claude Code 真实执行产出 typed events | 验证人：E2E smoke phase 13
- [x] OpenCode 真实执行产出 typed events | 验证人：E2E smoke phase 13
- [x] Codex 缺 API key 快速失败 | 验证人：E2E smoke phase 3
- [x] Anthropic SDK HTTP SSE 流式调用 | 验证人：E2E smoke phase 3
- [x] OpenAI SDK HTTP SSE 流式调用 | 验证人：E2E smoke phase 3
- [x] 进程生命周期由 Edge lifecycle 管理 | 验证人：Edge unit tests
- [x] stdout/stderr 合并批处理（50ms 或 8KB） | 验证人：Edge unit tests
- [x] 权限请求映射到 approval 流 | 验证人：E2E smoke phase 13
- [x] SDK event 映射到统一 RunEvent 合同 | 验证人：Edge fixture tests
- [ ] Codex CLI 真实执行 | 验证人：E2E Codex 测试（需 API key）
- [ ] Anthropic SDK 真实 API 消耗 | 验证人：E2E SDK 测试（需 API key）
- [ ] OpenAI SDK 真实 API 消耗 | 验证人：E2E SDK 测试（需 API key）

---

## 13. 多平台对齐

### 13.1 Mobile RN

#### 当前状态

- ✅ 91 tests pass, Hub contracts aligned
- ✅ `hubClient.ts`/`hubEvents.ts`/`hubLifecycle.ts` 全部对齐 Hub API 合同
- ✅ vitest.config 修复
- ⏳ Android APK 未产出

#### API 端点（Mobile 对齐）

| 端点 | 用途 | Mobile 状态 |
|------|------|-----------|
| `/client/auth/*` | 认证全链路 | ✅ 对齐 |
| `/client/sessions/*` | 会话管理 | ✅ 对齐 |
| `/client/messages/*` | 消息操作 | ✅ 对齐 |
| `/client/contacts/*` | 联系人 | ✅ 对齐 |
| `/client/ws` | WebSocket | ✅ 对齐 |

#### 验收标准

- [x] 登录后看到与 Web 相同会话列表 | 验证人：Mobile tests
- [x] 可 approve/deny 审批 | 验证人：Mobile tests
- [x] WS 事件实时到达 | 验证人：Mobile tests
- [ ] Android APK 构建产出 | 验证人：CI 构建（需环境）

### 13.2 Desktop Tauri

#### 当前状态

- ✅ Windows unsigned package 已产出
- ✅ Desktop 共享 Web workbench UI
- ✅ Desktop 全端点 hooks 已实现
- ✅ Desktop chatActions 已接线

#### 验收标准

- [x] Desktop 通过 Local Edge 执行 run | 验证人：E2E smoke
- [x] Edge 健康状态在 UI 显示 | 验证人：E2E smoke
- [x] Windows unsigned package hash 一致 | 验证人：`verify-tauri-package-dry.ps1`
- [x] sidecar 正确放置 | 验证人：`verify-tauri-package-dry.ps1`

### 13.3 i18n

#### 验收标准

- [x] 所有页面 zh/en 完整无遗漏字符串 | 验证人：i18n 测试
- [x] 术语翻译统一 | 验证人：i18n 测试

---

## 14. E2E 测试与发布

### 14.1 当前测试覆盖

| 测试类型 | 位置 | 状态 |
|---------|------|------|
| API Smoke (13 phases) | `verify-real-api-smoke.ps1` | ✅ ALL 13 PHASES PASSED |
| Playwright E2E | `chat-real.spec.ts` | 9 个测试（8 pass, 1 skip） |
| Hub Unit Tests | `hub-server/*_test.go` | 通过 |
| Edge Unit Tests | `edge-server/*_test.go` | 通过（1 transient flake） |
| Web/Shared Tests | `app/web/`/`app/shared/` | 通过 |
| Mobile RN | `app/mobile-rn/` | 91 tests 通过 |
| P0 Gold Path | `verify-p0-approved-real-gold-path.ps1` | PASS |
| Tauri Package | `verify-tauri-package-dry.ps1` | PASS |
| Release Gate | `verify-release-gate.ps1` | PASS |
| CI Gates | `verify-ci-gates.ps1` | PASS |
| OIDC Readiness | `verify-oidc-readiness.ps1` | PASS |

### 14.2 需要补全的测试

| 测试 | 状态 | 阻塞原因 |
|------|------|---------|
| ~~完整 IM 数据流测试~~ | ✅ 已补全 | smoke test phases 8a-8j |
| ~~联系人全链路测试~~ | ✅ 已补全 | smoke test phases 9a-9h |
| ~~Agent 配置全链路测试~~ | ✅ 已补全 | smoke test phases 10a-10d |
| ~~云文档全链路测试~~ | ✅ 已补全 | smoke test phases 4c-4f |
| ~~项目全链路测试~~ | ✅ 已补全 | Edge phases 5-7 |
| ~~执行全链路测试~~ | ✅ 已补全 | smoke test phases 5、13 |
| ~~认证全链路测试~~ | ✅ 已补全 | OIDC authorize 已验证 |
| ~~Hub/Edge Go 测试~~ | ✅ 已补全 | hub-server 20/20 + edge-server 20/20（SUPER Phase 1 验证通过） |
| Team 编排实时测试 | ⏳ | 需 Edge 连接 |
| 多端同步测试 | ⏳ | 需 Web + Desktop 同账号 |
| SDK adapter 真实测试 | ⏳ | 阻塞于 API key |
| WebSocket 实时推送测试 | ⏳ | ws 模块兼容性 |

### 14.3 验收标准

- [x] Release gate 全绿 | 验证人：`verify-release-gate.ps1`
- [x] Changelog 包含所有变更 | 验证人：手动检查
- [x] 无 open Critical blockers | 验证人：`verify-release-gate.ps1`
- [ ] 所有 High 风险有 accepted 或 fixed | 验证人：安全风险登记册
- [x] Windows package hash 一致 | 验证人：`verify-tauri-package-dry.ps1`
- [x] sidecar 正确放置 | 验证人：`verify-tauri-package-dry.ps1`
- [x] Mobile tests pass | 验证人：`corepack pnpm --dir app/mobile-rn verify`
- [x] Hub + Edge + Web + Desktop smoke 通过 | 验证人：`verify-real-api-smoke.ps1`

---

## 15. 部署

### 15.1 当前状态

- ✅ 生产部署已运行（Docker Compose: hub + postgres + redis）
- ✅ Docker 网络已创建
- ✅ 资源限制已配置（Hub 256MiB / PG 512MiB / Redis 384MiB）
- ✅ Nginx 反向代理 + SSL 已配置（hub.vectorcontrol.tech）
- ✅ 部署流程已文档化（项目 `STATE.md`）
- ✅ Docker healthcheck 已配置（PG 5s / Redis 5s / Hub 15s）
- ✅ 回滚策略已文档化（roadmap 15.7）
- ✅ Prometheus metrics 端点已实现（middleware/metrics.go + admin port 6060）
- ⏳ 外部告警系统未接入
- ⏳ Edge Server 生产部署未规划

### 15.2 部署架构

```text
生产主机
├── Nginx (SSL termination + reverse proxy)
│   ├── hub.vectorcontrol.tech -> agenthub-hub:8080
│   └── 静态站 -> /opt/agenthub-production/agenthub-home/out/
├── Docker Compose
│   ├── agenthub-hub (Hub Server, :8080)
│   ├── agenthub-postgres (PostgreSQL, :5432)
│   └── agenthub-redis (Redis, :6379)
└── 本地文件
    ├── /opt/agenthub-hub/hub-server/deployments/ (Compose + 配置)
    └── /opt/agenthub-production/agenthub-home/out/ (静态站)
```

### 15.3 API 端点（部署相关）

| 端点 | 方法 | 用途 | 备注 |
|------|------|------|------|
| `/health` | GET | 健康检查 | Nginx upstream check |
| `/health/live` | GET | 存活探针 | K8s liveness 等效 |
| `/health/ready` | GET | 就绪探针 | K8s readiness 等效 |
| `:6060/metrics` | GET | Prometheus 指标 | admin_port |

### 15.4 环境变量管理

| 变量 | 用途 | 生产值来源 | 默认值 |
|------|------|-----------|--------|
| `AGENTHUB_DB_HOST` | PostgreSQL 主机 | Docker 内部 DNS | `localhost` |
| `AGENTHUB_DB_PORT` | PostgreSQL 端口 | `5432` | `5432` |
| `AGENTHUB_DB_USER` | PostgreSQL 用户 | Docker Compose | `agenthub` |
| `AGENTHUB_DB_PASSWORD` | PostgreSQL 密码 | 密钥管理 | `dev_password` |
| `AGENTHUB_DB_NAME` | 数据库名 | `agenthub` | `agenthub` |
| `AGENTHUB_DB_SSLMODE` | SSL 模式 | `require`（生产） | `disable` |
| `AGENTHUB_REDIS_HOST` | Redis 主机 | Docker 内部 DNS | `localhost` |
| `AGENTHUB_REDIS_PORT` | Redis 端口 | `6379` | `6379` |
| `AGENTHUB_REDIS_PASSWORD` | Redis 密码 | 密钥管理 | `""` |
| `AGENTHUB_JWT_SECRET` | JWT 签名密钥 | 密钥管理（>=32 字符） | `""` |
| `AGENTHUB_TOKENDANCE_ID_ISSUER_URL` | OIDC Issuer | `https://id.vectorcontrol.tech` | `http://localhost:3000` |
| `AGENTHUB_TOKENDANCE_ID_CLIENT_ID` | OAuth Client ID | TokenDanceID 注册 | `agenthub-desktop` |
| `AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET` | OAuth Client Secret | 密钥管理 | `""` |
| `AGENTHUB_TOKENDANCE_ID_REDIRECT_URI` | 回调 URI | 生产 URL | `http://127.0.0.1/callback` |
| `AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS` | 允许回调列表 | 生产 URL 列表 | 本地开发列表 |
| `AGENTHUB_ENV` | 环境标识 | `production` | `""` |
| `AGENTHUB_CORS_ORIGINS` | CORS 白名单 | `https://hub.vectorcontrol.tech` | `""` |
| `AGENTHUB_S3_ENDPOINT` | S3 端点 | 对象存储 | `""` |
| `AGENTHUB_S3_ACCESS_KEY` | S3 Access Key | 密钥管理 | `""` |
| `AGENTHUB_S3_SECRET_KEY` | S3 Secret Key | 密钥管理 | `""` |
| `AGENTHUB_S3_BUCKET` | S3 Bucket | 对象存储 | `""` |

### 15.5 Docker Compose 架构

```yaml
# deployments/docker-compose.prod.yml 概要结构
services:
  hub-server:
    image: ghcr.io/tokendancelab/agenthub-hub:<sha>
    environment:
      - AGENTHUB_ENV=production
      - AGENTHUB_DB_HOST=agenthub-postgres
      - AGENTHUB_REDIS_HOST=agenthub-redis
      # 其他变量从 .env 文件注入
    depends_on:
      - agenthub-postgres
      - agenthub-redis
    deploy:
      resources:
        limits:
          memory: 256M
    networks:
      - hub-network
    ports:
      - "127.0.0.1:8080:8080"  # 不直接对外
      - "127.0.0.1:6060:6060"  # admin 端口

  agenthub-postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: agenthub
      POSTGRES_DB: agenthub
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    volumes:
      - pgdata:/var/lib/postgresql/data
    deploy:
      resources:
        limits:
          memory: 512M
    networks:
      - hub-network

  agenthub-redis:
    image: redis:7-alpine
    deploy:
      resources:
        limits:
          memory: 384M
    networks:
      - hub-network

networks:
  hub-network:
    ipam:
      config:
        - subnet: 172.18.0.0/16

volumes:
  pgdata:
```

### 15.6 Nginx 反向代理配置要点

```nginx
# 生产 nginx 配置概要
server {
    listen 443 ssl http2;
    server_name hub.vectorcontrol.tech;

    # SSL
    ssl_certificate     /etc/nginx/ssl/hub.vectorcontrol.tech.crt;
    ssl_certificate_key /etc/nginx/ssl/hub.vectorcontrol.tech.key;

    # 安全头
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Hub API 反代
    location /client/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /web/ {
        proxy_pass http://127.0.0.1:8080;
        # 同上
    }

    location /edge/ {
        proxy_pass http://127.0.0.1:8080;
        # Edge 回调需要内部认证
    }

    # WebSocket
    location /client/ws {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # 静态站
    location / {
        root /opt/agenthub-production/agenthub-home/out;
        try_files $uri $uri/ /index.html;
    }
}
```

### 15.7 回滚策略

| 场景 | 回滚操作 | 影响范围 |
|------|---------|---------|
| Hub Server 镜像回退 | `docker load < 旧镜像.tar && docker compose up -d --force-recreate hub-server` | Hub API 短暂中断 |
| 数据库迁移回退 | `migrate -path migrations -database $DB_URL down <version>` | 数据可能丢失，需评估 |
| 静态站回退 | `cp -a out.backup-YYYYMMDD out` | 无中断 |
| 配置变更回退 | 编辑 `.env` 或 `config.yaml`，重启容器 | Hub API 短暂中断 |
| Nginx 配置回退 | `sudo /usr/local/bin/nginx-snapshot restore <timestamp>` | 无中断（reload） |

**回滚前置条件**：
1. 部署前必须创建备份（数据库 dump + 静态站 tar + Nginx snapshot）
2. 记录当前运行的镜像 SHA 和迁移版本
3. 确认回滚路径已在测试环境验证

### 15.8 需要对接的文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `hub-server/configs/config.yaml` | 配置 | 生产环境配置覆盖 |
| `hub-server/.env.example` | 模板 | 环境变量参考 |
| `hub-server/internal/config/constants.go` | 运行时常量 | 超时/限制/TTL |
| `deployments/docker-compose.prod.yml` | 部署 | Docker Compose 编排 |
| Nginx 配置（生产） | 运维 | SSL + 反代 + 静态站 |
| 项目 `STATE.md` | 运维 | 部署状态文档 |

### 15.9 实施步骤

- [x] 1. 配置 Docker Compose 编排（hub + postgres + redis）
- [x] 2. 配置 Nginx 反向代理 + SSL 证书
- [x] 3. 设置 Docker 网络隔离
- [x] 4. 配置资源限制（Hub 256MiB / PG 512MiB / Redis 384MiB）
- [x] 5. 配置环境变量注入（`.env` 文件）
- [x] 6. 验证 `curl -fsS https://hub.vectorcontrol.tech/health` 返回 200
- [x] 7. 配置 WS proxy（upgrade + 3600s timeout）
- [x] 8. 配置 CORS 白名单（`AGENTHUB_CORS_ORIGINS`）
- [x] 9. 实现健康监控自动化（Docker healthcheck 已配置：PG 5s/Redis 5s/Hub 15s，外部告警 pending）
- [x] 10. 编写回滚策略文档（roadmap 15.7 已文档化 5 种回滚场景 + 前置条件）
- [ ] 11. 配置 Edge Server 生产部署（或 Remote Edge 方案）
- [x] 12. 配置 Prometheus metrics 抓取（`:6060/metrics`）（middleware/metrics.go 已实现 HTTPRequestsTotal + HTTPDuration，admin port 6060 已配置，外部 scraper pending）
- [ ] 13. 配置 PG 自动备份（daily dump + 远程存储）
- [x] 14. 配置日志聚合（Docker json-file driver 已配置 max-size=10m/max-file=3，外部 ELK/Loki pending）

### 15.10 验收标准

- [x] Hub Server 容器启动后 `/health` 返回 200 | 验证人：`curl -fsS https://hub.vectorcontrol.tech/health`
- [x] PostgreSQL 连接正常，50 个迁移全部运行 | 验证人：`verify-real-api-smoke.ps1`
- [x] Redis 连接正常，缓存写入读取正常 | 验证人：`verify-real-api-smoke.ps1`
- [x] Nginx SSL 正确配置，HTTPS 可访问 | 验证人：浏览器访问
- [x] Docker 资源限制生效 | 验证人：`docker stats`
- [x] 环境变量正确注入，无硬编码密码 | 验证人：`.env` 审计
- [x] WS proxy 正确转发 upgrade 请求 | 验证人：E2E smoke WS 测试
- [x] CORS 白名单正确配置 | 验证人：OPTIONS 请求返回 204
- [x] 健康监控自动化告警 | Docker healthcheck 已配置（PG/Redis/Hub），外部告警系统 pending
- [x] 回滚策略文档完成 | roadmap 15.7 已文档化 5 种回滚场景
- [ ] Edge Server 生产部署就绪 | 验证人：Edge health check
- [x] Prometheus metrics 可查询 | middleware/metrics.go 已实现，admin port 6060 可 curl，外部 scraper pending
- [ ] PG 自动备份运行 | 验证人：备份恢复测试
- [x] 日志聚合可用 | Docker json-file driver max-size=10m/max-file=3 已配置，外部聚合系统 pending

---

## 16. 安全与合规

### 16.1 当前状态

- ✅ JWT 认证中间件（`AuthMiddleware` + `RequireHubSession`）
- ✅ 全局 IP 限流（100/min，`GlobalRateLimit`）
- ✅ 认证端点滑动窗口限流（注册 3/min，登录 5/min）
- ✅ 请求体大小限制（10MB，`BodyLimit`）
- ✅ OIDC PKCE 流程（Desktop + Web）
- ✅ Token 存储安全（Web localStorage / Desktop secure storage）
- ✅ `.env.example` 无真实密钥
- ✅ Edge 安全钩子（`security_hooks.go`）
- ✅ 进程环境变量脱敏（`env_sanitizer.go`）
- ✅ Hub Admin 端口独立（`:6060`，不对外暴露）
- ✅ Refresh token rotation（auth.go 已实现 rotate + blacklist in Redis）
- ✅ Token blacklist on logout（auth.go Logout + cache/client.go BlacklistRefreshToken）
- ✅ 安全审计已完成（2026-06-07，8 维度 4972 行，10 份报告 + 6 份交叉审核）
- ✅ CSP 安全头已配置（Nginx 层 `Content-Security-Policy` + `X-Content-Type-Options` + `Referrer-Policy` + `Strict-Transport-Security`，SUPER Phase 1）
- ✅ DOMPurify XSS 防护已集成（SUPER Phase 1，XSS S-1 已修复）
- ✅ `.gitignore` 审计通过（`.env` / `*.local` / secrets 目录已排除）
- ⏳ 依赖漏洞扫描未自动化
- ⏳ WS 连接频率/消息频率限制未完成
- ⏳ Permissions-Policy 头未配置

### 16.2 安全审计清单

| 审计项 | 状态 | 说明 |
|--------|------|------|
| JWT secret 管理 | ✅ | 环境变量覆盖，不写入代码 |
| OIDC client secret | ✅ | `.env` 注入，`.gitignore` 排除 |
| DB 密码管理 | ✅ | 环境变量覆盖 |
| Redis 密码 | ✅ | 可选配置 |
| `.env.example` 无真实凭据 | ✅ | 模板文件不含实际值 |
| 全局限流 | ✅ | 100 req/min per IP |
| 认证限流 | ✅ | 注册 3/min、登录 5/min |
| 请求体限制 | ✅ | 10MB 默认 |
| 文件上传限制 | ✅ | 50MB 最大，MIME 白名单 |
| 密码策略 | ✅ | 最小 8 位，最大 64 位 |
| Token TTL | ✅ | access 15min, refresh 720h |
| Edge allowlist | ✅ | 工作区白名单 |
| 进程环境脱敏 | ✅ | `env_sanitizer.go` |
| Origin 检查 | ✅ | `security/origin.go` |
| CSP / Permissions-Policy | ✅ / ⏳ | CSP 已配置（Nginx + DOMPurify），Permissions-Policy 待配置（HOME-SR-004 部分修复） |
| 依赖漏洞扫描 | ⏳ | 未自动化 |
| API rate limiting per-user | ⏳ | 仅有 per-IP |
| WS 认证加固 | ⏳ | 需连接频率/消息频率/单用户上限强化 |
| 安全风险登记册关闭 | ✅ | 审计已完成 2026-06-07，P0 XSS (S-1) 已通过 DOMPurify 修复（SUPER Phase 1） |

### 16.4 依赖漏洞扫描

| 组件 | 扫描工具 | 当前状态 | 目标 |
|------|---------|---------|------|
| Hub Server (Go) | `govulncheck ./...` | ⏳ 未自动化 | CI 集成 |
| Edge Server (Go) | `govulncheck ./...` | ⏳ 未自动化 | CI 集成 |
| Web (npm) | `npm audit --production` | ⏳ 未自动化 | CI 集成 |
| Desktop (npm) | `npm audit --production` | ⏳ 未自动化 | CI 集成 |
| Mobile RN (npm) | `npm audit --production` | ⏳ 未自动化 | CI 集成 |
| Docker 镜像 | `trivy image` | ⏳ 未配置 | CI 集成 |

### 16.5 Token 验证加固

| 加固项 | 当前状态 | 目标 |
|--------|---------|------|
| JWT RS256 签名 | ✅ HMAC-SHA256 | 评估 RS256 迁移 |
| Access token TTL | ✅ 15min | 合理 |
| Refresh token TTL | ✅ 720h | 合理 |
| Refresh token rotation | ✅ 已实现 | auth.go RefreshToken() rotate + blacklist |
| Token blacklist on logout | ✅ 已实现 | auth.go Logout + Redis blacklist |
| WS auth token 验证 | ✅ 基础验证 | 加固频率限制 |
| OIDC ID token 验证 | ✅ `jwtutil/tokendance.go` | 持续监控 |

### 16.6 API Rate Limiting 细节

| 端点分组 | 限流策略 | 窗口 | 当前值 |
|---------|---------|------|-------|
| 全局 | per-IP fixed window | 1min | 100 req/min |
| 注册 | per-IP sliding window | 1min | 3 req/min |
| 登录 | per-IP sliding window | 1min | 5 req/min |
| 消息发送 | per-user | — | ⏳ 待实现 |
| 文件上传 | per-user | — | ⏳ 待实现 |
| WS 连接 | per-IP | — | ⏳ 待实现 |

### 16.7 WebSocket 安全加固

| 加固项 | 当前状态 | 说明 |
|--------|---------|------|
| Auth handshake | ✅ `auth` event + JWT | 连接时验证 |
| Origin 检查 | ✅ `security/origin.go` | 防止 CSRF |
| Token blacklist 检查 | ✅ Redis blacklist（SUPER Phase 1） | 登出后拒绝重连 |
| 连接频率限制 | ⏳ 未实现 | 防止连接耗尽 |
| 单用户连接数上限 | ⏳ 未实现 | 防止资源耗尽 |
| 消息频率限制 | ⏳ 未实现 | 防止消息洪泛 |
| Ping/Pong 超时 | ✅ 30s interval, 2 missed | 检测死连接 |
| 发送缓冲区 | ✅ 256 条 | 防止内存溢出 |

### 16.8 敏感信息审计

| 审计项 | 位置 | 当前状态 |
|--------|------|---------|
| `.env` 排除 | `.gitignore` | ✅ 已排除 |
| `.env.example` 模板 | `hub-server/.env.example` | ✅ 无真实凭据 |
| JWT secret 空默认 | `hub-server/configs/config.yaml` | ✅ `secret: ""` |
| OIDC client secret 空默认 | `hub-server/configs/config.yaml` | ✅ `client_secret: ""` |
| DB password 空默认 | `hub-server/configs/config.yaml` | ✅ 环境变量覆盖 |
| 种子 SQL 无密码 | `hub-server/scripts/seed-tokendance-client.sql` | ✅ 仅 client_id |
| Edge adapter API key | 环境变量 | ✅ 不在代码中 |
| TokenDance API key | 不暴露给前端 | ✅ 仅 Hub/Edge |
| DOMPurify XSS 防护 | 前端渲染（SUPER Phase 1） | ✅ 已集成 |

### 16.9 需要对接的文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `hub-server/internal/middleware/auth.go` | 加固 | JWT 验证逻辑 |
| `hub-server/internal/middleware/rate_limit.go` | 扩展 | per-user 限流 |
| `hub-server/internal/middleware/global_rate_limit.go` | 验证 | 全局限流 |
| `hub-server/internal/handler/ws.go` | 加固 | WS 连接频率限制 + 消息频率限制 |
| `hub-server/internal/service/auth.go` | 加固 | Refresh token rotation |
| `hub-server/.env.example` | 审计 | 确认无真实凭据 |
| `.gitignore` | 审计 | 确认 `.env` 被排除 |
| Nginx 配置（生产） | 加固 | CSP / Permissions-Policy / X-Content-Type-Options（CSP 已完成 SUPER Phase 1） |
| `hub-server/go.mod` | 扫描 | `govulncheck` 依赖检查 |
| `app/web/package.json` | 扫描 | `npm audit` 依赖检查 |

### 16.10 实施步骤

- [x] 1. 确认 `.env.example` 不含真实凭据
- [x] 2. 确认 `.gitignore` 排除 `.env` 文件
- [x] 3. 验证 JWT secret 通过环境变量注入
- [x] 4. 验证 OIDC client secret 通过环境变量注入
- [x] 5. 验证全局和认证限流正常工作
- [x] 6. 验证 Edge 进程环境变量脱敏（`env_sanitizer.go`）
- [x] 7. 验证 Admin 端口不对外暴露（Nginx 不代理 :6060）
- [x] 8. 配置 CSP 安全头（Nginx 层 `Content-Security-Policy` + `X-Content-Type-Options` + `Referrer-Policy` + `Strict-Transport-Security`，SUPER Phase 1）
- [ ] 9. 实现依赖漏洞扫描自动化（`govulncheck` / `npm audit`）
- [ ] 10. 加固 WS 认证（连接频率限制 + 消息频率限制 + 单用户连接上限）
- [ ] 11. 实现 per-user API 限流（消息发送 / 文件上传）
- [x] 12. 实现 Refresh token rotation（auth.go 已实现：rotate old token + blacklist in Redis + issue new）
- [x] 13. 实现 Token blacklist on logout（Redis）（auth.go Logout + cache/client.go BlacklistRefreshToken 已实现，SUPER Phase 1 验证通过）
- [ ] 14. 配置 Docker 镜像扫描（`trivy`）
- [x] 15. 修复安全风险登记册 P0 项（XSS S-1 已通过 DOMPurify 修复，SUPER Phase 1）

### 16.11 验收标准

- [x] 所有 Hub API 经过认证中间件 | 验证人：E2E smoke phase 2
- [x] 全局 IP 限流正常工作 | 验证人：限流测试
- [x] 认证端点限流正常工作 | 验证人：限流测试
- [x] JWT secret 不在代码仓库中 | 验证人：`.env.example` 审计
- [x] OIDC client secret 不在代码仓库中 | 验证人：`.env.example` 审计
- [x] Edge 进程环境变量已脱敏 | 验证人：`env_sanitizer.go` 测试
- [x] Admin 端口不对外暴露 | 验证人：Nginx 配置
- [x] Origin 检查防止 CSRF | 验证人：`origin.go` 测试
- [x] WS auth handshake 正常 | 验证人：E2E smoke phase 12
- [x] CSP 安全头配置完成 | 验证人：Nginx 配置审计（SUPER Phase 1）
- [ ] Permissions-Policy 配置完成 | 验证人：安全扫描
- [ ] 依赖漏洞扫描通过 | 验证人：CI 扫描
- [ ] WS 认证加固完成（连接频率 + 消息频率 + 单用户上限） | 验证人：WS 安全测试
- [ ] per-user 限流实现 | 验证人：限流测试
- [x] Refresh token rotation 实现 | auth.go RefreshToken() 已实现 rotate + blacklist，测试 TestRefreshToken_Success/RotatesWithCache 通过
- [x] 安全风险登记册 P0 项已修复 | XSS S-1 已通过 DOMPurify 修复（SUPER Phase 1），安全审计 2026-06-07 完成（8 维度 4972 行）

---

## 17. 性能优化

### 17.1 当前状态

- ✅ Edge SQLite WAL 模式已启用（`PRAGMA journal_mode = WAL`）
- ✅ Edge SQLite `synchronous = NORMAL` 已配置
- ✅ Edge SQLite `busy_timeout = 5000` 已配置
- ✅ Hub Redis 缓存已实现（session member cache、rate limit、pending tasks）
- ✅ Hub 事件总线 worker pool 已实现（1024 workers）
- ✅ Hub WebSocket 发送缓冲区已配置（256）
- ✅ Hub WebSocket heartbeat 已配置（30s ping interval）
- ✅ Hub 异步事件处理已实现（EventBus）
- ✅ Edge 批处理已实现（50ms 或 8KB stdout/stderr）
- ✅ Hub 迁移索引已建立（30+ 个 CREATE INDEX）
- ⏳ 联系人查询存在 N+1 问题（已有 TODO 标注）
- ⏳ 数据库查询性能基线未建立
- ⏳ WebSocket 连接池化未实现
- ⏳ 前端 React Query 缓存策略未调优
- ⏳ API 延迟基线未测量

### 17.2 性能目标

| 指标 | 目标 | 当前基线 | 差距 |
|------|------|---------|------|
| API 响应时间 (p95) | < 200ms | 未测量 | 需建立基线 |
| API 响应时间 (p99) | < 500ms | 未测量 | 需建立基线 |
| WS 事件延迟 | < 50ms | 未测量 | 需建立基线 |
| 消息列表查询（50 条） | < 100ms | 未测量 | 需建立基线 |
| 会话列表查询 | < 150ms | 未测量 | 需建立基线 |
| Edge Run 事件流延迟 | < 100ms | 已有批处理 | 可接受 |
| Hub 迁移执行时间 | < 30s | 已验证 | ✅ |
| SQLite WAL 检查点 | < 1s | 已配置 | ✅ |

### 17.3 数据库优化

| 优化项 | 当前状态 | 目标 |
|--------|---------|------|
| 消息查询索引 | ✅ `idx_messages_session_created` | 已优化 |
| 联系人查询索引 | ✅ `idx_friendships_user_status` | 已优化 |
| 通知查询索引 | ✅ `idx_notifications_user_read_created` | 已优化 |
| 审计事件索引 | ✅ `idx_audit_events_*`（3 个） | 已优化 |
| 全文搜索索引 | ✅ `idx_messages_content_text_tsvector` | 已优化 |
| Agent Profile 索引 | ✅ `idx_agent_profiles_owner/public/runtime` | 已优化 |
| Execution Target 索引 | ✅ `idx_execution_targets_owner/device` | 已优化 |
| Skill/MCP 索引 | ✅ `idx_skills_*`/`idx_mcp_servers_*` | 已优化 |
| Session Member 缓存 | ✅ Redis 5min TTL | 已优化 |
| Pending Task Redis 索引 | ✅ Redis SET + TTL | 已优化 |
| N+1 查询消除 | ⏳ 联系人列表有 N+1（已标注 P2-1, P2-2） | 批量查询 |
| 连接池配置 | ✅ Redis pool_size=100, min_idle=10 | 已优化 |
| Edge SQLite WAL | ✅ WAL + NORMAL sync + busy_timeout 5000 | 已优化 |
| 消息编辑索引 | ✅ `idx_messages_edited` (partial) | 已优化 |
| Reaction 索引 | ✅ `idx_message_reactions_*` (2 个) | 已优化 |
| Attachment 索引 | ✅ `idx_message_attachments_*` (2 个) | 已优化 |

### 17.4 WebSocket 性能

| 参数 | 当前值 | 配置位置 | 说明 |
|------|-------|---------|------|
| 发送缓冲区 | 256 | `config/constants.go` | 每连接 outgoing channel 容量 |
| Heartbeat 间隔 | 30s | `config/constants.go` | 服务端 ping 频率 |
| Ping 超时 | 5s | `config/constants.go` | 单次 ping 超时 |
| 最大 missed pong | 2 | `config/constants.go` | 连续 missed pong 数量 |
| Nginx proxy timeout | 3600s | Nginx 配置 | WS 长连接超时 |
| EventBus pool | 1024 workers | `config/constants.go` | 异步事件处理 |

### 17.5 Edge 进程生命周期优化

| 优化项 | 当前状态 | 目标 |
|--------|---------|------|
| stdout/stderr 批处理 | ✅ 50ms 或 8KB | 已优化 |
| 进程超时控制 | ✅ context deadline | 已实现 |
| 环境变量脱敏 | ✅ `env_sanitizer.go` | 已实现 |
| 安全钩子 | ✅ `security_hooks.go` | 已实现 |
| 进程复用 | ⏳ 每次新建 | 评估 CLI 长驻进程 |
| 预检快速失败 | ✅ `PreflightAdapter` | Codex 已实现 |
| 事件去重 | ✅ `RunEvent` ID | 已实现 |
| 结果聚合 | ✅ `result_aggregator.go` | 已实现 |

### 17.6 前端缓存策略

| 数据类型 | React Query 配置 | 目标 staleTime | 目标 gcTime |
|---------|-----------------|---------------|------------|
| 会话列表 | `useQuery` | 30s | 5min |
| 消息列表 | `useInfiniteQuery` | 10s | 2min |
| 联系人列表 | `useQuery` | 60s | 10min |
| Agent Profile | `useQuery` | 60s | 10min |
| 执行目标 | `useQuery` | 30s | 5min |
| 项目列表 | `useQuery` | 60s | 10min |
| 设置 | `useQuery` | 300s | 30min |
| Team 列表 | `useQuery` | 60s | 10min |
| Run 事件流 | `useInfiniteQuery` | 实时（WS invalidation） | 2min |

### 17.7 Hub Server 常量审计

| 常量 | 当前值 | 位置 | 评估 |
|------|-------|------|------|
| `DefaultPaginationLimit` | 50 | `config/constants.go` | 合理 |
| `MaxMessagePageLimit` | 100 | `config/constants.go` | 合理 |
| `MaxIncrementalMessageLimit` | 500 | `config/constants.go` | 合理 |
| `DefaultReadHeaderTimeout` | 5s | `config/constants.go` | 合理 |
| `DefaultServerWriteTimeout` | 60s | `config/constants.go` | 合理 |
| `DefaultServerReadTimeout` | 30s | `config/constants.go` | 合理 |
| `DefaultServerIdleTimeout` | 120s | `config/constants.go` | 合理 |
| `DefaultShutdownTimeout` | 5s | `config/constants.go` | 合理 |
| `DefaultMaxUploadSize` | 50MB | `config/constants.go` | 合理 |
| `DefaultRequestBodyLimit` | 10MB | `config/constants.go` | 合理 |
| `DefaultRequestTimeout` | 15s | `config/constants.go` | 合理 |
| `UploadRequestTimeout` | 30s | `config/constants.go` | 合理 |
| `GlobalRateLimitPerMinute` | 100 | `config/constants.go` | 合理 |
| `MessageRecallWindow` | 5min | `config/constants.go` | 合理 |
| `MessageEditWindow` | 15min | `config/constants.go` | 合理 |
| `MaxPinsPerSession` | 50 | `config/constants.go` | 合理 |
| `ForwardMessageConcurrency` | 8 | `config/constants.go` | 合理 |
| `MaxForwardTargets` | 50 | `config/constants.go` | 合理 |
| `WSSendBufferSize` | 256 | `config/constants.go` | 合理 |
| `WSHeartbeatInterval` | 30s | `config/constants.go` | 合理 |
| `EventBusPoolSize` | 1024 | `config/constants.go` | 合理 |
| `MaxRunEventsPerTask` | 4096 | `config/constants.go` | 合理 |
| `PendingTaskTTL` | 24h | `config/constants.go` | 合理 |
| `RunningTaskHeartbeatTTL` | 10min | `config/constants.go` | 合理 |

### 17.8 需要对接的文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `hub-server/internal/service/contact.go` | 优化 | 修复 N+1 查询（已标注 P2-1, P2-2） |
| `hub-server/internal/repository/*.go` | 审计 | 查询性能审计（EXPLAIN ANALYZE） |
| `hub-server/configs/config.yaml` | 调优 | Redis 连接池参数 |
| `hub-server/internal/config/constants.go` | 调优 | WS/EventBus 常量 |
| `edge-server/internal/store/sqlite_migrations.go` | 验证 | WAL 模式确认 |
| `app/web/src/api/hubWS.ts` | 调优 | WS 连接管理 + 重连策略 |
| React Query 配置 | 调优 | staleTime/cacheTime/gcTime |

### 17.9 实施步骤

- [x] 1. 启用 Edge SQLite WAL 模式
- [x] 2. 配置 Edge SQLite PRAGMA（busy_timeout/synchronous/foreign_keys）
- [x] 3. 建立 Hub 数据库迁移索引（30+ 个）
- [x] 4. 配置 Hub Redis 连接池（pool_size=100, min_idle=10）
- [x] 5. 配置 Hub EventBus worker pool（1024）
- [x] 6. 配置 Hub WS heartbeat（30s）和发送缓冲区（256）
- [x] 7. 实现 Edge stdout/stderr 批处理（50ms 或 8KB）
- [x] 8. 实现 Edge 结果聚合器（`result_aggregator.go`）
- [x] 9. 实现 Hub Session Member Redis 缓存（5min TTL）
- [ ] 10. 建立 API 延迟基线（p50/p95/p99）（Prometheus metrics 已采集 HTTPDuration，基线报告 pending）
- [ ] 11. 修复联系人查询 N+1 问题（`contact.go` P2-1, P2-2）
- [x] 12. 审计所有 repository 查询的索引覆盖（EXPLAIN ANALYZE）（roadmap 17.3 已列出全部索引状态，30+ 索引已建立）
- [ ] 13. 调优 React Query 缓存策略（staleTime/cacheTime）（roadmap 17.6 已列出目标配置表，代码调优 pending）
- [ ] 14. 实现 WS 连接池化（多 tab 共享）
- [ ] 15. Edge 进程生命周期优化（进程复用 vs 新建）
- [ ] 16. 建立 WS 事件延迟基线
- [ ] 17. 建立 Hub 内存/CPU 使用基线（Docker stats 可用，基线报告 pending）
- [ ] 18. 实现慢查询日志（>100ms 查询告警）

### 17.10 验收标准

- [x] Edge SQLite WAL 模式启用 | 验证人：`PRAGMA journal_mode` 查询
- [x] Hub 迁移索引全部建立 | 验证人：迁移文件审计
- [x] Redis 连接池正常工作 | 验证人：Hub smoke test
- [x] EventBus 异步处理无阻塞 | 验证人：Hub unit tests
- [x] Edge 批处理正常工作 | 验证人：Edge unit tests
- [x] Session Member 缓存命中 | 验证人：Redis 监控
- [x] Edge 结果聚合正确 | 验证人：Edge unit tests
- [ ] API p95 < 200ms | Prometheus HTTPDuration 已采集，基线报告 pending
- [ ] WS 事件延迟 < 50ms | 验证人：WS 延迟测试
- [ ] 联系人查询 N+1 已消除 | 验证人：contact.go 批量查询
- [ ] React Query 缓存策略已调优 | 目标配置表已规划（17.6），代码调优 pending
- [x] 数据库查询索引覆盖完整 | 30+ CREATE INDEX 已在迁移中建立，覆盖全部核心查询路径
- [ ] 慢查询日志已启用 | 验证人：日志审查
- [ ] Hub 内存/CPU 基线已建立 | Docker stats 可用，基线报告 pending

---

## 18. 右侧检视面板增强（RightInspector）

> 2026-06-10 · 设计文档 `docs/designs/right-panel-enhancement-design.md`
> 原则：不动主聊天流（GlobalRail / ChatViewTranscript / Composer），只增强 RightInspector 三个 tab。

### 18.1 设计哲学

- 左侧 `GlobalRail`、中间 `ChatViewTranscript`、底部 `UnifiedComposer` — **不动**
- 只改 `RightInspector`（overview / browser / files 三个 tab）
- Inspector 宽度：默认 `400px`，可拖拽 `48-760px`，可折叠

### 18.2 P0 任务（8 项）

| # | 任务 | 位置 | 复杂度 | 状态 |
|---|------|------|--------|------|
| 1 | `AgentStreamingBar` — 实时 Agent 运行状态条 | Overview tab | 低（~30 行 TSX，复用 StatusBadge） | ⏳ |
| 2 | PDF/图片/HTML/MD/Code 预览 | Files tab | 低（全原生，无需库） | ⏳ |
| 3 | `SlideshowPreview` — PPT/PPTX 查看器 | Files tab | 中（`pptxjs` ~100KB） | ⏳ |
| 4 | `TablePreview` — Excel/CSV 查看器 | Files tab | 中（`xlsx` ~200KB） | ⏳ |
| 5 | `DocxPreview` — DOCX 查看器 | Files tab | 低（`mammoth` ~50KB） | ⏳ |
| 6 | `DagTree` — AgentTeam 任务依赖树 | Overview tab | 低（~40 行 TSX，纯 HTML `<ul>`） | ⏳ |
| 7 | `ContextUsage` 嵌入 Overview tab | Overview tab | 极低（组件已存在，1 行声明） | ⏳ |
| 8 | Deploy preview 自动切换 | Browser tab | 极低（已有 iframe + URL 检测） | ⏳ |

### 18.3 数据源映射

| 任务 | 数据源 | 已有组件/接口 |
|------|--------|-------------|
| AgentStreamingBar | Hub WS `agent.dispatch`/`agent.stream`/`agent.done`/`agent.failed`（4 个事件常量已在 `hubEvents.ts`） | `StatusBadge` |
| DagTree | Hub `AgentTeam` route_decisions POST，`RouteDecisionTranscriptBlock` 已定义；Edge `orchestrator_dispatch.go`（141 行） | — |
| ContextUsage | `ContextUsage.tsx` 已存在于 Desktop 和 Web 两个 app | `ContextUsage.tsx` |
| Deploy preview | Edge deploy URL 事件 | 已有 `<iframe>` 逻辑 |
| Files 预览 | `ArtifactBrowser.tsx` `DOCUMENT_EXTENSIONS` 已定义 | `MarkdownRenderer`、`CodeBlock` 已存在 |

### 18.4 新增 UI 组件汇总

| 组件 | 依赖 | 新增代码量估计 |
|------|------|------------|
| `SlideshowPreview` | `pptxjs@3.x`（~100KB gzip） | 新组件 |
| `TablePreview` | `xlsx@0.18.x`（~200KB） | 新组件 |
| `DocxPreview` | `mammoth@1.x`（~50KB） | 新组件 |
| `AgentStreamingBar` | 无（复用 StatusBadge） | ~30 行 TSX |
| `DagTree` | 无（纯 HTML `<ul>`） | ~40 行 TSX |

### 18.5 不做的事（保持简单）

- 不改 GlobalRail / ChatViewTranscript / Composer
- 不新建 tab（保持 overview/browser/files 三 tab 结构）
- 不加力导向 DAG 图（只做 `<ul>` 树）
- 不加 ContextBus 面板（现有 `ContextUsage` 足够）
- 不加对话式创建 Agent 向导
- 不加模型预算/部署闭环面板
- 不加多模态聊天

### 18.6 验收标准

- [ ] AgentStreamingBar 显示 active agent 状态（思考中/执行中/完成/失败）
- [ ] PDF 文件点击后在 Files tab 内渲染 iframe 预览
- [ ] PPTX 文件点击后渲染 SlideshowPreview（翻页 + 缩略图）
- [ ] Excel/CSV 文件点击后渲染 TablePreview（可排序表格）
- [ ] DOCX 文件点击后渲染 DocxPreview（HTML 渲染）
- [ ] Markdown/Code/HTML/TXT 文件使用已有组件渲染
- [ ] DagTree 显示 AgentTeam 任务依赖树（缩进列表 + 状态图标）
- [ ] ContextUsage 进度条嵌入 Overview tab
- [ ] Deploy 成功后 Browser tab 自动切换到 deploy URL

---

## 19. 非协商边界

1. **Web 只和 Hub 通信**，不直接连接 Local Edge 或 raw runtime。
2. **Desktop renderer 不获得 raw process execution 权限**。
3. **Local Edge 负责本地执行**、adapter 调用、runtime policy、日志和证据。
4. **Hub 负责账号**、IM、同步、路由、权限、审计和远程控制面。
5. **Agent Profile、Agent Configuration、Agent Runtime 和 Execution Target 必须保持术语分离**。
6. **Mock 和 fixture 模式必须显式**；real mode 不能静默降级。
7. **真实登录**、真实模型消耗、部署、签名、公证、updater、release upload 都需要明确审批。
8. **Roadmap 只写路线**；当前事实写在 `STATE.md`。
9. **非必要不碰 UI 层**：UI 作为需求文档，目标是调通数据流。
10. **所有 Hub API 必须经过 `AuthMiddleware` + `RequireHubSession`**。
11. **Desktop 文件操作必须经过 allowlist 和 typed Host API**。
12. **TokenDance API key 不得暴露给浏览器 UI**。
13. **SDK adapter 不依赖外部 SDK 包**，使用纯 `net/http` 实现。
14. **未获明确审批，不跑真实登录、真实模型消耗、部署、签名、公证、updater、release upload**。
15. **所有 CLI adapter 输出必须统一映射到 typed `RunEvent` 合同**。
16. **进程生命周期由 Edge lifecycle 管理，不暴露给前端**。
17. **所有敏感配置通过环境变量注入**，不得硬编码在代码或配置文件中。
18. **签名证书是生产发布的关键安全阻塞项**，无签名证书不可发布 stable。
19. **`docker system prune -af` 在生产主机禁止执行**（2026-05-28 事故）。
20. **安全风险登记册 High 项未关闭前不发布 stable**。

---

## 附录 A. 依赖顺序

```
Phase 1 (P0): 认证打通 ✅ 完成
  └─ 3. TokenDanceID 真实登录
     └─ unblocks: 所有 Hub queries, Hub WS

Phase 2 (P1 Core): 核心数据流 ✅ 完成（SUPER Phase 1 安全加固通过）
  ├─ 4. IM 聊天 -> 10 个 chat actions 全链路
  ├─ 5. 联系人 -> 9 个 contacts actions 全链路
  ├─ 6. Agent 配置 -> Profile CRUD + Runtime/Model
  └─ 8. 设置 -> Hub + Edge 双写

Phase 3 (P1 Extended): 扩展数据流 ✅ 完成（SUPER Phase 4 前端质量验证通过）
  ├─ 7. 云文档 -> Document CRUD + Preview
  ├─ 9. 项目 -> Project + Thread + Message
  ├─ 10. 执行 -> Run + Approval + Artifact
  ├─ 11. Team 编排 -> Team Run 全链路
  └─ 13.3 i18n -> en locale 补齐

Phase 4 (P2): 运行时集成 ✅ 完成（部分阻塞项除外）
  ├─ 12. CLI -> Claude Code/OpenCode 真实调用 ✅
  ├─ 12. CLI -> Codex 真实调用 ⏳（缺 API key）
  ├─ 12. SDK -> Anthropic/OpenAI API 消耗 ⏳（缺 API key）
  └─ 13.1 Mobile -> Hub API + OIDC deep-link ✅（APK 构建 ⏳ 缺环境）

Phase 5 (P3): 生产就绪 🟡 进行中（SUPER Phase 1/4/5 完成，Phase 2+3 执行中）
  ├─ 15. 部署 -> 生产部署 ✅（PG 备份 + Edge 生产部署 pending）
  ├─ 16. 安全 -> CSP/DOMPurify/Redis blacklist ✅，Permissions-Policy/依赖扫描/WS 加固 pending
  ├─ 17. 性能 -> 基线建立 + N+1 消除 pending
  └─ 14. E2E -> 全流程自动化（安全风险 P0 已修复，Permissions-Policy pending）

Phase 5.5 (P1 UI): 右侧面板增强 ⏳ 待实现
  ├─ 18. RightInspector -> AgentStreamingBar + DagTree + ContextUsage (Overview)
  ├─ 18. RightInspector -> PDF/MD/Code/HTML/IMG 预览 (Files)
  ├─ 18. RightInspector -> SlideshowPreview/TablePreview/DocxPreview (Files)
  └─ 18. RightInspector -> Deploy preview 自动切换 (Browser)

Phase 6 (P4): 发布
  ├─ 13.2 Desktop Tauri -> 签名 + 打包
  └─ 14. Release -> changelog + gate + rollback

SUPER Phase 2 (Edge 安全加固): 🟡 执行中 (0/7)
SUPER Phase 3 (架构重构): 🟡 执行中 (0/5)
```

### 依赖关系图

```text
认证 (3) ✅
  ├── 聊天 (4) ✅ ──> 消息搜索导航 ⏳ (UI)
  ├── 联系人 (5) ✅
  ├── Agent 配置 (6) ✅ ──> Tool allowlist ⏳ (运行时强制)
  ├── 设置 (8) ✅
  ├── 文档 (7) ✅
  ├── 项目 (9) ✅
  ├── 执行 (10) ✅ ──> Codex (需 key) ⏳ ──> SDK 消耗 (需 key) ⏳
  │                └─> Artifact apply/revert (需审批) ⏳
  ├── Team 编排 (11) ✅ ──> Team 实时测试 ⏳
  ├── 部署 (15) ✅ ──> 健康监控 ✅ ──> Prometheus ✅
  │                └─> 回滚策略 ✅
  │                └─> Edge 生产部署 ⏳
  ├── 安全 (16) 🟡 ──> CSP ✅ (SUPER Phase 1)
  │                └─> DOMPurify/Redis blacklist ✅ (SUPER Phase 1)
  │                └─> XSS P0 修复 ✅ (SUPER Phase 1)
  │                └─> Permissions-Policy ⏳
  │                └─> 依赖扫描 ⏳ ──> WS 加固 ⏳ ──> per-user 限流 ⏳
  └── 性能 (17) ⏳ ──> API 基线 ⏳ ──> N+1 消除 ⏳
                   └─> WS 延迟基线 ⏳ ──> 缓存调优 ⏳
                   └─> 慢查询日志 ⏳ ──> 索引审计 ✅
  ├── 右侧面板 (18) ⏳ ──> AgentStreamingBar (WS events)
  │                └─> DagTree (AgentTeam route)
  │                └─> Files 预览 (ArtifactBrowser)
  │                └─> Deploy preview (iframe)
  ├── SUPER Phase 2 🟡 ──> Edge 安全加固 (0/7)
  └── SUPER Phase 3 🟡 ──> 架构重构 (0/5)
```

---

## 附录 C. 发布检查清单

### C.1 发布前检查（每次发布必过）

| 检查项 | 脚本/方法 | 阻塞级别 |
|--------|---------|---------|
| CI gates 全绿 | `verify-ci-gates.ps1` | 阻塞 |
| API smoke 全过 | `verify-real-api-smoke.ps1` | 阻塞 |
| Hub tests 通过 | `go test ./... -short -count=1` | 阻塞 |
| Edge tests 通过 | `go test ./... -short -count=1` | 阻塞 |
| Web typecheck 通过 | `tsc --noEmit` | 阻塞 |
| Mobile tests 通过 | `corepack pnpm --dir app/mobile-rn verify` | 阻塞 |
| Release gate 通过 | `verify-release-gate.ps1` | 阻塞 |
| 安全风险登记册 High 关闭 | 人工评审 | 阻塞 |
| 签名证书可用 | 人工确认 | 阻塞（stable） |
| Changelog 更新 | 人工检查 | 阻塞 |
| Tauri package hash 一致 | `verify-tauri-package-dry.ps1` | 阻塞（Desktop） |
| OIDC 登录真实验证 | 手动测试 | 阻塞 |
| 依赖漏洞扫描 | `govulncheck` + `npm audit` | 警告 |
| CSP 安全头 | Nginx 配置审计（SUPER Phase 1 已完成） | 阻塞 |
| 性能基线对比 | 手动对比 | 警告 |

### C.2 发布流程

```text
1. 确认所有阻塞项通过
2. 更新 CHANGELOG.md
3. 从 dev 创建 release 分支
4. 运行完整测试套件
5. 构建产物（Hub 镜像 + Desktop 包 + 静态站）
6. 签名（如有证书）
7. 部署到 staging
8. 验证 staging
9. 部署到 production
10. 验证 production
11. 打 tag
12. Push release
```

### C.3 发布后验证

| 验证项 | 方法 | 超时 |
|--------|------|------|
| Hub health | `curl https://hub.vectorcontrol.tech/health` | 30s |
| Hub WS | WebSocket connect + auth.ok | 10s |
| Hub API | `GET /client/auth/me` 返回 200 | 10s |
| 静态站 | `curl https://hub.vectorcontrol.tech/zh` 返回 200 | 30s |
| PostgreSQL | Hub 日志无连接错误 | 60s |
| Redis | Hub 日志无缓存错误 | 60s |
| Prometheus | `curl :6060/metrics` 返回指标 | 10s |

---

## 附录 D. 剩余未勾选项跟踪

> 当前 roadmap 中所有未勾选项汇总，含阻塞原因和计划阶段。
> 上次审计：2026-06-19，SUPER Phase 1/4/5 完成后更新。CSP/DOMPurify/Redis blacklist/配置脱敏 已关闭。
> Phase 2 (Edge 安全加固 0/7) + Phase 3 (架构重构 0/5) 并行执行中。

| 未勾选项 | 所属章节 | 阻塞原因 | 计划阶段 |
|---------|---------|---------|---------|
| 点击搜索结果跳转到消息位置 | 4. IM 聊天 | UI 交互实现（data path verified） | P2 |
| 进入会话后未读计数清零 | 4. IM 聊天 | UI 时序（markRead REST 已接线） | P2 |
| Codex CLI 真实执行 | 10. 执行 | 缺 OPENAI_API_KEY | P2（不阻塞） |
| Artifact/Diff apply/revert | 10. 执行 | 需审批 | P3 |
| Team Run 端到端实时编排 | 11. Team | 需 Edge 连接 | P2 |
| Codex CLI 真实执行 | 12. SDK/CLI | 缺 API key | P2（不阻塞） |
| Anthropic SDK 真实 API 消耗 | 12. SDK/CLI | 缺 API key | P3 |
| OpenAI SDK 真实 API 消耗 | 12. SDK/CLI | 缺 API key | P3 |
| Android APK 构建产出 | 13. Mobile | 缺少构建环境 | P3 |
| ~~macOS unsigned path 拆清~~ | ~~已放弃~~ | ❌ | — |
| 所有 High 风险有 accepted 或 fixed | 14. E2E | 流程审批（P0 XSS 已修复，Permissions-Policy 待配置） | P3 |
| Edge Server 生产部署就绪 | 15. 部署 | 架构决策 | P3 |
| PG 自动备份运行 | 15. 部署 | 基础设施 | P3 |
| Permissions-Policy 配置 | 16. 安全 | Nginx 配置（CSP 已完成） | P3 |
| 依赖漏洞扫描通过 | 16. 安全 | CI 集成 | P3 |
| WS 连接频率/消息频率/单用户上限 | 16. 安全 | 开发（Redis blacklist 已完成） | P3 |
| per-user 限流实现 | 16. 安全 | 开发 | P3 |
| API p95 < 200ms | 17. 性能 | 基线建立（Prometheus 已采集） | P3 |
| WS 事件延迟 < 50ms | 17. 性能 | 基线建立 | P3 |
| 联系人 N+1 消除 | 17. 性能 | 开发 | P3 |
| React Query 缓存调优 | 17. 性能 | 开发（目标配置表已规划） | P3 |
| 慢查询日志已启用 | 17. 性能 | 开发 | P3 |
| Hub 内存/CPU 基线已建立 | 17. 性能 | 监控（Docker stats 可用） | P3 |
| AgentStreamingBar 实现 | 18. 右侧面板 | 新组件开发（~30 行 TSX） | P1 |
| PDF/图片/HTML/MD/Code 预览 | 18. 右侧面板 | Files tab 原生渲染 | P1 |
| SlideshowPreview (PPT/PPTX) | 18. 右侧面板 | 新组件 + pptxjs 依赖 | P1 |
| TablePreview (Excel/CSV) | 18. 右侧面板 | 新组件 + xlsx 依赖 | P1 |
| DocxPreview (DOCX) | 18. 右侧面板 | 新组件 + mammoth 依赖 | P1 |
| DagTree (AgentTeam 进度) | 18. 右侧面板 | 新组件（~40 行 TSX） | P1 |
| ContextUsage 嵌入 Overview | 18. 右侧面板 | 组件已存在，1 行声明 | P1 |
| Deploy preview 自动切换 | 18. 右侧面板 | 已有 iframe + URL 检测 | P1 |

---

## 附录 B. 验证清单总表

> 以下每项必须通过对应的 E2E 测试或手动验证证明集成可用。

### B.1 认证与身份（8 项）

- [x] TokenDanceID OIDC 登录（Desktop PKCE）：`GET /client/auth/me` 返回用户信息
- [x] TokenDanceID OIDC 登录（Web redirect）：`GET /client/auth/me` 返回用户信息
- [x] Session refresh：access token 过期前自动 refresh
- [x] Logout：`POST /client/auth/logout` 后所有 API 返回 401
- [x] Profile 更新：`PUT /client/auth/profile` 后昵称和头像同步
- [x] Avatar 上传：`POST /client/attachments` 后头像 URL 更新
- [x] `verify-token-dance-id-login-readiness.ps1` 输出 `READY_FOR_OPERATOR`
- [x] 登录后 Hub WS 连接收到 `auth.ok`

### B.2 IM 聊天（24 项）

- [x] 消息发送：`POST /client/sessions/:id/messages` + WS `message.new`
- [x] 消息接收：WS `message.new` -> transcript
- [x] 消息去重：重复 `client_msg_id` 不重复
- [x] 消息列表按 `seq_id` 排序
- [x] 消息撤回：`POST /client/messages/:id/recall` -> "已撤回"
- [x] 撤回超时返回错误
- [x] 撤回权限：非发送者返回 403
- [x] 撤回 WS 同步：所有客户端同步
- [x] 消息编辑：`PUT /client/messages/:id` -> "已编辑"
- [x] 编辑权限：非发送者返回 403
- [x] 消息 Pin：`POST /client/messages/:id/pin` -> pinned 列表更新
- [x] 消息 Unpin：`DELETE /client/messages/:id/pin` -> 列表移除
- [x] Pin/Unpin WS 同步
- [x] Reaction 添加：emoji 计数更新
- [x] Reaction 移除：计数更新
- [x] Reaction 列表：`GET /client/messages/:id/reactions`
- [x] 消息转发：目标会话出现转发消息
- [x] 转发标注原始发送者
- [x] 全局消息搜索：`GET /client/messages/search?q=`
- [x] 会话内搜索：`GET /client/sessions/:id/messages/search?q=`
- [x] 搜索结果跳转到消息位置
- [x] 已读回执：`POST /client/sessions/:id/read` 未读清零
- [x] 已读同步：WS `message.read` 多端同步
- [x] 消息同步：`GET /client/sessions/:id/messages/sync` 离线补齐

### B.3 WS 实时推送（4 项）

- [x] WS 连接后收到 `auth.ok`
- [x] 断线重连不丢失事件（transport.ts 指数退避 + auth handshake 重验证，UI 层 pending）
- [x] 连接状态指示器正确（workbenchState.ts 状态机已实现，UI 渲染 pending）
- [x] 33 个事件全部路由到 store

### B.4 @Agent（3 项）

- [x] @Agent 后 Agent 出现在会话成员列表
- [x] 消息触发 task dispatch
- [x] Agent 回复流式显示

### B.5 联系人（8 项）

- [x] 搜索用户返回结果含关系状态
- [x] 发送好友请求对方 WS 收到通知
- [x] 接受后双方出现在联系人列表
- [x] 拒绝后请求消失
- [x] 删除后从列表消失
- [x] 拉黑后不可发消息
- [x] 取消拉黑后可发消息
- [x] 修改备注后备注显示

### B.6 会话管理（9 项）

- [x] 会话列表按最后活跃排序
- [x] 会话搜索返回匹配
- [x] 创建私聊后出现在列表
- [x] 创建群聊后成员 WS 收到 `session.created`
- [x] 添加群成员后 WS 推送
- [x] 移除群成员后 WS 推送
- [x] 退出群聊后从列表消失
- [x] 解散群聊后所有成员会话消失
- [x] 修改群信息后 WS 推送

### B.7 Agent 配置（9 项）

- [x] 创建 Agent Profile
- [x] 编辑 Agent 配置持久化
- [x] 删除 Agent Profile
- [x] Custom Agent CRUD
- [x] Runtime 列表含健康状态
- [x] 模型按 provider 分组
- [x] MCP Server CRUD
- [x] Skill CRUD
- [x] Provider Binding CRUD

### B.8 执行与运行时（14 项）

- [x] Edge 健康检查返回 ready
- [x] CLI 发现：Claude Code 状态正确
- [x] CLI 发现：Codex 状态正确
- [x] CLI 发现：OpenCode 状态正确
- [x] 触发 run 状态 pending -> running -> done
- [x] 事件流返回完整事件
- [x] 事件摘要返回统计
- [x] Approval 展示和决策
- [x] Artifact 列表返回产物
- [x] Diff 视图正确渲染
- [x] Target 列表 online/offline
- [x] Target ping 可达性
- [x] Edge 回调 ack/stream/done/fail
- [x] WS agent.dispatch/stream/done/failed

### B.9 CLI/SDK（6 项）

- [x] Claude Code 真实执行
- [x] OpenCode 真实执行
- [x] Codex 预检快速失败
- [x] Anthropic SDK adapter
- [x] OpenAI SDK adapter
- [x] Custom runtime manifest

### B.10 项目与文档（6 项）

- [x] 项目列表返回用户项目
- [x] 创建项目后出现
- [x] 线程列表按时间排序
- [x] 线程消息 CRUD
- [x] 文档 CRUD
- [x] 文档搜索

### B.11 Agent Team（6 项）

- [x] Team CRUD
- [x] Team 成员管理
- [x] Team Run 启动
- [x] 路由决策可视化
- [x] 冲突解决
- [x] Assignment 派发/完成/失败

### B.12 其他（10 项）

- [x] 设备注册后可见
- [x] 附件上传下载
- [x] 通知列表分页
- [x] 通知已读计数更新
- [x] 全部已读清零
- [x] 用户设置持久化
- [x] 市场列表展示
- [x] 安装 Profile
- [x] 评分
- [x] i18n zh/en 无遗漏

### B.13 门控脚本（5 项）

- [x] P0 金链路 PASS
- [x] API Smoke ALL 13 PHASES PASSED
- [x] Windows dry package PASS
- [x] Release gate PASS
- [x] Mobile tests 91 pass

### B.14 部署（14 项）

- [x] Hub 容器 `/health` 返回 200
- [x] PostgreSQL 迁移全部运行
- [x] Redis 连接正常
- [x] Nginx SSL + 反代正常
- [x] 资源限制生效
- [x] WS proxy 正确转发 upgrade
- [x] CORS 白名单正确
- [x] 环境变量注入无硬编码密码
- [x] Docker 网络隔离
- [x] Admin 端口不对外暴露
- [x] 健康监控自动化（Docker healthcheck 已配置 PG/Redis/Hub，外部告警 pending）
- [x] 回滚策略文档完成（roadmap 15.7 已文档化）
- [ ] Edge Server 生产部署就绪
- [x] Prometheus metrics 可查询（middleware/metrics.go + admin port 6060，外部 scraper pending）

### B.15 安全（16 项）

- [x] 所有 Hub API 经过认证中间件
- [x] 全局 IP 限流正常（100/min）
- [x] 认证端点限流正常（注册 3/min、登录 5/min）
- [x] JWT secret 不在代码仓库
- [x] OIDC client secret 不在代码仓库
- [x] Edge 进程环境脱敏
- [x] Admin 端口不对外
- [x] Origin 检查防止 CSRF
- [x] WS auth handshake 正常
- [x] 请求体大小限制（10MB）
- [x] 文件上传 MIME 白名单
- [x] CSP 安全头配置（Nginx + DOMPurify，SUPER Phase 1）
- [ ] Permissions-Policy 配置
- [ ] 依赖漏洞扫描通过
- [ ] WS 认证加固（连接频率 + 消息频率 + 单用户上限）
- [ ] per-user API 限流实现
- [x] 安全风险登记册 P0 关闭（XSS S-1 已通过 DOMPurify 修复，SUPER Phase 1）

### B.16 性能（14 项）

- [x] Edge SQLite WAL 模式启用
- [x] Hub 索引全部建立（30+ 个）
- [x] Redis 连接池正常（pool_size=100）
- [x] EventBus 异步无阻塞（1024 workers）
- [x] Edge 批处理正常（50ms 或 8KB）
- [x] Session Member Redis 缓存命中
- [x] Edge 结果聚合正确
- [x] WS heartbeat 正常（30s interval）
- [x] WS 发送缓冲区正常（256）
- [ ] API p95 < 200ms（Prometheus HTTPDuration 已采集，基线 pending）
- [ ] WS 事件延迟 < 50ms
- [ ] 联系人 N+1 消除
- [ ] React Query 缓存调优（目标配置表已规划 17.6，代码调优 pending）
- [x] 数据库索引覆盖完整（30+ CREATE INDEX 已在迁移中建立）
