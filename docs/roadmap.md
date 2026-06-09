# AgentHub 全链路数据对接路线图

> 2026-06-10 数据流打通进展：见 STATE.md '2026-06-10 数据流打通成果' 段。详细代码变更见 git log。
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
              ├── src/transcript/   统一消息合同
              ├── src/composer/     统一输入区
              ├── src/inspector/    统一证据面板
              ├── src/platform/     Platform Adapter 接口
              └── src/ui/           基础 UI primitives
                        │
         ┌──────────────┴──────────────┐
         │                             │
  Web Platform Adapter         Desktop Platform Adapter
  ├── Hub REST + WS             ├── Local Edge REST + WS
  ├── Hub session               ├── Tauri Host API
  └── remote target             └── sidecar / CLI
                        │
         ┌──────────────┴──────────────┐
         │                             │
    Hub Server (8080)           Edge Server (3210)
    ├── Auth/OIDC/Session       ├── Run lifecycle
    ├── IM/Contacts/Sessions    ├── AgentAdapter
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
                              ├── Claude Agent SDK
                              └── OpenAI Agents SDK
```

### 1.2 数据线

| 线路 | 方向 | 协议 |
|------|------|------|
| 控制线 | Workbench -> Platform Adapter -> Edge/Hub REST -> AgentAdapter -> Runtime | REST JSON |
| 事件线 | Agent Runtime -> Edge EventStore -> Edge/Hub WS -> Platform Adapter -> Transcript | WebSocket typed events |
| 证据线 | RunEvent -> EvidenceRef -> Inspector -> Artifact/File/Preview | REST + WS |
| 同步线 | Edge EventStore -> Hub Sync -> Web/Desktop/Mobile viewers | REST + WS |

### 1.3 三层数据模式

| 模式 | `dataMode` 值 | 特征 | 当前状态 |
|------|-------------|------|---------|
| Demo (mock) | `mock` | JS 内存数据，零依赖 | 已工作 |
| Observed | `observed` | Edge API 只读观察 | 前端查询存在，auth token 问题 |
| Approved-Real | `approved-real` | 真实 Hub+Edge+CLI | 需 TokenDanceID 登录打通 |

### 1.4 关键文件索引

| 区域 | 关键文件 |
|------|---------|
| 共享平台接口 | `app/shared/src/platform/types.ts` — `AgentHubPlatform` |
| Hub REST 客户端 | `app/web/src/api/hubClient.ts` — `createHubClient()` |
| Hub React Query (Web) | `app/web/src/api/contactQueries.ts`、`agentQueries.ts`、`projectQueries.ts`、`runQueries.ts`、`executionTargetQueries.ts`、`agentTeamQueries.ts` |
| Hub WS 客户端 (Web) | `app/web/src/api/hubWS.ts` — auth handshake + typed events + reconnection |
| Hub WS 事件类型 | `app/shared/src/hubEvents.ts` — 26 个事件常量 |
| Edge REST 客户端 | `app/web/src/api/edgeClient.ts` |
| Desktop 数据模型 | `app/desktop/src/platform/useDesktopWorkbenchModel.ts` |
| Desktop Hub Auth | `app/desktop/src/api/hubAuth.ts` — OIDC PKCE |
| Web Auth | `app/web/src/hooks/useAuth.ts`、`app/web/src/api/hubAuth.ts` |
| 共享工作台 | `app/shared/src/workbench/AgentHubWorkbench.tsx` — 主布局 |
| Hub Server 路由 | `hub-server/internal/router/router.go` — 完整路由注册 |
| Hub 消息处理 | `hub-server/internal/handler/message.go` |
| Hub 联系人处理 | `hub-server/internal/handler/contact.go` |
| Hub 会话处理 | `hub-server/internal/handler/session.go` |
| Hub Agent 处理 | `hub-server/internal/handler/agent.go` — task dispatch/stream/approval/artifact |
| Hub OIDC 处理 | `hub-server/internal/handler/oidc.go` |
| Edge Adapters | `edge-server/internal/adapters/` — claude_code.go、codex.go、opencode.go |
| Edge Adapter Registry | `edge-server/internal/adapters/registry.go` |
| API 合同 | `api/openapi.yaml` — REST; `api/events.md` — WS events |

---

## 2. 当前状态总览

### 2.1 已完成能力

| 模块 | 能力 |
|------|------|
| Web/Desktop 共享 workbench | 7 个子页全部有 UI + mock 数据 |
| Hub Server | 49 个迁移全部运行，100+ REST 端点 + WebSocket |
| Edge Server | SQLite durable store, 种子数据, fixture adapter |
| Hub REST 客户端 (Web) | `hubClient.ts` 已实现所有 Hub 端点的 typed 方法 |
| Hub React Query hooks (Web) | `contactQueries.ts` 完整好友/联系人/群组 hooks；`agentQueries.ts`；`projectQueries.ts`；`runQueries.ts`；`executionTargetQueries.ts`；`agentTeamQueries.ts` |
| Hub WS 客户端 (Web) | `hubWS.ts` 已实现 auth handshake、typed event routing、exponential backoff reconnection |
| Hub WS 事件类型 | `hubEvents.ts` 26 个事件常量（auth/message/session/device/agent/notification/friend） |
| Demo 模式 | 10 个会话各有独立 transcript, evidence, preview |
| i18n | zh + en 两个 locale 文件 |
| Hub contacts 端点 | search, list, friend-request (CRUD), block, remark |
| Hub sessions 端点 | create private/group, members, leave, dissolve, info, settings, delete |
| Hub messages 端点 | send, get, sync, recall, edit, pin, reactions, forward, search, markRead |
| Hub documents 端点 | list, get, create, update, delete |
| Hub settings 端点 | GET/PATCH settings |
| Hub agent-tasks 端点 | trigger, cancel, events, approvals, decide, artifacts, summary |
| Hub custom-agents 端点 | list, create, update, delete |
| Hub agent-profiles 端点 | CRUD + publish + install |
| Hub execution-targets 端点 | CRUD + ping |
| Hub agent-teams 端点 | 完整 Team + Run + Route + Approval + Conflict + Assignment |
| Hub skills/mcp/provider-bindings/market/audit/relay 端点 | 完整 CRUD |
| Edge agent-profiles 端点 | CRUD |
| Edge runs 端点 | create, cancel, status, diff, artifacts, previews |
| Edge CLI readiness | Claude Code/Codex/OpenCode JSON readiness |
| Desktop Tauri packaging | Unsigned NSIS + portable zip dry run |
| Mobile RN | 89 tests pass, Hub contracts aligned |
| Windows release dry gate | SHA-256 manifests, CI green |

### 2.2 未接通缺口

| 缺口 | 影响 | 阻塞原因 |
|------|------|---------|
| TokenDanceID 真实登录 | 所有 Hub 功能需要 auth token，frontend Hub queries 因无 token 而 disabled | 缺 `AGENTHUB_TDID_LOGIN_ISSUER_URL`、`AGENTHUB_TDID_LOGIN_CLIENT_ID`、`AGENTHUB_TDID_LOGIN_TEST_ACCOUNT_REF` |
| Hub WS 未接入前端实时推送 | IM 实时推送不工作，消息需手动刷新 | 需要 auth token 后才能连接 WS |
| 通讯录前端→Hub API | ContactsPage uses mock data only, hubQueries hooks 存在但未连接到 ContactMember[] | 需要 auth token |
| 聊天前端→Hub API | 消息发送走 demo runtime store，未调用 Hub sendMessage/getMessages | 需要 auth token |
| Agent 配置页→Hub/Edge API | AgentsPage 用 mock fixtures，未调用 Edge agent-profiles CRUD | 需要 Edge 连接 |
| 云文档→Hub API | DocsPage 用 mock data，documentQueries 已创建但未接入 | 需要 auth token |
| 设置页→Hub/Edge Settings API | SettingsPage 用 mock defaults，settingsService 存在但未完整对接 | 需要 auth token + Edge |
| 项目页→Hub Projects API | ProjectsPage 用 mock，hubQueries workspace-projects 存在 | 需要 auth token |
| @Agent 真实调用 CLI | Composer mention 只做 mock submit，未触发 Edge run -> adapter | 需要 approved-real |
| CLI 真实执行 | fixture-only，未调真实 claude-code/codex CLI | 需要 approved-real |
| SDK 真实调用 | fixture-only，未调真实 Anthropic/OpenAI API | 需要 approved-real |
| Mobile→真实 Hub API | Mobile 组件存在但 Hub queries 未全部接入 | 需要 auth token |
| E2E 测试 | 只有 smoke spec，无完整数据流测试 | 需要 auth + Hub+Edge 启动 |

---

## 3. P0：即时阻塞项

> 目标：打通 TokenDanceID 真实登录，使所有 Hub API 可用。

### 3.1 TokenDanceID OIDC 真实登录全链路

| 维度 | 详情 |
|------|------|
| **当前状态** | Hub OIDC handler 已实现（`oidc.go`：`PostOIDCAuthorize`、`PostOIDCCallback`、`GetOIDCCallback`）；Desktop/Web 有登录 UI；但缺 OIDC client 环境变量；readiness 脚本输出 `BLOCKED` |
| **需要对接** | (1) 配置 TokenDance ID OIDC client 元数据到 Hub Server 环境（`AGENTHUB_TDID_LOGIN_ISSUER_URL`、`AGENTHUB_TDID_LOGIN_CLIENT_ID`）；(2) Desktop PKCE + loopback callback 全链路；(3) Web OIDC redirect callback 全链路；(4) Hub code exchange + ID token 验证 + Hub 本地 session 签发 |
| **对接方式** | Desktop: `shell.open()` -> TokenDanceID authorize -> loopback `TcpListener` -> `POST /client/auth/oidc/callback` -> Hub exchange -> Hub JWT；Web: browser redirect -> `GET /client/auth/oidc/callback` -> Hub exchange -> Hub JWT |
| **涉及文件** | `hub-server/internal/handler/oidc.go`、`hub-server/internal/service/auth.go`、`hub-server/internal/jwtutil/tokendance.go`、`app/desktop/src-tauri/src/host/auth.rs`、`app/desktop/src/api/hubAuth.ts`、`app/web/src/components/AuthPage.tsx`、`app/web/src/components/LoginForm.tsx`、`app/web/src/hooks/useAuth.ts`、`app/web/src/hooks/useWebAuth.ts`、`app/web/src/api/hubAuth.ts`、`scripts/verify-token-dance-id-login-readiness.ps1` |
| **验收标准** | (1) Desktop 真实 OIDC 登录成功，Hub 签发 session，`GET /client/auth/me` 返回用户信息；(2) Web 真实 OIDC 登录成功，Hub 签发 session；(3) `verify-token-dance-id-login-readiness.ps1` 输出 `READY_FOR_OPERATOR`；(4) 登录后 Hub WS 连接成功，收到 `auth.ok`；(5) logout 后 session 失效，token 不可用 |

### 3.2 P0 Approved-Real 金链路

| 维度 | 详情 |
|------|------|
| **当前状态** | `verify-p0-approved-real-gold-path.ps1` PASS（no-spend fixture）；真实 CLI/model/API 消耗未标记完成 |
| **需要对接** | (1) Desktop Edge CLI no-spend smoke -> fixture adapter -> Hub replay -> Web 展示；(2) 真实 TokenDanceID 登录后触发 agent task；(3) Hub task 状态同步到 Web |
| **对接方式** | Web `POST /web/agent-tasks` -> Hub -> Edge `POST /edge/agent-tasks/:id/ack` -> Edge fixture adapter -> `POST /edge/agent-tasks/:id/stream` -> Hub -> Web WS `agent.stream` -> Web `GET /web/agent-tasks/:id/events` |
| **涉及文件** | `app/web/src/hooks/useHubMainChat.ts`、`app/web/src/api/runQueries.ts`、`app/web/src/hooks/useHubEventStream.ts`、`app/web/src/stores/taskBridgeStore.ts`、`hub-server/internal/handler/agent.go`、`edge-server/internal/adapters/agentspec_fixture.go`、`tests/scripts/verify-p0-approved-real-gold-path.ps1` |
| **验收标准** | (1) 金链路脚本 PASS；(2) Web 发送消息 -> Hub 创建 task -> Edge fixture 执行 -> 事件回传 -> Web transcript 渲染，全链路可见 |

---

## 4. P1：核心数据流对接

> 目标：把 UI 层已有的所有功能全部对接到真实的 Hub/Edge API，调通全部数据流。

### 4.1 IM 聊天系统

#### 4.1.1 消息发送与接收

| 维度 | 详情 |
|------|------|
| **当前状态** | Web `useHubMainChat.ts` 已实现消息发送 hook；Hub REST `POST /client/sessions/:id/messages` 和 `GET /client/sessions/:id/messages` 已实现；Hub WS `message.new` 事件已定义 |
| **需要对接** | (1) Web 发送消息 -> Hub REST -> 消息持久化 -> WS 推送给所有在线成员；(2) 收到 `message.new` 后追加到 transcript；(3) 支持文本/markdown/代码块 content_type；(4) `client_msg_id` 去重 |
| **对接方式** | REST: `POST /client/sessions/:id/messages { client_msg_id, content_type, content }`；WS: 订阅 `HUB_EVENTS.MESSAGE_NEW` |
| **涉及文件** | `app/web/src/hooks/useHubMainChat.ts`、`app/web/src/stores/hubStore.ts`、`app/web/src/api/hubClient.ts`（`sendMessage`）、`app/shared/src/hubEvents.ts`、`hub-server/internal/handler/message.go`（`SendMessage`）、`hub-server/internal/handler/ws.go` |
| **验收标准** | (1) 发送文本消息，其余在线成员通过 WS 实时收到；(2) 消息列表按 `seq_id` 排序；(3) 重复 `client_msg_id` 不产生重复消息 |

#### 4.1.2 消息撤回（Recall）

| 维度 | 详情 |
|------|------|
| **当前状态** | Hub REST `POST /client/messages/:id/recall` 已实现；WS 事件 `message.recall` 已定义 |
| **需要对接** | (1) 消息上下文菜单接入 recall mutation；(2) 收到 `message.recall` 后将消息标记为已撤回；(3) 撤回权限检查（仅发送者可撤回，有时间窗口） |
| **对接方式** | REST: `POST /client/messages/:id/recall`；WS: `HUB_EVENTS.MESSAGE_RECALL` |
| **涉及文件** | `hub-server/internal/handler/message.go`（`RecallMessage`）、`app/web/src/api/hubClient.ts`、`app/shared/src/hubEvents.ts` |
| **验收标准** | (1) 撤回成功后 UI 显示"消息已撤回"；(2) 超时撤回返回错误；(3) 非发送者撤回返回 403；(4) WS 推送后所有客户端同步 |

#### 4.1.3 消息编辑（Edit）

| 维度 | 详情 |
|------|------|
| **对接方式** | REST: `PUT /client/messages/:id { content }` |
| **涉及文件** | `hub-server/internal/handler/message.go`（`EditMessage`） |
| **验收标准** | (1) 编辑后显示更新内容和"已编辑"标记；(2) 非发送者编辑返回 403 |

#### 4.1.4 消息 Pin / Unpin

| 维度 | 详情 |
|------|------|
| **对接方式** | REST: `POST /client/messages/:id/pin`、`DELETE /client/messages/:id/pin`、`GET /client/sessions/:id/pins`；WS: `HUB_EVENTS.MESSAGE_PIN` / `HUB_EVENTS.MESSAGE_UNPIN` |
| **涉及文件** | `hub-server/internal/handler/message.go`（`PinMessage`、`UnpinMessage`、`ListPins`）、`app/shared/src/hubEvents.ts` |
| **验收标准** | (1) Pin 后出现在会话顶部 pinned 列表；(2) Unpin 后移除；(3) WS 同步到所有在线成员 |

#### 4.1.5 消息 Reaction

| 维度 | 详情 |
|------|------|
| **对接方式** | REST: `POST /client/messages/:id/reactions { emoji }`、`DELETE /client/messages/:id/reactions { emoji }`、`GET /client/messages/:id/reactions` |
| **涉及文件** | `hub-server/internal/handler/message.go`（`ListMessageReactions`、`AddMessageReaction`、`RemoveMessageReaction`） |
| **验收标准** | (1) 添加 reaction 后消息下方显示 emoji 计数；(2) 移除 reaction 后计数更新 |

#### 4.1.6 消息转发（Forward）

| 维度 | 详情 |
|------|------|
| **对接方式** | REST: `POST /client/messages/:id/forward { target_session_id }` |
| **涉及文件** | `hub-server/internal/handler/message.go`（`ForwardMessage`） |
| **验收标准** | (1) 转发成功后目标会话出现转发消息；(2) 转发消息标注原始发送者 |

#### 4.1.7 消息搜索（Search）

| 维度 | 详情 |
|------|------|
| **对接方式** | REST: `GET /client/messages/search?q=keyword`、`GET /client/sessions/:id/messages/search?q=keyword` |
| **涉及文件** | `hub-server/internal/handler/message.go`（`SearchMessages`、`SearchSessionMessages`）、`app/web/src/stores/searchStore.ts`、`app/web/src/components/SearchDialog.tsx` |
| **验收标准** | (1) 搜索返回匹配消息列表，含会话名、发送者、高亮关键词；(2) 点击结果跳转到消息位置 |

#### 4.1.8 已读回执（Read Receipts）

| 维度 | 详情 |
|------|------|
| **对接方式** | REST: `POST /client/sessions/:id/read { last_read_seq_id }`；WS: `HUB_EVENTS.MESSAGE_READ` |
| **涉及文件** | `hub-server/internal/handler/message.go`（`MarkRead`）、`app/shared/src/hubEvents.ts` |
| **验收标准** | (1) 进入会话后未读计数清零；(2) 多端同步已读状态 |

#### 4.1.9 消息同步（Incremental Sync）

| 维度 | 详情 |
|------|------|
| **对接方式** | REST: `GET /client/sessions/:id/messages/sync?after_seq_id=N` |
| **涉及文件** | `hub-server/internal/handler/message.go`（`GetIncrementalMessages`）、`app/web/src/hooks/useHubEventStream.ts` |
| **验收标准** | (1) 离线后上线增量同步补齐未读消息；(2) 不重复拉取 |

#### 4.1.10 WebSocket 实时推送

| 维度 | 详情 |
|------|------|
| **当前状态** | `hubWS.ts` 已实现 auth handshake、typed event routing、exponential backoff reconnection；Transport 抽象已实现；连接状态 store 已实现 |
| **需要对接** | (1) 所有 Hub WS 事件正确路由到对应的 store/hook；(2) 断线重连后重放缺失事件；(3) 连接状态在 UI 可见 |
| **对接方式** | WS: `GET /client/ws?access_token=<jwt>` -> auth handshake -> bidirectional `{type, payload}` |
| **涉及文件** | `app/web/src/api/hubWS.ts`、`app/web/src/api/transport.ts`、`app/web/src/hooks/useHubWSConnection.ts`、`app/web/src/stores/connectionStore.ts`、`hub-server/internal/handler/ws.go` |
| **验收标准** | (1) 登录后 WS 连接并收到 `auth.ok`；(2) 消息/会话/设备/Agent 事件实时推送；(3) 断线重连不丢失事件；(4) 连接状态指示器正确 |

#### 4.1.11 @Agent / @Mention

| 维度 | 详情 |
|------|------|
| **当前状态** | `useMention.ts` hook 已实现；`MentionPopover.tsx` 已实现；Hub `POST /client/sessions/:id/agents` 已实现 |
| **需要对接** | (1) @Agent 时 `AddAgentToSession` 将 Agent 实例加入会话；(2) 发送给 Agent 的消息触发 `TriggerTask`；(3) Agent 回复通过 `agent.stream`/`agent.done` 推送 |
| **对接方式** | REST: `POST /client/sessions/:id/agents`；WS: `HUB_EVENTS.AGENT_DISPATCH`、`HUB_EVENTS.AGENT_STREAM`、`HUB_EVENTS.AGENT_DONE` |
| **涉及文件** | `app/web/src/hooks/useMention.ts`、`app/web/src/components/MentionPopover.tsx`、`hub-server/internal/handler/agent.go`（`AddAgentToSession`） |
| **验收标准** | (1) @Agent 后 Agent 出现在会话成员列表；(2) 发送消息触发 task dispatch；(3) Agent 回复实时流式显示 |

### 4.2 联系人系统

#### 4.2.1 搜索用户

| 维度 | 详情 |
|------|------|
| **当前状态** | Hub REST `GET /client/contacts/search` 已实现；Web `contactQueries.ts` 的 `useSearchHubUser` mutation 已实现 |
| **对接方式** | REST: `GET /client/contacts/search?q=keyword` |
| **涉及文件** | `hub-server/internal/handler/contact.go`（`SearchUser`）、`app/web/src/api/contactQueries.ts` |
| **验收标准** | 搜索返回匹配用户，显示关系（self/friend/stranger/blocked） |

#### 4.2.2 好友请求流程

| 维度 | 详情 |
|------|------|
| **当前状态** | Hub REST 完整好友链路已实现；Web `contactQueries.ts` 所有 mutation hooks 已实现；WS `friend.request`/`friend.accepted` 已定义 |
| **对接方式** | REST: send/list/accept/reject friend-requests；WS: `HUB_EVENTS.FRIEND_REQUEST`、`HUB_EVENTS.FRIEND_ACCEPTED` |
| **涉及文件** | `hub-server/internal/handler/contact.go`、`app/web/src/api/contactQueries.ts`、`app/shared/src/hubEvents.ts` |
| **验收标准** | (1) 发送请求后对方 WS 实时收到通知；(2) 接受后双方出现在联系人列表；(3) 拒绝后请求消失 |

#### 4.2.3 联系人管理（删除/拉黑/备注）

| 维度 | 详情 |
|------|------|
| **当前状态** | Hub REST 完整实现；Web mutation hooks 已实现 |
| **对接方式** | REST: delete/block/unblock/remark |
| **涉及文件** | `hub-server/internal/handler/contact.go`、`app/web/src/api/contactQueries.ts` |
| **验收标准** | (1) 删除后从列表消失；(2) 拉黑后不可发消息；(3) 备注名优先显示 |

#### 4.2.4 创建群组

| 维度 | 详情 |
|------|------|
| **当前状态** | Hub REST `POST /client/sessions/group` 已实现；Web `useCreateGroupSession` mutation 已实现 |
| **对接方式** | REST: `POST /client/sessions/group { name, member_ids }`；WS: `HUB_EVENTS.SESSION_CREATED` |
| **涉及文件** | `hub-server/internal/handler/session.go`（`CreateGroup`）、`app/web/src/api/contactQueries.ts` |
| **验收标准** | 创建群聊后所有成员 WS 收到 `session.created` |

### 4.3 会话管理

#### 4.3.1 会话列表

| 维度 | 详情 |
|------|------|
| **对接方式** | REST: `GET /client/sessions` |
| **涉及文件** | `hub-server/internal/handler/session.go`（`List`）、`app/web/src/stores/hubStore.ts` |
| **验收标准** | (1) 按最后活跃排序；(2) 未读计数准确；(3) 最后消息摘要实时更新 |

#### 4.3.2 群成员管理

| 维度 | 详情 |
|------|------|
| **当前状态** | Hub REST 完整群成员 API 已实现：add/remove/leave/transfer-owner/dissolve/update-info/settings/delete |
| **对接方式** | REST endpoints + WS: `SESSION_MEMBER_JOINED`/`SESSION_MEMBER_LEFT`/`SESSION_INFO_UPDATED`/`SESSION_DISSOLVED` |
| **涉及文件** | `hub-server/internal/handler/session.go`、`app/shared/src/hubEvents.ts` |
| **验收标准** | (1) 添加成员后 WS 推送；(2) 退出/解散后会话消失；(3) 修改群名后 WS 推送 |

### 4.4 认证与身份

#### 4.4.1 Session 管理

| 维度 | 详情 |
|------|------|
| **当前状态** | Hub REST `GET /client/auth/me`、`POST /client/auth/logout`、`PUT /client/auth/profile`、`POST /client/auth/refresh` 已实现 |
| **对接方式** | REST: me/logout/profile/refresh |
| **涉及文件** | `hub-server/internal/handler/auth.go`、`app/web/src/hooks/useAuth.ts`、`app/web/src/api/hubAuth.ts`、`app/web/src/api/hubTokenStorage.ts` |
| **验收标准** | (1) 登录后 UI 展示用户信息；(2) logout 后所有 API 返回 401；(3) access token 过期前自动 refresh |

#### 4.4.2 Profile 同步与 Avatar

| 维度 | 详情 |
|------|------|
| **对接方式** | REST: `PUT /client/auth/profile`、`POST /client/attachments`（头像上传） |
| **涉及文件** | `hub-server/internal/handler/auth.go`（`UpdateProfile`）、`hub-server/internal/handler/attachment.go` |
| **验收标准** | 上传头像后 `GET /client/auth/me` 返回新 URL，会话中头像更新 |

### 4.5 设置系统

#### 4.5.1 用户设置持久化

| 维度 | 详情 |
|------|------|
| **当前状态** | Hub REST `GET/PATCH /client/settings` 已实现；Web `SettingsPage.tsx` 已拆分为按标签页分段组件 |
| **对接方式** | REST: `GET /client/settings` 初始化；`PATCH /client/settings { key: value }` 每次修改 |
| **涉及文件** | `hub-server/internal/handler/user_settings.go`、`app/web/src/components/SettingsPage.tsx` |
| **验收标准** | (1) 修改主题后 Hub 记录偏好，刷新后保持；(2) 登录后 Hub 设置覆盖本地默认 |

#### 4.5.2 Edge 设置同步（双写）

| 维度 | 详情 |
|------|------|
| **对接方式** | Desktop 同时写 Hub settings API + Edge settings API |
| **涉及文件** | `hub-server/internal/handler/user_settings.go`、Desktop platform adapter |
| **验收标准** | (1) workspace allowlist 等执行配置双写；(2) 换 Desktop 登录后 Hub 偏好可恢复 |

### 4.6 Agent 配置系统

#### 4.6.1 Custom Agent CRUD

| 维度 | 详情 |
|------|------|
| **当前状态** | Hub REST `GET/POST/PUT/DELETE /web/custom-agents` 已实现；Web `useHubCustomAgents.ts` 已实现 |
| **对接方式** | REST: 完整 CRUD |
| **涉及文件** | `hub-server/internal/handler/custom_agent.go`、`app/web/src/hooks/useHubCustomAgents.ts`、`hub-server/internal/model/custom_agent.go` |
| **验收标准** | (1) 创建 Agent 后出现在列表；(2) 编辑配置持久化；(3) 删除后从列表消失 |

#### 4.6.2 Agent Profile Store

| 维度 | 详情 |
|------|------|
| **当前状态** | Hub REST CRUD + publish + install 已实现 |
| **对接方式** | REST: `GET/POST/PATCH/DELETE /web/agent-profiles` + publish + install |
| **涉及文件** | `hub-server/internal/handler/agent_profile.go` |
| **验收标准** | (1) Profile 创建后可查看；(2) 发布后出现在市场；(3) 安装后出现在用户列表 |

#### 4.6.3 Runtime / Model / Target 选择

| 维度 | 详情 |
|------|------|
| **对接方式** | Edge: `GET /v1/runners`、`GET /v1/model-catalog`；Hub: `GET /web/execution-targets` |
| **涉及文件** | `edge-server/internal/adapters/registry.go`、`hub-server/internal/handler/execution_target.go`、`app/web/src/api/executionTargetQueries.ts` |
| **验收标准** | (1) Runtime 列表含健康状态；(2) 模型按 provider 分组；(3) Target 展示 online/offline |

#### 4.6.4 MCP Server / Skill / Tool Allowlist / Provider Binding

| 维度 | 详情 |
|------|------|
| **当前状态** | Hub REST 完整 CRUD 已实现 |
| **对接方式** | REST: `/web/skills`、`/web/mcp-servers`、`/web/provider-bindings` |
| **涉及文件** | `hub-server/internal/handler/skill.go`、`hub-server/internal/handler/mcp_server.go`、`hub-server/internal/handler/provider_binding.go` |
| **验收标准** | (1) 创建 MCP server 后可被 Agent 引用；(2) Tool allowlist 限制 Agent 可调用工具 |

### 4.7 云文档系统

| 维度 | 详情 |
|------|------|
| **当前状态** | Hub REST `GET/POST/PATCH/DELETE /web/documents` 已实现 |
| **对接方式** | REST: 完整 CRUD |
| **涉及文件** | `hub-server/internal/handler/document.go` |
| **验收标准** | (1) 文档列表分页加载；(2) 创建/编辑/删除同步；(3) 文档搜索返回结果 |

### 4.8 项目与工作区

| 维度 | 详情 |
|------|------|
| **当前状态** | Hub REST 完整 workspace + threads + messages API 已实现；Web `projectQueries.ts` 已实现 |
| **对接方式** | REST: `GET/POST/PATCH /web/projects`、`GET/POST /web/projects/:id/threads`、`GET/POST /web/projects/:id/threads/:threadId/messages` |
| **涉及文件** | `hub-server/internal/handler/workspace.go`、`app/web/src/api/projectQueries.ts`、`app/web/src/api/threadQueries.ts` |
| **验收标准** | (1) 项目列表展示 Hub 项目；(2) 线程列表按时间排序；(3) 线程内消息实时更新 |

### 4.9 执行与运行时

#### 4.9.1 Local Edge 启动/停止/健康检查

| 维度 | 详情 |
|------|------|
| **对接方式** | Edge: `GET /v1/health`；Tauri Host API: edge start/stop/status |
| **涉及文件** | `edge-server/internal/handler/health.go`、`app/desktop/src-tauri/src/host/edge.rs` |
| **验收标准** | (1) Desktop 启动后 Edge 自动连接；(2) 健康状态在 UI 显示 |

#### 4.9.2 CLI 发现与 Readiness

| 维度 | 详情 |
|------|------|
| **当前状态** | CLI JSON readiness checker 已合入，覆盖 Claude Code/Codex/OpenCode |
| **涉及文件** | `edge-server/internal/adapters/claude_code.go`、`codex.go`、`opencode.go`、`registry.go` |
| **验收标准** | 已安装 CLI 显示 ready，未安装显示 not-found，版本不兼容显示 incompatible |

#### 4.9.3 执行目标（Execution Targets）

| 维度 | 详情 |
|------|------|
| **对接方式** | Hub: `GET/POST/PATCH/DELETE /web/execution-targets`、`POST /web/execution-targets/:id/ping` |
| **涉及文件** | `hub-server/internal/handler/execution_target.go`、`app/web/src/api/executionTargetQueries.ts` |
| **验收标准** | (1) 目标列表展示 online/offline；(2) Ping 反映可达性 |

#### 4.9.4 Run 生命周期

| 维度 | 详情 |
|------|------|
| **对接方式** | Hub: `POST /web/agent-tasks` -> Edge: `POST /v1/runs` -> Event stream -> Hub -> Web WS |
| **涉及文件** | `hub-server/internal/handler/agent.go`、`edge-server/internal/lifecycle/`、`app/web/src/api/runQueries.ts` |
| **验收标准** | (1) 触发 run 后状态 pending -> running -> done/failed；(2) 事件流实时推送 |

#### 4.9.5 Approval 工作流

| 维度 | 详情 |
|------|------|
| **对接方式** | Hub: `GET /web/agent-tasks/:id/approvals`、`POST /web/agent-tasks/:id/approvals/:approval_id/decide` |
| **涉及文件** | `hub-server/internal/handler/agent.go`、`app/web/src/components/ApprovalCard.tsx`、`edge-server/internal/adapters/security_hooks.go` |
| **验收标准** | (1) Agent 请求后展示 approval card；(2) Approve 后继续执行；(3) Deny 后中止 |

#### 4.9.6 Artifact / Diff 展示

| 维度 | 详情 |
|------|------|
| **对接方式** | Hub: `GET /web/agent-tasks/:id/artifacts`；Edge: `GET /v1/runs/:runId/diff` |
| **涉及文件** | `hub-server/internal/handler/agent.go`、`app/web/src/components/DiffViewer.tsx` |
| **验收标准** | (1) Artifact 列表展示；(2) 点击展示 diff 视图 |

### 4.10 Agent Team 编排

| 维度 | 详情 |
|------|------|
| **当前状态** | Hub REST 完整 AgentTeam API 已实现 |
| **对接方式** | REST: 完整 Team + Run + Route + Approval + Conflict + Assignment API |
| **涉及文件** | `hub-server/internal/handler/agent_team.go`、`app/web/src/api/agentTeamQueries.ts` |
| **验收标准** | (1) Team CRUD；(2) Team Run 启动和子任务；(3) 路由决策可视化；(4) 冲突解决 |

### 4.11 设备管理

| 维度 | 详情 |
|------|------|
| **对接方式** | Edge: `POST /edge/devices/register`；Web: `GET /web/devices`；WS: `device.online`/`device.offline`/`device.kicked` |
| **涉及文件** | `hub-server/internal/handler/device.go`、`app/web/src/hooks/useDeviceRegistration.ts` |
| **验收标准** | (1) Desktop 注册设备后 Web 可见；(2) 设备离线后 WS 推送 |

### 4.12 附件系统

| 维度 | 详情 |
|------|------|
| **对接方式** | REST: `POST /client/attachments`（multipart upload）、`GET /client/attachments/:id` |
| **涉及文件** | `hub-server/internal/handler/attachment.go` |
| **验收标准** | (1) 上传附件后消息显示预览；(2) 点击可下载 |

### 4.13 通知系统

| 维度 | 详情 |
|------|------|
| **对接方式** | REST: `GET /client/notifications`、`POST /client/notifications/:id/read`、`POST /client/notifications/read-all`；WS: `HUB_EVENTS.NOTIFICATION_NEW` |
| **涉及文件** | `hub-server/internal/handler/notification.go`、`app/web/src/components/NotificationBell.tsx` |
| **验收标准** | (1) 铃铛显示未读计数；(2) 新通知 WS 实时推送 |

### 4.14 市场系统

| 维度 | 详情 |
|------|------|
| **对接方式** | REST: `GET /web/market/profiles`、install、rate |
| **涉及文件** | `hub-server/internal/handler/market.go` |
| **验收标准** | (1) 市场列表分页加载；(2) 安装后 Profile 出现在用户列表 |

---

## 5. P2：多端对齐

### 5.1 Mobile 协议对齐

| 维度 | 详情 |
|------|------|
| **需要对接** | (1) Mobile 消费 Hub target/run/approval/replay 合同；(2) OIDC deep-link `agenthub://` 登录；(3) WS 接收实时事件；(4) 审批入口；(5) 不分叉 runtime 或登录语义 |
| **涉及文件** | `app/mobile-rn/src/` |
| **验收标准** | (1) 登录后看到与 Web 相同会话列表；(2) 可 approve/deny 审批 |

### 5.2 Desktop 本地执行

| 维度 | 详情 |
|------|------|
| **需要对接** | (1) Desktop 共享 Web workbench UI；(2) 通过 Local Edge 执行 run；(3) 展示 Edge 健康状态 |
| **涉及文件** | `app/desktop/src/`、`app/desktop/src-tauri/src/host/` |
| **验收标准** | Desktop 触发 run 通过 Local Edge 执行 |

### 5.3 Tauri 打包

| 维度 | 详情 |
|------|------|
| **当前状态** | Windows unsigned dry package 已能产出 |
| **需要对接** | (1) Windows unsigned smoke 持续通过；(2) macOS unsigned path 拆清；(3) sidecar 自动放置 |
| **涉及文件** | `app/desktop/src-tauri/`、`scripts/verify-tauri-package-dry.ps1` |
| **验收标准** | (1) Windows dry package hash 一致；(2) sidecar 正确放置；(3) macOS 路径明确 |

### 5.4 i18n 国际化

| 维度 | 详情 |
|------|------|
| **需要对接** | (1) 所有用户可见字符串中英文完整；(2) 术语翻译统一 |
| **涉及文件** | `app/shared/src/i18n/`、`app/desktop/src/i18n/`、`app/web/src/i18n/` |
| **验收标准** | 所有页面在 zh 和 en locale 下无遗漏字符串 |

---

## 6. P3：发布与生产

### 6.1 Web 部署准备

| 维度 | 详情 |
|------|------|
| **需要对接** | (1) 环境变量注入 Hub API URL 和 OIDC 配置；(2) 静态构建和部署；(3) rollback gate |
| **涉及文件** | `app/web/vite.config.ts`、`app/web/src/config.ts` |
| **验收标准** | 部署后 Web 可通过 Hub API 登录和使用 |

### 6.2 Release 治理

| 维度 | 详情 |
|------|------|
| **当前状态** | `verify-release-gate.ps1` 已实现 |
| **验收标准** | (1) Release gate 全绿才允许发布；(2) Changelog 包含所有变更 |

### 6.3 安全风险关闭

| 维度 | 详情 |
|------|------|
| **验收标准** | 无 open Critical release blockers；所有 High 风险有 accepted 或 fixed 状态 |

---

## 7. SDK 与 CLI 接入

### 7.1 CLI 接入

| CLI | 命令格式 | Edge adapter | 当前状态 |
|-----|----------|-------------|----------|
| Claude Code | `claude --output-format stream-json` | `claude_code.go` | adapter 已实现，CLI readiness 已实现 |
| Codex | `codex exec --json` | `codex.go` | adapter 已实现，CLI readiness 已实现 |
| OpenCode | `opencode run --format json` | `opencode.go` | adapter 已实现，CLI readiness 已实现 |

对接要求：
- 每个 CLI adapter 输出统一映射到 typed transcript event
- 进程生命周期由 Edge lifecycle 管理
- stdout/stderr 合并批处理（50ms 或 8KB）
- 权限请求映射到 Edge approval -> Hub approval -> Web/Mobile approve/deny

### 7.2 SDK 接入

| SDK | adapter | 当前状态 |
|-----|---------|----------|
| Claude Agent SDK | `sdk_fixture_mapper.go` | fixture 样例已实现 |
| OpenAI Agents SDK | `sdk_fixture_mapper.go` | fixture 样例已实现 |
| Custom runtime | `runtime_manifest.go` | manifest 注册已实现 |

对接要求：
- SDK event 映射到统一 `RunEvent` 合同
- 类型化事件：text/tool_call/file_change/permission/result/artifact
- Approval 流：SDK permission request -> Edge approval -> Hub -> UI decision -> SDK resume

---

## 8. 长期路线 Phase A-E

### Phase A：IM 多 Agent 产品闭环

| 模块 | 路线项 | 完成标准 |
|------|--------|----------|
| Conversation Model | 单聊/群聊/项目会话/联系人/群成员/置顶/归档/搜索/最近活动 | IM 列表和消息流可承载真实日常工作 |
| Orchestrator | 复杂任务拆解/子 Agent 分派/并行串行策略/失败降级/聚合回复 | 群聊里多个 Agent 像队友一样协作 |
| Context Continuity | 会话历史/pinned messages/workspace context/memory/AGENTS.md/Skill/MCP 输入统一 | Agent 能基于历史迭代 |
| Message Actions | 回复/引用/重新生成/复制/pin/一键检查 Diff/打开预览 | 常用 IM 操作和开发操作在同一消息模型下成立 |

### Phase B：Runtime / Agent 平台化

| 模块 | 路线项 | 完成标准 |
|------|--------|----------|
| Runtime Registry | Claude Code/Codex/OpenCode/OpenAI Agents SDK/Claude Agent SDK/Custom runtime | 每个 runtime 有 metadata/capability/icon/adapter/approval policy |
| Agent Profile Store | Hub 持久化 Profile/模板/市场安装/团队可见性/版本和审计 | Agent 是可管理实体 |
| Custom Agent Builder | 名称/头像/system prompt/runtime/model/skills/MCP/tools/memory/approval/target preference | 用户可以创建自己的 Agent 队友 |
| MCP / Tool Registry | tool schema/权限/icon/审计/运行时兼容矩阵 | 工具调用类型化、可审查、可跨 runtime 复用 |

### Phase C：远程执行和协作网络

| 模块 | 路线项 | 完成标准 |
|------|--------|----------|
| Target Routing | Local Edge/Remote Edge/Cloud Edge/Hub Relay target 注册/心跳/exact-device dispatch/降级 | Web/Mobile/IM 能稳定控制正确目标 |
| Hub Replay / Sync | run/route/subtask/approval/artifact/preview/file/failure 事件统一同步 | Web/Desktop/Mobile/IM 用同一事件契约渲染 |
| Permissions / Audit | Hub-local org/project membership/resource/action check/device proof/审批审计 | TokenDance ID 只证明身份；AgentHub 自己决定能做什么 |
| Remote Approval | Mobile/IM/Web 远程 approve/deny/watch/pause/abort | 用户离开 Desktop 也能控制关键执行节点 |

### Phase D：产物、预览和交付

| 模块 | 路线项 | 完成标准 |
|------|--------|----------|
| Artifact Store | 文件/网页/文档/报告/图片/包/日志摘要统一索引 | 产物能按项目/会话/run/Agent 查找和预览 |
| Diff / Apply | 只读 diff/review/apply/revert/冲突提示/版本历史 | 用户能安全检查并应用 Agent 修改 |
| Preview Providers | 本地网页/静态站/文档/PPT/图片/代码/外部 provider 只读预览 | 产物内联可看、可追溯 |
| Deployment | 预览 URL/静态站/容器化/源码包/状态卡片 | 部署是可审批的产物动作 |

### Phase E：发布、观测和企业治理

| 模块 | 路线项 | 完成标准 |
|------|--------|----------|
| Cross-platform Release | Windows installer/macOS package/Web deploy/Mobile beta/updater/rollback | 每个平台都有独立 smoke |
| Observability | correlation id/event search/run diagnostics/logs/metrics/health dashboard | Web/Hub/Desktop/Edge/Runtime 的失败能串起来排查 |
| Multi-tenant | org/role/quota/workspace ownership/audit export/deployment boundary | 从单用户扩展到团队和组织 |
| Evidence Consumption | 从 product gates 输出可复验/脱敏/可引用的开发证据 | 后续演示或验收流程消费这些输出 |

---

## 9. 非协商边界

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

---

## 10. 验证清单

> 以下每项必须通过对应的 E2E 测试或手动验证证明集成可用。

### 10.1 认证

- [ ] TokenDanceID OIDC 登录（Desktop PKCE loopback）：`GET /client/auth/me` 返回用户信息
- [ ] TokenDanceID OIDC 登录（Web redirect callback）：`GET /client/auth/me` 返回用户信息
- [ ] Session refresh：access token 过期前自动 refresh，用户无感知
- [ ] Logout：`POST /client/auth/logout` 后所有 API 返回 401
- [ ] Profile 更新：`PUT /client/auth/profile` 后头像和昵称同步更新

### 10.2 IM 聊天

- [ ] 消息发送：`POST /client/sessions/:id/messages` 后 WS 推送 `message.new`
- [ ] 消息接收：WS `message.new` 后消息出现在 transcript
- [ ] 消息撤回：`POST /client/messages/:id/recall` 后消息显示"已撤回"
- [ ] 消息编辑：`PUT /client/messages/:id` 后内容更新并显示"已编辑"
- [ ] 消息 pin：`POST /client/messages/:id/pin` 后 pinned 列表更新
- [ ] 消息 unpin：`DELETE /client/messages/:id/pin` 后从列表移除
- [ ] 消息 reaction：添加/移除 emoji 后计数更新
- [ ] 消息转发：`POST /client/messages/:id/forward` 后目标会话出现转发消息
- [ ] 消息搜索：`GET /client/messages/search?q=keyword` 返回匹配结果
- [ ] 已读回执：`POST /client/sessions/:id/read` 后未读计数清零
- [ ] 消息同步：`GET /client/sessions/:id/messages/sync?after_seq_id=N` 补齐离线消息
- [ ] WS 实时推送：断线重连后不丢失事件
- [ ] @Agent：`POST /client/sessions/:id/agents` 后 Agent 加入会话

### 10.3 联系人

- [ ] 搜索用户：`GET /client/contacts/search?q=keyword` 返回结果
- [ ] 发送好友请求：`POST /client/contacts/friend-requests` 后对方 WS 收到通知
- [ ] 接受好友请求：`POST /client/contacts/friend-requests/:id/accept` 后双方列表更新
- [ ] 拒绝好友请求：`POST /client/contacts/friend-requests/:id/reject` 后请求消失
- [ ] 删除联系人：`DELETE /client/contacts/:user_id` 后从列表消失
- [ ] 拉黑联系人：`POST /client/contacts/:user_id/block` 后无法发消息
- [ ] 修改备注：`PUT /client/contacts/:user_id/remark` 后备注显示

### 10.4 会话

- [ ] 会话列表：`GET /client/sessions` 按最后活跃排序
- [ ] 创建私聊：`POST /client/sessions/private` 后出现在列表
- [ ] 创建群聊：`POST /client/sessions/group` 后所有成员 WS 收到 `session.created`
- [ ] 添加群成员：`POST /client/sessions/:id/members` 后 WS 推送
- [ ] 移除群成员：`DELETE /client/sessions/:id/members/:user_id` 后 WS 推送
- [ ] 退出群聊：`POST /client/sessions/:id/leave` 后从列表消失
- [ ] 解散群聊：`POST /client/sessions/:id/dissolve` 后所有成员会话消失
- [ ] 修改群信息：`PUT /client/sessions/:id/info` 后 WS 推送 `session.info_updated`

### 10.5 Agent 配置

- [ ] 创建 Custom Agent：`POST /web/custom-agents` 后出现在列表
- [ ] 编辑 Agent 配置：`PUT /web/custom-agents/:id` 后配置持久化
- [ ] 删除 Agent：`DELETE /web/custom-agents/:id` 后从列表消失
- [ ] Agent Profile CRUD：`GET/POST/PATCH/DELETE /web/agent-profiles` 全链路
- [ ] Runtime 列表：`GET /v1/runners` 返回可用 runtime 和健康状态
- [ ] 模型列表：`GET /v1/model-catalog` 返回可用模型
- [ ] MCP Server CRUD：`GET/POST/PUT/DELETE /web/mcp-servers` 全链路
- [ ] Skill CRUD：`GET/POST/PUT/DELETE /web/skills` 全链路

### 10.6 执行与运行时

- [ ] Edge 健康检查：`GET /v1/health` 返回 ready
- [ ] CLI 发现：各 CLI ready/not-found/incompatible 状态正确
- [ ] 触发 run：`POST /web/agent-tasks` 后状态从 pending -> running -> done
- [ ] 事件流：`GET /web/agent-tasks/:id/events` 返回完整事件
- [ ] Approval 请求：Agent 请求后 Web 展示 approval card
- [ ] Approval 决策：`POST /web/agent-tasks/:id/approvals/:approval_id/decide` 后 Agent 继续/中止
- [ ] Artifact 列表：`GET /web/agent-tasks/:id/artifacts` 返回产物
- [ ] Diff 展示：artifact 的 diff 视图正确渲染
- [ ] Target 列表：`GET /web/execution-targets` 展示 online/offline 状态
- [ ] Target ping：`POST /web/execution-targets/:id/ping` 反映可达性

### 10.7 项目与文档

- [ ] 项目列表：`GET /web/projects` 返回用户项目
- [ ] 创建项目：`POST /web/projects` 后出现在列表
- [ ] 线程列表：`GET /web/projects/:id/threads` 返回项目线程
- [ ] 线程消息：`GET/POST /web/projects/:id/threads/:threadId/messages` 全链路
- [ ] 文档 CRUD：`GET/POST/PATCH/DELETE /web/documents` 全链路
- [ ] 文档搜索：关键词搜索返回匹配文档

### 10.8 Agent Team

- [ ] Team CRUD：创建/查看/编辑/删除 Team
- [ ] Team 成员：添加/移除 Agent 成员
- [ ] Team Run：`POST /web/agent-teams/:id/runs` 启动运行
- [ ] 路由决策：`POST .../route-decisions` 可视化
- [ ] 冲突解决：`POST .../conflicts/:conflict_id/resolve` 解决冲突

### 10.9 其他

- [ ] 设备注册：`POST /edge/devices/register` 后 `GET /web/devices` 可见
- [ ] 附件上传下载：`POST /client/attachments` + `GET /client/attachments/:id`
- [ ] 通知列表：`GET /client/notifications` 分页加载
- [ ] 通知已读：`POST /client/notifications/:id/read` 后计数更新
- [ ] 用户设置：`GET/PATCH /client/settings` 持久化和恢复
- [ ] 市场列表：`GET /web/market/profiles` 展示已发布 Profile
- [ ] 安装 Profile：`POST /web/market/profiles/:id/install` 后出现在用户列表
- [ ] i18n：所有页面 zh/en 完整无遗漏
- [ ] P0 金链路：`verify-p0-approved-real-gold-path.ps1` PASS
- [ ] Windows dry package：`verify-tauri-package-dry.ps1` PASS
- [ ] Release gate：`verify-release-gate.ps1` PASS

---

## 11. 依赖顺序

```
Phase 1 (本周): TokenDanceID 真实登录打通
  └─ P0 3.1 完成 → Hub auth token 可用 → 所有 Hub queries 可启用

Phase 2 (紧随): Core data flows
  ├─ 4.1 IM 聊天 → Hub sessions + messages API
  ├─ 4.2 联系人 → Hub contacts API
  ├─ 4.6 Agent 配置 → Edge agent-profiles API
  └─ 4.5 设置 → Hub + Edge settings API

Phase 3: Extended flows
  ├─ 4.7 云文档 → Hub documents API
  ├─ 4.8 项目管理 → Hub projects API
  ├─ 5.4 i18n → en locale 补齐
  └─ 5.1 Mobile → Hub API alignment

Phase 4: Runtime integration
  ├─ 7.1 CLI 接入 → Claude Code/Codex/OpenCode 真实调用
  └─ 7.2 SDK 接入 → Anthropic/OpenAI API 真实调用

Phase 5: Release
  ├─ 5.3 Tauri → 签名 + 打包 + 发布
  ├─ E2E → 全流程自动化
  └─ Release governance → changelog + gate + rollback
```
