# AgentHub 全链路数据对接路线图

> 最后更新：2026-06-10
> 本文档只写路线、优先级和边界。当前分支状态和任务调度写在 `STATE.md`。
> 验收标准：发布 Release，完成全部真实数据流打通。非必要不碰 UI 层，UI 作为需求文档。

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
              ├── src/hubEvents.ts  26 个 WS 事件常量
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

### 1.5 WebSocket 事件合同（26 个事件常量）

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
| `NOTIFICATION_NEW` | `notification.new` | S->C | 新通知 |
| `FRIEND_REQUEST` | `friend.request` | S->C | 好友请求 |
| `FRIEND_ACCEPTED` | `friend.accepted` | S->C | 好友请求被接受 |

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
| **Hub WS 事件类型** | `app/shared/src/hubEvents.ts` | 26 个事件常量 |
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
| | `hub-server/migrations/` | 49 个迁移文件 |
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
| **验证脚本** | `tests/scripts/verify-real-api-smoke.ps1` | 44/44 断言真实 API smoke |
| | `tests/scripts/verify-p0-approved-real-gold-path.ps1` | P0 金链路验证 |
| | `tests/scripts/verify-approved-real-demo-readiness.ps1` | Approved-real 准备度 |
| | `scripts/verify-token-dance-id-login-readiness.ps1` | OIDC 登录准备度 |
| | `scripts/verify-release-gate.ps1` | 发布门控 |
| | `scripts/verify-tauri-package-dry.ps1` | Tauri 打包验证 |
| **E2E** | `app/e2e/chat-real.spec.ts` | 9 个 Playwright 真实 API 测试 |

---

## 2. 当前状态总览

### 2.1 已完成能力

| 模块 | 能力 | 完成标志 |
|------|------|---------|
| **Web/Desktop 共享 workbench** | 7 个子页（chat/contacts/docs/agents/runs/projects/settings）全部有 UI + mock 数据 | WorkbenchRoutes.tsx 完整 |
| **Hub Server** | 49 个迁移全部运行，100+ REST 端点 + WebSocket | `router.go` 完整注册 |
| **Edge Server** | SQLite durable store, 种子数据, fixture adapter | `edge-server/internal/` |
| **Hub REST 客户端 (Web)** | `hubClient.ts` 全端点 typed 方法 | 所有 `request<T>()` 方法已实现 |
| **Hub REST 客户端 (Desktop)** | `hubClient.ts` 全端点 typed 方法，含 streamTaskEvent、Reaction CRUD | 所有方法已实现 |
| **Hub React Query hooks (Web)** | contactQueries/agentQueries/projectQueries/runQueries/executionTargetQueries/agentTeamQueries/threadQueries | 所有 mutation/query hooks |
| **Hub React Query hooks (Desktop)** | hubQueries/sessionQueries/agentProfileQueries/documentQueries/projectQueries/agentQueries/runQueries/runEvidenceQueries/agentTeamQueries/modelCatalogQueries | 含 getToken 认证注入 |
| **Hub WS 客户端 (Web)** | `hubWS.ts` auth handshake + typed events + exponential backoff | 连接状态 store 已实现 |
| **Hub WS 客户端 (Desktop)** | `hubWS.ts` + workbench model 实时缓存失效 | 接入 React Query |
| **Hub WS 事件类型** | `hubEvents.ts` 26 个事件常量 | 完整 |
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
| **E2E Smoke** | `verify-real-api-smoke.ps1` 44/44 通过 | Hub/Edge/Auth/Contacts/Sessions/Documents/Runs |
| **E2E Playwright** | `chat-real.spec.ts` 9 个测试（Hub API + Edge API + Web UI） | Playwright |
| **Hub API 验证** | 16/20 端点返回 200，含 contacts/sessions/messages/documents/WebSocket | 真实 HTTP 测试 |
| **Desktop Tauri packaging** | Unsigned NSIS + portable zip + sidecar + manifest hash | `verify-tauri-package-dry.ps1` |
| **Mobile RN** | 89 tests pass, Hub contracts aligned | `corepack pnpm --dir app/mobile-rn verify` |
| **i18n** | zh + en 两个 locale 文件 | `app/shared/src/i18n/` |
| **Demo 模式** | 10 个会话各有独立 transcript, evidence, preview | mock data |
| **Windows release dry gate** | SHA-256 manifests, CI green | release gate |

### 2.2 未接通缺口

| 缺口 | 影响 | 阻塞原因 |
|------|------|---------|
| TokenDanceID 真实登录 | 所有 Hub 功能需要 auth token | 缺 OIDC env 变量和 TokenDanceID 端 OAuth client |
| Hub WS 实时推送全量路由 | 26 个事件到 store 的完整路由未全部验证 | 需要 auth token + 全事件路由 |
| 通讯录前端->Hub API 实时 | WS 事件驱动的联系人实时更新未验证 | 需要 auth token |
| 聊天前端->Hub API 端到端 | chatActions 已接线但 WS message.new 到 transcript 追加需验证 | 需要 auth token |
| Agent 配置页->Hub/Edge API | Agent Profile hooks 存在但实时同步未验证 | 需要 Edge 连接 |
| 云文档->Hub API | documentQueries 存在但全文预览未接入 | 需要 auth token |
| 设置页->settingsService | Hub GET/PATCH 已实现但前端未使用 settingsService | 需要 auth token + 接线 |
| 项目页->Hub Projects API | hubQueries workspace-projects 存在 | 需要 auth token |
| @Agent 真实调用 CLI | Composer mention 未触发 Edge run | 需要 approved-real |
| Codex CLI 真实执行 | 适配器已实现，缺 `OPENAI_API_KEY` | 需要 API key |
| SDK 真实 API 消耗 | SDK adapter 已实现，缺 API key | 需要 API key |
| Mobile->真实 Hub API | Mobile 组件存在但 Hub queries 未全部接入 | 需要 auth token |
| E2E 全链路测试 | 只有 smoke + Playwright，无完整 UI 数据流测试 | 需要 auth + Hub+Edge 启动 |
| Artifact/Diff 真实 apply/revert | 只读 diff 可展示，写文件未实现 | 需要审批 |
| Agent Team 实时运行 | Team Run 实时编排状态推送未验证 | 需要 Edge 连接 |

---

## 3. 认证与身份

### 3.1 当前状态

- Hub OIDC handler 已实现（`PostOIDCAuthorize`/`PostOIDCCallback`/`GetOIDCCallback`）
- Desktop PKCE + loopback callback 代码已存在
- Web OIDC redirect callback 代码已存在
- Hub JWT session 签发已实现
- Token storage 已实现（Web + Desktop）
- 当前通过 JWT secret 直接签发 dev token 进行测试

### 3.2 API 端点

| 端点 | 方法 | 用途 |
|------|------|------|
| `/client/auth/oidc/authorize` | POST | 发起 OIDC authorize（PKCE code_challenge） |
| `/client/auth/oidc/callback` | POST | OIDC code exchange（code + code_verifier） |
| `/client/auth/oidc/callback` | GET | 浏览器 redirect callback |
| `/client/auth/refresh` | POST | 刷新 access token |
| `/client/auth/me` | GET | 获取当前用户信息 |
| `/client/auth/logout` | POST | 注销 session |
| `/client/auth/profile` | PUT | 更新用户 profile（昵称、头像） |

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

### 3.4 步骤

1. 配置 Hub Server 环境变量：`AGENTHUB_TDID_LOGIN_ISSUER_URL`、`AGENTHUB_TDID_LOGIN_CLIENT_ID`、`AGENTHUB_TDID_LOGIN_CLIENT_SECRET`
2. 在 TokenDanceID 注册 OAuth client，设置 redirect URIs（Desktop loopback + Web URL）
3. 验证 Desktop PKCE 流程：`shell.open()` -> TokenDanceID authorize -> loopback -> Hub exchange -> JWT
4. 验证 Web redirect 流程：browser redirect -> Hub exchange -> JWT
5. 验证 token refresh：access token 过期前自动 refresh
6. 验证 logout：session 失效
7. 运行 `verify-token-dance-id-login-readiness.ps1` 确认 `READY_FOR_OPERATOR`

### 3.5 验收标准

- [ ] Desktop 真实 OIDC 登录成功，`GET /client/auth/me` 返回用户信息
- [ ] Web 真实 OIDC 登录成功，`GET /client/auth/me` 返回用户信息
- [ ] `verify-token-dance-id-login-readiness.ps1` 输出 `READY_FOR_OPERATOR`
- [ ] 登录后 Hub WS 连接成功，收到 `auth.ok`
- [ ] Logout 后 session 失效，所有 API 返回 401
- [ ] Access token 过期前自动 refresh，用户无感知
- [ ] Profile 更新：`PUT /client/auth/profile` 后头像和昵称同步更新
- [ ] Avatar 上传：`POST /client/attachments` 上传后 `GET /client/auth/me` 返回新 URL

---

## 4. IM 聊天系统

### 4.1 当前状态

- Web `useWebWorkbenchModel` 已实现 10 个 chat actions
- Desktop `useDesktopWorkbenchModel` 已实现 6 个 chat actions
- Web/Desktop `hubClient.ts` 已实现全部消息方法
- Hub REST 全部消息端点已实现
- Hub WS 5 个消息事件已定义
- 自动已读回执已实现
- Desktop `sessionQueries.ts` 方法签名已修复

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

### 4.4 步骤

1. 验证 auth token 后 `hubClient.sendMessage()` REST 调用成功
2. 验证 WS `message.new` 事件到达前端并追加到 transcript
3. 验证 `recallMessage` REST + WS `message.recall` 推送
4. 验证 `editMessage` REST + "已编辑"标记
5. 验证 `pinMessage`/`unpinMessage` REST + WS 推送
6. 验证 `addMessageReaction`/`removeMessageReaction` + 计数更新
7. 验证 `forwardMessage` REST + 目标会话消息
8. 验证 `searchMessages`/`searchSessionMessages` REST 返回
9. 验证 `markRead` REST + 未读计数清零 + WS `message.read`
10. 验证 `syncMessages` REST + 离线消息补齐
11. 验证 WS 断线重连不丢失事件
12. 验证 `client_msg_id` 去重

### 4.5 验收标准

- [ ] 发送文本消息，其余在线成员通过 WS 实时收到
- [ ] 消息列表按 `seq_id` 排序
- [ ] 重复 `client_msg_id` 不产生重复消息
- [ ] 撤回成功后 UI 显示"消息已撤回"
- [ ] 超时撤回返回错误
- [ ] 非发送者撤回返回 403
- [ ] WS 撤回推送后所有客户端同步
- [ ] 编辑后内容更新并显示"已编辑"标记
- [ ] 非发送者编辑返回 403
- [ ] Pin 后出现在 pinned 列表
- [ ] Unpin 后从列表移除
- [ ] WS Pin/Unpin 同步到所有在线成员
- [ ] 添加 reaction 后 emoji 计数更新
- [ ] 移除 reaction 后计数更新
- [ ] 转发成功后目标会话出现转发消息
- [ ] 转发消息标注原始发送者
- [ ] 搜索返回匹配消息列表
- [ ] 点击搜索结果跳转到消息位置
- [ ] 进入会话后未读计数清零
- [ ] 多端同步已读状态
- [ ] 离线后上线增量同步补齐未读消息
- [ ] 不重复拉取
- [ ] WS 断线重连后不丢失事件
- [ ] 连接状态指示器正确

---

## 5. 联系人系统

### 5.1 当前状态

- Hub REST 完整联系人 API 已实现
- Web `contactQueries.ts` 所有 mutation hooks 已实现
- Desktop `hubClient.ts` 联系人方法已实现
- `WorkbenchContactsActions` 接口已定义（9 个回调）
- WS `friend.request`/`friend.accepted` 已定义

### 5.2 API 端点

| 端点 | 方法 | 用途 |
|------|------|------|
| `/client/contacts/search` | GET | 搜索用户 |
| `/client/contacts/friend-requests` | GET/POST | 好友请求列表/发送 |
| `/client/contacts/friend-requests/:id/accept` | POST | 接受 |
| `/client/contacts/friend-requests/:id/reject` | POST | 拒绝 |
| `/client/contacts` | GET | 联系人列表 |
| `/client/contacts/:user_id` | DELETE | 删除联系人 |
| `/client/contacts/:user_id/block` | POST | 拉黑 |
| `/client/contacts/:user_id/unblock` | POST | 取消拉黑 |
| `/client/contacts/:user_id/remark` | PUT | 修改备注 |
| `/client/sessions/group` | POST | 创建群聊 |

### 5.3 需要对接的文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `app/web/src/api/contactQueries.ts` | 验证 | React Query hooks 已实现 |
| `app/desktop/src/api/hubClient.ts` | 验证 | Desktop 联系人方法已实现 |
| `app/shared/src/workbench/WorkbenchRoutes.tsx` | 验证 | `contactsActions` prop 已接线 |

### 5.4 步骤

1. 验证 `searchUser` REST 返回匹配用户及关系状态
2. 验证 `sendFriendRequest` REST 后对方 WS 收到 `friend.request`
3. 验证 `acceptFriendRequest` REST 后双方联系人更新，WS `friend.accepted`
4. 验证 `rejectFriendRequest` REST 后请求消失
5. 验证 `removeContact`/`blockContact`/`unblockContact`/`updateRemark` REST
6. 验证 `createGroupSession` REST 后 WS `session.created`

### 5.5 验收标准

- [ ] 搜索返回匹配用户，显示关系状态
- [ ] 发送请求后对方 WS 实时收到通知
- [ ] 接受后双方出现在联系人列表
- [ ] 拒绝后请求消失
- [ ] 删除后从列表消失
- [ ] 拉黑后不可发消息
- [ ] 备注名优先显示
- [ ] 创建群聊后所有成员 WS 收到 `session.created`

---

## 6. Agent 配置系统

### 6.1 当前状态

- Hub REST Custom Agent CRUD + Agent Profile CRUD + publish + install 已实现
- Web/Desktop Agent Profile hooks 已实现
- Agent 合并策略已实现
- `WorkbenchAgent` 接口完整字段已定义
- `workbenchAgentToAgentConfig` 映射已实现
- `AgentsPage` 有 CRUD 回调

### 6.2 API 端点

| 端点 | 方法 | 用途 |
|------|------|------|
| `/web/custom-agents` | GET/POST | Custom Agent 列表/创建 |
| `/web/custom-agents/:id` | PUT/DELETE | Custom Agent 更新/删除 |
| `/web/agent-profiles` | GET/POST | Agent Profile 列表/创建 |
| `/web/agent-profiles/:id` | GET/PATCH/DELETE | Agent Profile 操作 |
| `/web/agent-profiles/:id/publish` | POST | 发布到市场 |
| `/web/agent-profiles/:id/install` | POST | 从市场安装 |
| `/web/skills` | GET/POST | Skill CRUD |
| `/web/mcp-servers` | GET/POST | MCP Server CRUD |
| `/web/provider-bindings` | GET/POST | Provider Binding CRUD |
| `/v1/runners` | GET | Runtime 列表 |
| `/v1/model-catalog` | GET | 模型目录 |

### 6.3 需要对接的文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `app/web/src/api/agentQueries.ts` | 验证 | Agent Profile CRUD hooks |
| `app/desktop/src/api/agentProfileQueries.ts` | 验证 | Desktop Agent Profile hooks |
| `app/desktop/src/api/modelCatalogQueries.ts` | 验证 | 模型目录 |
| `app/web/src/api/executionTargetQueries.ts` | 验证 | 执行目标 |

### 6.4 步骤

1. 验证 `listAgentProfiles` REST 返回 Profile 列表
2. 验证 `createAgentProfile`/`updateAgentProfile`/`deleteAgentProfile` CRUD
3. 验证 Edge `/v1/runners` runtime 列表
4. 验证 Edge `/v1/model-catalog` 模型列表
5. 验证 Hub `/web/execution-targets` 目标列表
6. 验证 MCP Server / Skill / Provider Binding CRUD

### 6.5 验收标准

- [ ] 创建 Agent Profile 后出现在列表
- [ ] 编辑 Agent 配置持久化
- [ ] 删除后从列表消失
- [ ] Runtime 列表含健康状态
- [ ] 模型按 provider 分组
- [ ] Target 展示 online/offline
- [ ] MCP Server 可被 Agent 引用
- [ ] Tool allowlist 限制可调用工具
- [ ] Profile 发布后出现在市场
- [ ] Profile 安装后出现在用户列表

---

## 7. 云文档系统

### 7.1 当前状态

- Hub REST `/web/documents` 完整 CRUD 已实现
- `model.Document` + `repository.Document` 数据层已完成
- `WorkbenchDocumentsActions` 接口已定义
- Web/Desktop `documentQueries.ts` hooks 已创建
- 轻量文档预览已实现

### 7.2 API 端点

| 端点 | 方法 | 用途 |
|------|------|------|
| `/web/documents` | GET | 文档列表（分页） |
| `/web/documents` | POST | 创建文档 |
| `/web/documents/:id` | GET/PATCH/DELETE | 文档详情/更新/删除 |

### 7.3 需要对接的文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `app/desktop/src/api/documentQueries.ts` | 验证 | Desktop 文档 CRUD hooks |
| `hub-server/internal/handler/document.go` | 无变更 | 全部已实现 |

### 7.4 步骤

1. 验证 `listDocuments` REST 返回分页列表
2. 验证 `createDocument`/`updateDocument`/`deleteDocument` CRUD
3. 验证文档搜索
4. 验证文档预览

### 7.5 验收标准

- [ ] 文档列表分页加载
- [ ] 创建/编辑/删除同步
- [ ] 文档搜索返回结果
- [ ] 文档预览正确显示
- [ ] 文档关联项目

---

## 8. 设置系统

### 8.1 当前状态

- Hub REST `GET/PATCH /client/settings` 已实现
- `settingsService.ts` 抽象已实现
- Desktop Settings 三层回退已实现
- `SettingsPort` 接口已定义
- `handleSettingChange` 已调用 `settingsService.write()`

### 8.2 API 端点

| 端点 | 方法 | 用途 |
|------|------|------|
| `/client/settings` | GET | 获取所有用户设置 |
| `/client/settings` | PATCH | 部分更新用户设置 |

### 8.3 步骤

1. 验证 `GET /client/settings` 返回用户偏好
2. 验证 `PATCH /client/settings` 持久化
3. 验证 `settingsService.init()/subscribe()/write()` 全链路
4. 验证 Desktop 三层回退

### 8.4 验收标准

- [ ] 修改主题后 Hub 记录偏好，刷新后保持
- [ ] 登录后 Hub 设置覆盖本地默认
- [ ] Desktop workspace allowlist 双写
- [ ] 换 Desktop 登录后偏好可恢复
- [ ] settingsService subscribe 响应远程变更

---

## 9. 项目管理系统

### 9.1 当前状态

- Hub REST workspace + threads + messages API 已实现
- Web/Desktop `projectQueries.ts` + `threadQueries.ts` hooks 已实现
- `ProjectsPage` 有 CRUD 回调

### 9.2 API 端点

| 端点 | 方法 | 用途 |
|------|------|------|
| `/web/projects` | GET/POST | 项目列表/创建 |
| `/web/projects/:id` | GET/PATCH | 项目详情/更新 |
| `/web/projects/:id/threads` | GET/POST | 线程列表/创建 |
| `/web/projects/:id/threads/:threadId/messages` | GET/POST | 线程消息 |

### 9.3 步骤

1. 验证 `listWorkspaceProjects` REST
2. 验证 `createWorkspaceProject`/`updateWorkspaceProject`
3. 验证 `listWorkspaceProjectThreads`/`createWorkspaceProjectThread`
4. 验证线程消息 CRUD

### 9.4 验收标准

- [ ] 项目列表展示 Hub 项目
- [ ] 创建项目后出现在列表
- [ ] 线程列表按时间排序
- [ ] 线程内消息实时更新
- [ ] 项目产物预览正确显示

---

## 10. 执行与运行时

### 10.1 当前状态

- Hub REST Agent Task 全链路已实现
- Edge REST Run lifecycle 已实现
- 6 个 Adapters 已实现（Claude Code/Codex/OpenCode/Anthropic SDK/OpenAI SDK/Fixture）
- Claude Code + OpenCode 真实执行已验证
- Codex PreflightAdapter 快速失败已实现
- SDK HTTP SSE adapters 已实现
- `verify-real-api-smoke.ps1` 44/44 通过

### 10.2 API 端点

| 端点 | 方法 | 用途 |
|------|------|------|
| `/web/agent-tasks` | POST | 触发任务 |
| `/web/agent-tasks/:id/cancel` | POST | 取消任务 |
| `/web/agent-tasks/:id/summary` | GET | 事件摘要 |
| `/web/agent-tasks/:id/events` | GET | 事件列表 |
| `/web/agent-tasks/:id/approvals` | GET | 审批列表 |
| `/web/agent-tasks/:id/approvals/:approval_id/decide` | POST | 审批决策 |
| `/web/agent-tasks/:id/artifacts` | GET | 产物列表 |
| `/web/execution-targets` | GET/POST | 执行目标 CRUD |
| `/web/execution-targets/:id/ping` | POST | Ping |
| `/edge/agent-tasks/:id/ack` | POST | Edge 确认 |
| `/edge/agent-tasks/:id/stream` | POST | Edge 流式上报 |
| `/edge/agent-tasks/:id/done` | POST | Edge 完成 |
| `/edge/agent-tasks/:id/fail` | POST | Edge 失败 |
| `/v1/health` | GET | Edge 健康检查 |

### 10.3 步骤

1. 验证 Edge `/v1/health`
2. 验证 CLI 发现状态
3. 验证执行目标列表和 ping
4. 验证 `triggerAgentTask` -> Hub -> Edge -> Adapter -> 事件流
5. 验证 Run 状态变化
6. 验证 Approval 工作流
7. 验证 Artifact/Diff 展示
8. 验证 CLI/SDK 真实执行

### 10.4 验收标准

- [ ] Edge 健康检查返回 ready
- [ ] CLI 发现状态正确
- [ ] 触发 run 后状态 pending -> running -> done
- [ ] 事件流返回完整事件
- [ ] Approval 展示和决策
- [ ] Artifact 列表和 Diff 渲染
- [ ] Target 列表 online/offline
- [ ] Target ping 可达性
- [ ] Claude Code 真实执行
- [ ] OpenCode 真实执行
- [ ] Codex 预检快速失败
- [ ] Anthropic SDK HTTP SSE
- [ ] OpenAI SDK HTTP SSE

---

## 11. Agent Team 编排

### 11.1 当前状态

- Hub REST 完整 AgentTeam API 已实现
- Web/Desktop `agentTeamQueries.ts` hooks 已实现
- 群聊编排 fixture 已合入

### 11.2 API 端点

| 端点 | 方法 | 用途 |
|------|------|------|
| `/web/agent-teams` | GET/POST | Team CRUD |
| `/web/agent-teams/:id` | GET/PUT/DELETE | Team 操作 |
| `/web/agent-teams/:id/members` | POST | 添加成员 |
| `/web/agent-teams/:id/runs` | GET/POST | Run 列表/启动 |
| `/web/agent-teams/:id/runs/:run_id/state` | GET | Run 完整状态 |
| `/web/agent-teams/:id/runs/:run_id/tasks` | GET | 任务列表 |
| `/web/agent-teams/:id/runs/:run_id/route-decisions` | POST | 路由决策 |
| `/web/agent-teams/:id/runs/:run_id/approvals/:approval_id/decide` | POST | 审批决策 |
| `/web/agent-teams/:id/runs/:run_id/conflicts/:conflict_id/resolve` | POST | 冲突解决 |
| `/web/agent-teams/:id/runs/:run_id/assignments` | GET/POST | Assignment |

### 11.3 验收标准

- [ ] Team CRUD
- [ ] Team 成员管理
- [ ] Team Run 启动
- [ ] 路由决策可视化
- [ ] 冲突解决
- [ ] Assignment 派发/完成/失败

---

## 12. SDK 与 CLI 接入

### 12.1 CLI 接入

| CLI | 命令格式 | Edge adapter | 真实执行路径 |
|-----|----------|-------------|------------|
| Claude Code | `claude --output-format stream-json` | `claude_code.go` | `exec.Command` -> stdout NDJSON parse |
| Codex | `codex exec --json` | `codex.go` | 预检 `OPENAI_API_KEY` -> `exec.Command` |
| OpenCode | `opencode run --format json` | `opencode.go` | `exec.Command` -> stdout JSON parse |

### 12.2 SDK 接入

| SDK | Edge adapter | 真实执行路径 |
|-----|-------------|------------|
| Anthropic SDK | `anthropic_sdk.go` | `--anthropic-sdk-path` -> `net/http` POST `api.anthropic.com/v1/messages` -> SSE |
| OpenAI SDK | `openai_sdk.go` | `--openai-sdk-path` -> `net/http` POST `api.openai.com/v1/chat/completions` -> SSE |
| Custom runtime | `runtime_manifest.go` | JSON manifest 定义 adapter 配置 |

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

- [ ] Claude Code 真实执行产出 typed events
- [ ] OpenCode 真实执行产出 typed events
- [ ] Codex 缺 API key 快速失败
- [ ] Anthropic SDK HTTP SSE 流式调用
- [ ] OpenAI SDK HTTP SSE 流式调用
- [ ] 进程生命周期由 Edge lifecycle 管理
- [ ] stdout/stderr 合并批处理（50ms 或 8KB）
- [ ] 权限请求映射到 approval 流
- [ ] SDK event 映射到统一 RunEvent 合同

---

## 13. 多平台对齐

### 13.1 Mobile RN

#### 当前状态

- 89 tests pass, Hub contracts aligned
- 只按 Hub 合同对齐，不分叉 runtime 或登录语义
- Android APK 未产出

#### 验收标准

- [ ] 登录后看到与 Web 相同会话列表
- [ ] 可 approve/deny 审批
- [ ] WS 事件实时到达
- [ ] Android APK 构建产出

### 13.2 Desktop Tauri

#### 当前状态

- Windows unsigned package 已产出
- Desktop 共享 Web workbench UI
- Desktop 全端点 hooks 已实现
- Desktop chatActions 已接线

#### 验收标准

- [ ] Desktop 通过 Local Edge 执行 run
- [ ] Edge 健康状态在 UI 显示
- [ ] Windows unsigned package hash 一致
- [ ] sidecar 正确放置
- [ ] macOS unsigned path 拆清

### 13.3 i18n

#### 验收标准

- [ ] 所有页面 zh/en 完整无遗漏字符串
- [ ] 术语翻译统一

---

## 14. E2E 测试与发布

### 14.1 当前测试覆盖

| 测试类型 | 位置 | 状态 |
|---------|------|------|
| API Smoke (13 phases) | `verify-real-api-smoke.ps1` | **✅ 95+/96 通过**（1 失败：MSG_NOT_EDITABLE 消息编辑窗口策略） |
| Playwright E2E | `chat-real.spec.ts` | 9 个测试（8 pass, 1 skip） |
| Hub Unit Tests | `hub-server/*_test.go` | 通过 |
| Edge Unit Tests | `edge-server/*_test.go` | 通过 |
| Web/Shared Tests | `app/web/`/`app/shared/` | 通过 |
| Mobile RN | `app/mobile-rn/` | 91 tests 通过 |
| P0 Gold Path | `verify-p0-approved-real-gold-path.ps1` | PASS |
| Tauri Package | `verify-tauri-package-dry.ps1` | PASS |
| Release Gate | `verify-release-gate.ps1` | PASS |

### 14.2 需要补全的测试

1. ~~完整 IM 数据流测试：send -> WS push -> transcript -> recall/edit/pin/reaction~~ ✅ 已补全（smoke test phases 8a-8j）
2. ~~联系人全链路测试：search -> friend-request -> accept -> list -> block -> remark~~ ✅ 已补全（smoke test phases 9a-9h）
3. ~~Agent 配置全链路测试：create profile -> update -> delete -> runtime/model~~ ✅ 已补全（smoke test phases 10a-10d）
4. ~~云文档全链路测试：create -> update -> delete -> search -> preview~~ ✅ 已补全（smoke test phases 4c-4f）
5. ~~项目全链路测试：create -> thread -> message -> artifact preview~~ ✅ 已补全（Edge phases 5-7）
6. ~~执行全链路测试：trigger -> Edge run -> event stream -> approval -> artifact -> diff~~ ✅ 已补全（smoke test phases 5、13）
7. Team 编排测试：create team -> add members -> start run -> route -> conflict ⏳
8. 多端同步测试：Web + Desktop 同一账号同步 ⏳
9. ~~认证全链路测试：OIDC login -> me -> refresh -> logout -> 401~~ ✅ OIDC authorize 已验证
10. SDK adapter 测试：Anthropic/OpenAI HTTP SSE ⏳（阻塞于 API key）
11. WebSocket 实时推送测试 ⏳（`ws` npm 模块缺失）

### 14.3 验收标准

- [ ] Release gate 全绿
- [ ] Changelog 包含所有变更
- [ ] 无 open Critical blockers
- [ ] 所有 High 风险有 accepted 或 fixed
- [ ] Windows package hash 一致
- [ ] sidecar 正确放置
- [ ] Mobile tests pass
- [ ] Hub + Edge + Web + Desktop smoke 通过

---

## 15. 依赖顺序

```
Phase 1 (P0): 认证打通
  └─ 3. TokenDanceID 真实登录
     └─ unblocks: 所有 Hub queries, Hub WS

Phase 2 (P1 Core): 核心数据流
  ├─ 4. IM 聊天 -> 10 个 chat actions 全链路
  ├─ 5. 联系人 -> 9 个 contacts actions 全链路
  ├─ 6. Agent 配置 -> Profile CRUD + Runtime/Model
  └─ 8. 设置 -> Hub + Edge 双写

Phase 3 (P1 Extended): 扩展数据流
  ├─ 7. 云文档 -> Document CRUD + Preview
  ├─ 9. 项目 -> Project + Thread + Message
  ├─ 10. 执行 -> Run + Approval + Artifact
  ├─ 11. Team 编排 -> Team Run 全链路
  └─ 13.3 i18n -> en locale 补齐

Phase 4 (P2): 运行时集成
  ├─ 12. CLI -> Claude Code/Codex/OpenCode 真实调用
  ├─ 12. SDK -> Anthropic/OpenAI API 消耗
  └─ 13.1 Mobile -> Hub API + OIDC deep-link

Phase 5 (P3): 发布
  ├─ 13.2 Desktop Tauri -> 签名 + 打包
  ├─ 14. E2E -> 全流程自动化
  └─ 14. Release -> changelog + gate + rollback
```

---

## 16. 验证清单

> 以下每项必须通过对应的 E2E 测试或手动验证证明集成可用。

### 16.1 认证与身份（8 项）

- [ ] TokenDanceID OIDC 登录（Desktop PKCE）：`GET /client/auth/me` 返回用户信息
- [ ] TokenDanceID OIDC 登录（Web redirect）：`GET /client/auth/me` 返回用户信息
- [ ] Session refresh：access token 过期前自动 refresh
- [ ] Logout：`POST /client/auth/logout` 后所有 API 返回 401
- [ ] Profile 更新：`PUT /client/auth/profile` 后昵称和头像同步
- [ ] Avatar 上传：`POST /client/attachments` 后头像 URL 更新
- [ ] `verify-token-dance-id-login-readiness.ps1` 输出 `READY_FOR_OPERATOR`
- [ ] 登录后 Hub WS 连接收到 `auth.ok`

### 16.2 IM 聊天（24 项）

- [ ] 消息发送：`POST /client/sessions/:id/messages` + WS `message.new`
- [ ] 消息接收：WS `message.new` -> transcript
- [ ] 消息去重：重复 `client_msg_id` 不重复
- [ ] 消息列表按 `seq_id` 排序
- [ ] 消息撤回：`POST /client/messages/:id/recall` -> "已撤回"
- [ ] 撤回超时返回错误
- [ ] 撤回权限：非发送者返回 403
- [ ] 撤回 WS 同步：所有客户端同步
- [ ] 消息编辑：`PUT /client/messages/:id` -> "已编辑"
- [ ] 编辑权限：非发送者返回 403
- [ ] 消息 Pin：`POST /client/messages/:id/pin` -> pinned 列表更新
- [ ] 消息 Unpin：`DELETE /client/messages/:id/pin` -> 列表移除
- [ ] Pin/Unpin WS 同步
- [ ] Reaction 添加：emoji 计数更新
- [ ] Reaction 移除：计数更新
- [ ] Reaction 列表：`GET /client/messages/:id/reactions`
- [ ] 消息转发：目标会话出现转发消息
- [ ] 转发标注原始发送者
- [ ] 全局消息搜索：`GET /client/messages/search?q=`
- [ ] 会话内搜索：`GET /client/sessions/:id/messages/search?q=`
- [ ] 搜索结果跳转到消息位置
- [ ] 已读回执：`POST /client/sessions/:id/read` 未读清零
- [ ] 已读同步：WS `message.read` 多端同步
- [ ] 消息同步：`GET /client/sessions/:id/messages/sync` 离线补齐

### 16.3 WS 实时推送（4 项）

- [ ] WS 连接后收到 `auth.ok`
- [ ] 断线重连不丢失事件
- [ ] 连接状态指示器正确
- [ ] 26 个事件全部路由到 store

### 16.4 @Agent（3 项）

- [ ] @Agent 后 Agent 出现在会话成员列表
- [ ] 消息触发 task dispatch
- [ ] Agent 回复流式显示

### 16.5 联系人（8 项）

- [ ] 搜索用户返回结果含关系状态
- [ ] 发送好友请求对方 WS 收到通知
- [ ] 接受后双方出现在联系人列表
- [ ] 拒绝后请求消失
- [ ] 删除后从列表消失
- [ ] 拉黑后不可发消息
- [ ] 取消拉黑后可发消息
- [ ] 修改备注后备注显示

### 16.6 会话管理（9 项）

- [ ] 会话列表按最后活跃排序
- [ ] 会话搜索返回匹配
- [ ] 创建私聊后出现在列表
- [ ] 创建群聊后成员 WS 收到 `session.created`
- [ ] 添加群成员后 WS 推送
- [ ] 移除群成员后 WS 推送
- [ ] 退出群聊后从列表消失
- [ ] 解散群聊后所有成员会话消失
- [ ] 修改群信息后 WS 推送

### 16.7 Agent 配置（9 项）

- [ ] 创建 Agent Profile
- [ ] 编辑 Agent 配置持久化
- [ ] 删除 Agent Profile
- [ ] Custom Agent CRUD
- [ ] Runtime 列表含健康状态
- [ ] 模型按 provider 分组
- [ ] MCP Server CRUD
- [ ] Skill CRUD
- [ ] Provider Binding CRUD

### 16.8 执行与运行时（14 项）

- [ ] Edge 健康检查返回 ready
- [ ] CLI 发现：Claude Code 状态正确
- [ ] CLI 发现：Codex 状态正确
- [ ] CLI 发现：OpenCode 状态正确
- [ ] 触发 run 状态 pending -> running -> done
- [ ] 事件流返回完整事件
- [ ] 事件摘要返回统计
- [ ] Approval 展示和决策
- [ ] Artifact 列表返回产物
- [ ] Diff 视图正确渲染
- [ ] Target 列表 online/offline
- [ ] Target ping 可达性
- [ ] Edge 回调 ack/stream/done/fail
- [ ] WS agent.dispatch/stream/done/failed

### 16.9 CLI/SDK（6 项）

- [ ] Claude Code 真实执行
- [ ] OpenCode 真实执行
- [ ] Codex 预检快速失败
- [ ] Anthropic SDK adapter
- [ ] OpenAI SDK adapter
- [ ] Custom runtime manifest

### 16.10 项目与文档（6 项）

- [ ] 项目列表返回用户项目
- [ ] 创建项目后出现
- [ ] 线程列表按时间排序
- [ ] 线程消息 CRUD
- [ ] 文档 CRUD
- [ ] 文档搜索

### 16.11 Agent Team（6 项）

- [ ] Team CRUD
- [ ] Team 成员管理
- [ ] Team Run 启动
- [ ] 路由决策可视化
- [ ] 冲突解决
- [ ] Assignment 派发/完成/失败

### 16.12 其他（10 项）

- [ ] 设备注册后可见
- [ ] 附件上传下载
- [ ] 通知列表分页
- [ ] 通知已读计数更新
- [ ] 全部已读清零
- [ ] 用户设置持久化
- [ ] 市场列表展示
- [ ] 安装 Profile
- [ ] 评分
- [ ] i18n zh/en 无遗漏

### 16.13 门控脚本（5 项）

- [ ] P0 金链路 PASS
- [ ] API Smoke 44/44 通过
- [ ] Windows dry package PASS
- [ ] Release gate PASS
- [ ] Mobile tests 89 pass

---

## 17. 非协商边界

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
