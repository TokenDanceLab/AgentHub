# AgentHub 全局打通路线图

> 验收标准：发布 Release，完成全部真实数据流打通。非必要不碰 UI 层，UI 作为需求文档。

最后更新：2026-06-10

---

## 0. 产品北极星

AgentHub = IM 形态的多 Agent 协作工作台。用户面对的是联系人、群聊、Agent 队友、审批、Diff、Preview 和产物。

```
Web / Desktop / Mobile / IM
  → Hub 身份、会话、联系人、群聊、权限、路由、回放
  → Execution Target: Local Edge / Remote Edge / Cloud Edge / Hub Relay
  → Edge Runtime adapter: Claude Code / Codex / OpenCode / SDK / Custom
  → 类型化事件、审批、Diff、Preview、Artifact、执行记录
  → 同一条 IM 任务流渲染和控制
```

---

## 1. 架构分层与数据流

### 1.1 五层数据流

| 层 | 组件 | 数据方向 | 已实现状态 |
|---|------|---------|-----------|
| UI 层 | Web/Desktop/Mobile Workbench | 只消费下层 API | ✅ 组件框架完整 |
| Hub 层 | Hub Server (Gin+PostgreSQL+Redis) | Web↔Hub REST+WebSocket | ✅ 49 migration, 100+ 端点 |
| Target 层 | Execution Target Registry | 设备注册/心跳/路由 | ⚠️ 端点存在，前端 Target 页未对接 |
| Edge 层 | Edge Server (stdlib+SQLite) | 本地执行+事件总线 | ✅ SQLite durable, 种子数据 |
| Runtime 层 | CLI/SDK Adapters | 真实模型调用 | ⚠️ fixture/mock only |

### 1.2 三层数据模式

| 模式 | `dataMode` 值 | 特征 | 当前状态 |
|------|-------------|------|---------|
| Demo (mock) | `mock` | JS 内存数据，零依赖 | ✅ 工作 |
| Observed | `observed` | Edge API 只读观察 | ⚠️ 前端查询存在，auth token 问题 |
| Approved-Real | `approved-real` | 真实 Hub+Edge+CLI | ❌ 需 TokenDanceID 登录打通 |

### 1.3 关键文件索引

| 区域 | 关键文件 |
|------|---------|
| 前端平台接口 | `app/shared/src/platform/types.ts` — `AgentHubPlatform` |
| 桌面数据模型 | `app/desktop/src/platform/useDesktopWorkbenchModel.ts` |
| 桌面入口 | `app/desktop/src/App.tsx` — 三种模式切换 |
| Hub REST 客户端 | `app/desktop/src/api/hubClient.ts` — `createHubClient()` |
| Hub React Query | `app/desktop/src/api/hubQueries.ts` — contacts/projects |
| Edge REST 客户端 | `app/desktop/src/api/edgeClient.ts` |
| Thread 查询 | `app/desktop/src/api/threadQueries.ts` |
| Run 查询 | `app/desktop/src/api/runQueries.ts` |
| Document 查询 | `app/desktop/src/api/documentQueries.ts` |
| Hub 认证 | `app/desktop/src/api/hubAuth.ts` — OIDC PKCE |
| Demo 证据 | `app/desktop/src/demo/demoEvidence.ts` — 每个会话独立数据 |
| 共享工作台 | `app/shared/src/workbench/AgentHubWorkbench.tsx` — 主布局 |
| 页面路由 | `app/shared/src/workbench/WorkbenchRoutes.tsx` — 7 个子页 |
| 右侧面板 | `app/shared/src/workbench/RightInspector.tsx` |
| Hub Server 路由 | `hub-server/internal/router/router.go` |
| Edge Server 路由 | `edge-server/internal/api/handlers.go` |
| Edge Store | `edge-server/internal/store/store.go` — Repository 接口 |
| Edge SQLite | `edge-server/internal/store/sqlite_store.go` |
| Hub 迁移 | `hub-server/migrations/` — 49 个文件 |

---

## 2. 当前状态总览

### 2.1 已完成（✅）

| 模块 | 能力 |
|------|------|
| Web/Desktop 共享 workbench | 7 个子页全部有 UI + mock 数据 |
| Hub Server | 49 个迁移全部运行，100+ REST 端点 + WebSocket |
| Edge Server | SQLite durable store, 种子数据 (10 threads, 8 runs) |
| Demo 模式 | 10 个会话各有独立 transcript, evidence, preview |
| Desktop 入口页 | 登录 + Demo 两个按钮，dataMode 切换 |
| i18n | zh + en 两个 locale 文件，~925 个 key |
| Hub contacts 端点 | search, list, friend-request (CRUD), block, remark |
| Hub sessions 端点 | create, members, leave, dissolve, info, settings |
| Hub messages 端点 | send, get, sync, recall, edit, pin, reaction, forward, search |
| Hub documents 端点 | list, get, create, update, delete |
| Hub settings 端点 | GET/PATCH settings |
| Edge agent-profiles 端点 | CRUD 完整 |
| Edge runs 端点 | create, cancel, status, diff, artifacts, previews |
| Hub Auth/OIDC | PKCE flow, token refresh, Hub JWT 签发 |
| Desktop Tauri packaging | Unsigned NSIS + portable zip dry run |
| Mobile RN | 89 tests pass, Hub contracts aligned |
| E2E Playwright | 6 个 spec 文件（Web + Desktop） |
| Windows release dry gate | SHA-256 manifests, CI green |

### 2.2 未接通（❌ 或 ⚠️）

| 缺口 | 影响 |
|------|------|
| TokenDanceID 真实登录 | 所有 Hub 功能需要 auth token，现在 frontend Hub queries 因无 token 而 disabled |
| Hub WS 未接入前端 | IM 实时推送不工作，消息需手动刷新 |
| 通讯录前端→Hub API | ContactsPage uses mock data only, hubQueries hooks exist but not connected to ContactMember[] |
| 聊天前端→Hub API | 消息发送走 demo runtime store，未调用 Hub sendMessage/getMessages |
| Agent 配置页→Hub/Edge API | AgentsPage 用 mock fixtures，未调用 Edge agent-profiles CRUD |
| 云文档→Hub API | DocsPage 用 mock data，documentQueries 已创建但未接入 |
| 设置页→Hub/Edge Settings API | SettingsPage 用 mock defaults，settingsService 存在但未完整对接 |
| 项目页→Hub Projects API | ProjectsPage 用 mock，hubQueries workspace-projects 存在 |
| @Agent 真实调用 CLI | Composer mention 只做 mock submit，未触发 Edge run → adapter |
| CLI 发现→真实 claude-code/codex | Desktop 可检测 CLI 但未连接真实执行 |
| SDK 接入→真实调用 | fixture-only，未调真实 Anthropic/OpenAI API |
| Mobile→真实 Hub API | Mobile 组件存在但 Hub queries 未全部接入 |
| E2E 测试 | 只有 smoke spec，无完整数据流测试 |

---

## 3. 打通计划 — 按模块

### 3.1 IM 聊天全功能（P0 最高优先级）

**目标：** 单聊/群聊/@Agent/@mention/pin/reaction/forward/recall/edit/search/sync/已读/WebSocket 全部走真实 Hub API。

**当前状态：** 
- UI 层：`AgentHubWorkbench` + `ConversationSidebar` + `TranscriptView` + `UnifiedComposer` 完整
- 数据层：demo mode uses `workbenchDemoRuntimeStore`；real mode tries Edge threads
- 缺失：real mode 需要 Hub sessions + messages API，但目前无 Hub auth token

**打通步骤：**

| # | 任务 | 涉及文件 | 验收标准 |
|---|------|---------|---------|
| 1 | `useHubSessions` hook → hubQueries | `hubQueries.ts` | 能从 Hub 拉取会话列表，queryKey `['hub', 'sessions']` |
| 2 | `useHubMessages` hook | 新建 `sessionQueries.ts` | 封装 sendMessage/getMessages/syncMessages |
| 3 | 将 `useDesktopWorkbenchModel` real mode 切换到 Hub API | `useDesktopWorkbenchModel.ts` | `conversations` 来自 `useHubSessions`，`transcript` 来自 `useHubMessages` |
| 4 | `useHubSendMessage` mutation | `sessionQueries.ts` | 发送消息后 invalidate messages cache |
| 5 | Hub WebSocket 客户端 hook | 新建 `useHubWebSocket.ts` | 实时接收 `message.new`, `message.edited`, `message.recall`, `typing`, `session.*` |
| 6 | Message pin/reaction/forward | `sessionQueries.ts` | pinMessage/unpinMessage/addReaction/removeReaction/forwardMessage mutations |
| 7 | Message search | `sessionQueries.ts` | searchMessages/searchSessionMessages queries |
| 8 | Message recall/edit | `sessionQueries.ts` | recallMessage/editMessage mutations |
| 9 | 已读标记 | `sessionQueries.ts` | markRead mutation |
| 10 | E2E 回归测试 | `app/e2e/chat-real.spec.ts` 新建 | 真实数据流：创建会话→发消息→WebSocket 推送→已读→搜索 |

**API 映射（前端 hook → Hub 端点）：**
```
useHubSessions         → GET /client/sessions
useHubCreateSession    → POST /client/sessions/private | /client/sessions/group
useHubMessages         → GET /client/sessions/:id/messages
useHubSendMessage      → POST /client/sessions/:id/messages
useHubSyncMessages     → GET /client/sessions/:id/messages/sync
useHubMarkRead         → POST /client/sessions/:id/read
useHubRecallMessage    → POST /client/messages/:id/recall
useHubEditMessage      → PUT /client/messages/:id
useHubPinMessage       → POST /client/messages/:id/pin
useHubUnpinMessage     → DELETE /client/messages/:id/pin
useHubAddReaction      → POST /client/messages/:id/reactions
useHubRemoveReaction   → DELETE /client/messages/:id/reactions
useHubForwardMessage   → POST /client/messages/:id/forward
useHubSearchMessages   → GET /client/messages/search
useHubSessionSearch    → GET /client/sessions/search
useHubWebSocket        → GET /client/ws (coder/websocket)
```

**当前 blocker：TokenDanceID 登录未打通（见 3.4）。**

---

### 3.2 通讯录 (Contacts) — 加好友/队列

**目标：** 搜索用户→发好友请求→接受/拒绝→管理联系人→备注→拉黑→创建群组，全部走真实 Hub API。

**当前状态：**
- UI：`ContactsPage` 有 internal/external/requests/groups/service 五个 pane
- 数据：mock `WORKBENCH_MOCK_CONTACT_MEMBERS`
- Hub queries：`useHubContacts`, `useHubSearchUser`, `useHubSendFriendRequest` 等已存在於 `hubQueries.ts`
- 缺失：`ContactsPage` props 未接收 Hub mutations

**打通步骤：**

| # | 任务 | 涉及文件 | 验收标准 |
|---|------|---------|---------|
| 1 | `App.tsx` 传递 contactsActions props | `App.tsx` | `contactsActions` 从 `WorkbenchContactsActions` 类型正确传递 |
| 2 | `useDesktopWorkbenchModel` 返回 contacts data | `useDesktopWorkbenchModel.ts` | `contacts` 字段包含 Hub contacts 数据（非 mock） |
| 3 | `ContactsPage` 使用传入 contacts 数据 | `ContactsPage.tsx` | 当 `contacts` prop 非空时优先使用，否则 fallback mock |
| 4 | 搜索用户功能 | `ContactsPage.tsx` | 输入用户名→调用 `searchUser`→展示结果 |
| 5 | 好友请求列表 | `ContactsPage.tsx` | 展示 pending requests，按钮调用 accept/reject |
| 6 | 联系人操作（删除/拉黑/备注） | `ContactsPage.tsx` | 右键菜单调用对应 mutation |
| 7 | 创建群组 | `ContactsPage.tsx` | 选择成员→命名→调用 `createGroupSession` |
| 8 | E2E 测试 | `app/e2e/contacts-real.spec.ts` 新建 | 真实数据流验证 |

**API 映射：**
```
useHubSearchUser          → GET /client/contacts/search?q=
useHubSendFriendRequest   → POST /client/contacts/friend-requests
useHubListFriendRequests  → GET /client/contacts/friend-requests
useHubAcceptFriendRequest → POST /client/contacts/friend-requests/:id/accept
useHubRejectFriendRequest → POST /client/contacts/friend-requests/:id/reject
useHubListContacts        → GET /client/contacts
useHubRemoveContact       → DELETE /client/contacts/:user_id
useHubBlockContact        → POST /client/contacts/:user_id/block
useHubUnblockContact      → POST /client/contacts/:user_id/unblock
useHubUpdateContactRemark → PUT /client/contacts/:user_id/remark
useHubCreateContactGroup  → POST /client/sessions/group
```

---

### 3.3 登录账号同步 — TokenDanceID OIDC + 用户信息

**目标：** 真实 TokenDanceID 登录→Hub JWT→自动登录→profile 同步→avatar 头像→全局可用。

**当前状态：**
- Hub 端：`POST /client/auth/oidc/authorize` + `/client/auth/oidc/callback` + `/client/auth/me` 已就绪
- Desktop 端：`hubAuth.ts` — OIDC PKCE 完整（Tauri + Browser dev 双模式）
- `DesktopEntryGate.tsx` — 登录按钮 + `tryAutoLogin()` 已连接
- `App.tsx` — `user` 状态从 `useAuth()` 读取，`user` 非空时跳过 entry gate
- 缺失：真实 TokenDanceID client_id/issuer 未配置（`BLOCKED` per STATE.md）
- 缺失：`loginWithTokenDance()` 成功后 `continueDemo()` → 应改为 `handleLoginSuccess()`
- 缺失：登录后用户信息未传递给 workbench（`userDisplayName`/`userAvatarUrl` 来自 Edge `useCurrentUser` 而非 Hub `me()`）

**打通步骤：**

| # | 任务 | 涉及文件 | 验收标准 |
|---|------|---------|---------|
| 1 | 配置 TokenDanceID issuer/client_id | `.env.local`（本地 only） | OIDC discovery 可通过 `verify-token-dance-id-login-readiness.ps1` |
| 2 | 验证 PKCE 全链路 | 浏览器手动测试 | 点击登录→跳转 TokenDanceID→回调→token 交换→`useAuth().user` 非空 |
| 3 | `App.tsx` 区分登录用户和 Edge 用户 | `App.tsx` | `userDisplayName` 优先来自 Hub `me()`（有头像/昵称），fallback Edge `currentUser` |
| 4 | Avatar 头像同步 | `AgentHubWorkbench.tsx` | GlobalRail avatar 显示真实头像 URL |
| 5 | Hub WebSocket 在登录后自动连接 | `useHubWebSocket.ts` | `useAuth().token` 非空时建立 WS，token 刷新时重连 |
| 6 | 所有 Hub queries 在登录后自动启用 | `useDesktopWorkbenchModel.ts` | `hubReady` 条件满足时全部 queries 自动 fetch |
| 7 | 登出清理 | `App.tsx` | 登出后清除 localStorage edge URL + data mode + Hub token，回到 entry gate |
| 8 | Token refresh | `hubAuth.ts` | JWT 过期前自动 refresh，不影响活跃 WS 连接 |

**关键文件：**
- `app/desktop/src/api/hubAuth.ts` — `createHubAuth()` (PKCE + token 管理)
- `app/desktop/src/api/hubTokenStorage.ts` — token 持久化
- `app/desktop/src/hooks/useAuth.ts` — React hook
- `app/desktop/src/stores/hubStore.ts` — `authenticated` 全局状态
- `hub-server/internal/handler/oidc.go` — 后端 OIDC 处理

---

### 3.4 Agent 配置 (AgentsPage) + Runtime 管理

**目标：** Agent 配置页面完整 CRUD，包含 Runtime 选择、Model 选择、MCP/Tools/Skills/Approval/Memory/Target Preference 全部持久化。

**当前状态：**
- UI：`AgentsPage` 有 installed/market/models/tools/audit 五个 tab
- Edge 端点：`GET/POST /v1/agent-profiles`, `GET/PATCH/DELETE /v1/agent-profiles/:id` 完整
- Desktop queries：`agentProfileQueries.ts` — `useAgentProfileList`, `useCreateAgentProfile`, `useUpdateAgentProfile`, `useDeleteAgentProfile`
- `App.tsx` 已连接 `handleAgentCreate/Update/Delete` → `useAgentProfileList`
- Model catalog：Edge `GET /v1/model-catalog` → `modelCatalogQueries.ts`
- 缺失：AgentsPage 在 real mode 下未使用传入的 agent data
- 缺失：Runtime 配置（CLI 发现→Target 注册）未对接

**打通步骤：**

| # | 任务 | 涉及文件 | 验收标准 |
|---|------|---------|---------|
| 1 | AgentsPage 接受 agentConfigs prop | `WorkbenchRoutes.tsx` → `AgentsPage.tsx` | real mode 下 agents 来自 Edge profiles，非 mock |
| 2 | Agent 创建流程 | `AgentsPage.tsx` | 填写→保存→Edge `POST /v1/agent-profiles`→刷新列表 |
| 3 | Agent 编辑流程 | `AgentsPage.tsx` | 修改字段→`PATCH`→刷新 |
| 4 | Agent 删除 | `AgentsPage.tsx` | 确认→`DELETE`→刷新 |
| 5 | Model catalog 展示 | `AgentsPage.tsx` Models tab | 展示 Edge `/v1/model-catalog` 实际模型 |
| 6 | Runtime registry 展示 | `AgentsPage.tsx` | 从 Edge `/v1/runners` 展示可用 runtime |
| 7 | Hub Market integration | `AgentsPage.tsx` Market tab | 调用 Hub `/web/market/profiles` 展示可安装 Agent |
| 8 | Provider bindings | 新 Section in AgentsPage | 调用 Hub `/web/provider-bindings` CRUD |
| 9 | E2E: 创建→使用 Agent | `app/e2e/agent-real.spec.ts` | 创建 profile→选中→composer 里出现该 Agent |

---

### 3.5 云文档 (DocsPage)

**目标：** Hub 云文档 CRUD + 预览 + 搜索 + 状态过滤。

**当前状态：**
- UI：`DocsPage` 有 table 视图 + 预览 panel
- Hub 端点：`GET/POST /web/documents`, `GET/PATCH/DELETE /web/documents/:id`
- `documentQueries.ts` 已创建：`useDocumentList`, `useCreateDocument`, `hubDocToDocRow`
- `App.tsx` 未传递 documents prop（刚被移除，因为原来是空函数）
- 缺失：DocsPage 在 real mode 下数据为空

**打通步骤：**

| # | 任务 | 涉及文件 | 验收标准 |
|---|------|---------|---------|
| 1 | 恢复 `App.tsx` documents 流 | `App.tsx` | `useDocumentList` → `hubDocToDocRow` → `documents` prop → `AgentHubWorkbench` |
| 2 | `WorkbenchRoutes` → `DocsPage` | `WorkbenchRoutes.tsx` | `documents` prop 传递，real mode 下显示 Hub 数据 |
| 3 | 创建文档 | `DocsPage.tsx` | 新建→调用 `useCreateDocument`→刷新列表 |
| 4 | 文档预览 | `DocsPage.tsx` | 点击文档→preview panel 显示内容 |
| 5 | 删除/编辑文档 | `DocsPage.tsx` | 调用 `updateDocument`/`deleteDocument` |

---

### 3.6 项目管理 (ProjectsPage)

**目标：** Hub workspace projects CRUD + threads + messages。

**当前状态：**
- UI：`ProjectsPage` 有 list + detail + tabs
- Hub 端点：`GET/POST /web/projects`, `GET/PATCH /web/projects/:id`
- `hubQueries.ts`：`useHubWorkspaceProjects`, `useCreateHubWorkspaceProject`, `useUpdateHubWorkspaceProject`
- `useDesktopWorkbenchModel` 已调用这些 hooks 并返回 `projects`
- 缺失：ProjectsPage 在 real mode 下未使用传入数据

**打通步骤：**

| # | 任务 | 涉及文件 | 验收标准 |
|---|------|---------|---------|
| 1 | ProjectsPage 接受 projects prop | `WorkbenchRoutes.tsx` → `ProjectsPage.tsx` | 当 `projects` prop 非空时显示 |
| 2 | 创建/编辑项目 | `ProjectsPage.tsx` | 走 `useCreateHubWorkspaceProject`/`useUpdateHubWorkspaceProject` mutations |
| 3 | 项目 threads 展示 | `ProjectsPage.tsx` | 调用 Hub `GET /web/projects/:id/threads` |
| 4 | 项目内 messages | Projects detail tab | 调用 Hub `GET /web/projects/:id/threads/:threadId/messages` |

---

### 3.7 设置页 (SettingsPage)

**目标：** 所有设置项持久化到 Hub Settings API + Edge Settings API（双写）。

**当前状态：**
- UI：30+ settings sections（见 exploration report）
- Desktop settings 类型：`SettingsPort` 接口 + `settingsService.ts`
- Hub 端点：`GET/PATCH /client/settings`
- Edge 端点：`GET/PATCH /v1/settings`
- `DesktopSettingsAdapter` 实现 SettingsPort（Edge primary, Hub sync, localStorage fallback）
- 缺失：SettingsPage 未使用 `settingsService`

**打通步骤：**

| # | 任务 | 涉及文件 | 验收标准 |
|---|------|---------|---------|
| 1 | SettingsPage 接收 `settingsService` prop | `WorkbenchRoutes.tsx` → `SettingsPage.tsx` | 设置可通过 service 读写 |
| 2 | 每个 section 对接对应 setting key | 各 `*Section.tsx` 文件 | 开关/下拉/输入变化→`settingsService.write` |
| 3 | Settings 双写 Hub + Edge | `desktopSettingsAdapter.ts` | 有 Hub token 时写 Hub API，无 Hub 时写 Edge |
| 4 | Settings 同步加载 | `settingsService.ts` | mount 时从 Hub/Edge 读取最新值 |

---

### 3.8 SDK 接入

**目标：** Claude Agent SDK / OpenAI Agents SDK / custom runtime 输出 typed events → artifact/diff/preview。

**当前状态：**
- Edge fixture adapter runner 已合入（fake process fixture）
- SDK fixture capability evidence 已合入（静态样例）
- 不支持真实 SDK 安装/调用

**打通步骤：**

| # | 任务 | 涉及文件 | 验收标准 |
|---|------|---------|---------|
| 1 | Claude Agent SDK adapter | `edge-server/internal/adapters/claude-sdk/` | 调用 Anthropic API→event stream→存储到 Edge SQLite |
| 2 | OpenAI Agents SDK adapter | `edge-server/internal/adapters/openai-sdk/` | 调用 OpenAI API→event stream→存储 |
| 3 | Custom runtime adapter | `edge-server/internal/adapters/custom/` | 命令行 or HTTP callback→event stream |
| 4 | SDK event matrix tests | `edge-server/internal/adapters/*_test.go` | text/tool/file_change/permission/result/artifact events 全覆盖 |
| 5 | approved-real 前置检查 | `scripts/verify-approved-real-*.ps1` | 检查 API key 存在但不写入仓库 |

---

### 3.9 CLI 接入

**目标：** Claude Code (`stream-json`)、Codex (`exec --json`)、OpenCode (`run --format json`) 适配器统一输出 typed events。

**当前状态：**
- CLI JSON readiness 已合入
- Edge fixture adapter 可模拟 CLI 输出
- Desktop `localCliDiscovery()` 可检测 CLI 安装
- 不支持真实 CLI 调用

**打通步骤：**

| # | 任务 | 涉及文件 | 验收标准 |
|---|------|---------|---------|
| 1 | Claude Code adapter 完善 | `edge-server/internal/adapters/claude-code/` | `claude --stream-json` 输出→unified events |
| 2 | Codex adapter 完善 | `edge-server/internal/adapters/codex/` | `codex exec --json` 输出→unified events |
| 3 | OpenCode adapter 完善 | `edge-server/internal/adapters/opencode/` | `opencode run --format json`→unified events |
| 4 | Permission bridge | per-adapter | approval request→Hub→UI approve/deny→resume adapter |
| 5 | CLI 安装验证 | `scripts/verify-cli-install.ps1` 新建 | 检测 claude/codex/opencode 版本、路径、权限 |
| 6 | E2E: @Agent 真实调用 | 聊天输入 `@Builder 帮我创建文件` → Claude Code 真实执行 → Diff 显示在聊天 |

---

### 3.10 Tauri 配置 + 打包

**目标：** Windows/macOS 双平台可发布包 + sidecar 本地 Edge。

**当前状态：**
- Windows unsigned dry package 已产出（NSIS installer + portable zip + sidecar + SHA-256 hash）
- macOS 策略已确立但未产出 dry package
- Tauri 2.x config 已就绪

**打通步骤：**

| # | 任务 | 涉及文件 | 验收标准 |
|---|------|---------|---------|
| 1 | Windows 签名 | CI workflow | EV Code Signing certificate 签名 |
| 2 | macOS dry package | CI workflow | Unsigned DMG + sidecar + entitlements |
| 3 | macOS notarization | CI workflow | Apple notary service 公证 |
| 4 | Updater metadata | `latest.json` + `.sig` | Tauri updater 可检测新版本 |
| 5 | GitHub Release upload | CI workflow | CI 自动上传 artifacts 到 Release |
| 6 | Sidecar Edge Windows | `src-tauri/` | 打包内置 agenthub-edge.exe |
| 7 | Auto-start Edge on Desktop launch | `src-tauri/src/main.rs` | Desktop 启动时自动启动 sidecar Edge |

---

### 3.11 Mobile 对齐 Web/Desktop

**目标：** Mobile (React Native) 消费同一套 Hub API，UI 功能对齐。

**当前状态：**
- Mobile RN 89 tests 通过
- Hub contracts aligned
- 缺失：mobile Hub queries 未全部接入

**打通步骤：**

| # | 任务 | 涉及文件 | 验收标准 |
|---|------|---------|---------|
| 1 | Mobile 接入 Hub sessions API | Mobile queries | 会话列表来自真实 Hub |
| 2 | Mobile 接入 Hub messages API | Mobile queries | 消息发送/接收来自真实 Hub |
| 3 | Mobile 接入 Hub contacts API | Mobile queries | 通讯录来自真实 Hub |
| 4 | Mobile WebSocket | Mobile realtime | 实时推送消息 |
| 5 | Mobile run/task 查看 | Mobile views | 查看运行状态/产物 |
| 6 | Mobile 审核通过 | Play Store / App Store | 至少提交审核 |

---

### 3.12 i18n 完善

**目标：** 中英文覆盖所有 UI 文本。

**当前状态：**
- `zh.json` ~925 keys
- `en.json` ~692 keys
- i18next + react-i18next 完整架构
- 缺失：en 比 zh 少 ~230 个 key

**打通步骤：**

| # | 任务 | 涉及文件 | 验收标准 |
|---|------|---------|---------|
| 1 | 补齐 en locales | `app/desktop/src/i18n/locales/en.json` | en key 数 = zh key 数 |
| 2 | Shared workbench locales | `app/shared/src/i18n/workbench.ts` | 所有共享组件 key 双语 |
| 3 | 运行时语言切换 | Language selector in Settings | 切换语言→全界面即时更新 |

---

### 3.13 E2E 测试

**目标：** 完整数据流自动化测试覆盖。

**当前状态：**
- Web: `app/e2e/smoke.spec.ts` — 1 个 smoke test
- Desktop: 3 个 spec files — 2 smoke + oidc-login + teamrun-ui-evidence
- 缺失：无真实数据流测试

**打通步骤：**

| # | 任务 | 验收标准 |
|---|------|---------|
| 1 | `chat-real.spec.ts` 新建 | 登录→拉取会话→发消息→接收→WebSocket 推送→搜索 |
| 2 | `contacts-real.spec.ts` 新建 | 搜索用户→加好友→接受→备注→拉黑→解除 |
| 3 | `agent-real.spec.ts` 新建 | 创建 Agent profile→编辑→选中→@Agent 调用 |
| 4 | `documents-real.spec.ts` 新建 | 创建文档→查看→编辑→删除 |
| 5 | `projects-real.spec.ts` 新建 | 创建项目→查看 threads→发消息 |
| 6 | CI pipeline 集成 | 所有 E2E 在 GitHub Actions 跑（需 Hub+Edge 启动） |

---

## 4. 依赖顺序（关键路径）

```
Phase 1 (本周): TokenDanceID 真实登录打通
  └─ 3.3 完成 → Hub auth token 可用 → 所有 Hub queries 可启用

Phase 2 (紧随): Core data flows
  ├─ 3.1 IM 聊天 → Hub sessions + messages API
  ├─ 3.2 通讯录 → Hub contacts API  
  ├─ 3.4 Agent 配置 → Edge agent-profiles API
  └─ 3.7 设置 → Hub + Edge settings API

Phase 3: Extended flows
  ├─ 3.5 云文档 → Hub documents API
  ├─ 3.6 项目管理 → Hub projects API
  ├─ 3.12 i18n → en locale 补齐
  └─ 3.11 Mobile → Hub API alignment

Phase 4: Runtime integration
  ├─ 3.9 CLI 接入 → Claude Code/Codex/OpenCode 真实调用
  └─ 3.8 SDK 接入 → Anthropic/OpenAI API 真实调用

Phase 5: Release
  ├─ 3.10 Tauri → 签名 + 打包 + 发布
  ├─ 3.13 E2E → 全流程自动化
  └─ Release governance → changelog + gate + rollback
```

---

## 5. 非协商边界

- Web 只和 Hub 通信，不直接连接 Local Edge 或 raw runtime。
- Desktop renderer 不获得 raw process execution 权限。
- Local Edge 负责本地执行、adapter 调用、runtime policy。
- Hub 负责账号、IM、同步、路由、权限、审计。
- mock/fixture/observed/approved-real/production 必须显式区分。
- real mode 不能静默降级到 demo。
- 真实登录、真实模型消耗、部署、签名都需要明确审批。
- 文档只写路线；当前事实写在 `STATE.md`。

---

## 6. 验收清单 (Release Gate)

在宣称 "Release 完成，全部真实打通" 之前，以下每一项必须通过：

### 6.1 登录与认证
- [ ] TokenDanceID OIDC PKCE 全链路可通过
- [ ] 登录后 Hub JWT 可用，所有 protected 端点返回 200
- [ ] Token refresh 自动工作，不影响活跃 WebSocket
- [ ] 登出清理所有 localStorage/sessionStorage

### 6.2 IM 聊天
- [ ] 会话列表从 Hub `/client/sessions` 加载
- [ ] 发送文本消息→Hub 存储→WebSocket 推送到对端
- [ ] @Agent mention 触发 Edge run（真实 Claude Code 调用）
- [ ] 消息 pin/unpin/reaction/forward/recall/edit 全部可操作
- [ ] 消息搜索返回正确结果
- [ ] 已读状态同步

### 6.3 通讯录
- [ ] 搜索用户→发送好友请求→对方可见
- [ ] 接受/拒绝好友请求同步到双方
- [ ] 联系人备注/拉黑/删除生效
- [ ] 创建群组→选择联系人→建群成功

### 6.4 Agent 配置
- [ ] 创建 Agent profile→Edge 持久化→重启后仍在
- [ ] 编辑/删除 Agent profile 生效
- [ ] Model catalog 从 Edge API 读取真实数据
- [ ] Runtime 选择对应已安装 CLI

### 6.5 云文档
- [ ] 文档列表从 Hub API 加载
- [ ] 创建/编辑/删除文档同步
- [ ] 文档预览显示内容

### 6.6 项目管理
- [ ] 项目列表从 Hub API 加载
- [ ] 创建/编辑项目同步
- [ ] 项目内 threads/messages 可查看

### 6.7 设置
- [ ] Theme/density/language 等设置可修改并持久化
- [ ] 设置重启后保留
- [ ] Hub 和 Edge 双写一致

### 6.8 Runtime 执行
- [ ] @Agent 真实调用 Claude Code→输出显示在聊天
- [ ] @Agent 真实调用 Codex→输出显示在聊天
- [ ] 执行产物（diff/artifact/preview）显示在右侧栏
- [ ] 审批流程：高风险操作→弹审批→用户决定→执行继续/中断

### 6.9 跨平台
- [ ] Desktop (Tauri) 签名包可安装
- [ ] Web 部署可访问
- [ ] Mobile 能登录并查看会话列表

### 6.10 E2E
- [ ] `pnpm e2e` 全部通过（至少 6 个 spec）
- [ ] CI 绿（Go tests + pnpm typecheck + pnpm test + E2E）

---

## 7. 文件变更清单（预期）

| 操作 | 文件 | 原因 |
|------|------|------|
| **新建** | `app/desktop/src/api/sessionQueries.ts` | Hub sessions/messages/react-query hooks |
| **新建** | `app/desktop/src/hooks/useHubWebSocket.ts` | Hub WebSocket 连接 + 事件分发 |
| **新建** | `app/e2e/chat-real.spec.ts` | IM 聊天 E2E |
| **新建** | `app/e2e/contacts-real.spec.ts` | 通讯录 E2E |
| **新建** | `app/e2e/agent-real.spec.ts` | Agent 配置 E2E |
| **新建** | `app/e2e/documents-real.spec.ts` | 文档 E2E |
| **新建** | `app/e2e/projects-real.spec.ts` | 项目 E2E |
| **新建** | `scripts/verify-cli-install.ps1` | CLI 安装验证 |
| **修改** | `app/desktop/src/App.tsx` | 恢复 documents 流 + userDisplayName 优先 Hub |
| **修改** | `app/desktop/src/platform/useDesktopWorkbenchModel.ts` | Real mode 使用 Hub sessions 代替 Edge threads |
| **修改** | `app/desktop/src/api/hubQueries.ts` | 添加 contacts mutations + sessions queries |
| **修改** | `app/shared/src/workbench/WorkbenchRoutes.tsx` | 所有子页接收 real data props |
| **修改** | `app/shared/src/workbench/pages/ContactsPage.tsx` | 使用 contacts/contactsActions props |
| **修改** | `app/shared/src/workbench/pages/DocsPage.tsx` | 使用 documents prop |
| **修改** | `app/shared/src/workbench/pages/ProjectsPage.tsx` | 使用 projects prop |
| **修改** | `app/shared/src/workbench/pages/AgentsPage.tsx` | 使用 agentConfigs prop |
| **修改** | `app/shared/src/workbench/pages/SettingsPage.tsx` | 使用 settingsService prop |
| **修改** | `app/desktop/src/i18n/locales/en.json` | 补齐缺失 keys |
| **修改** | `edge-server/internal/adapters/claude-code/` | 真实 CLI 调用 |
| **修改** | `edge-server/internal/adapters/codex/` | 真实 CLI 调用 |
| **修改** | `edge-server/internal/adapters/opencode/` | 真实 CLI 调用 |
