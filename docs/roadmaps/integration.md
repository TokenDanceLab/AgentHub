# Hub Server + Edge Server + Desktop 集成分析

> 生成于 2026-05-24，基于对全部三个代码库的完整源码审查。
> 分支：`dev/delicious233`

---

## 1. 架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                          AgentHub System                            │
│                                                                     │
│  ┌──────────────┐     JWT/REST+WS      ┌──────────────────────┐    │
│  │  Web Client  │ ──────────────────►  │    Hub Server        │    │
│  │  (browser)   │                      │  (Gin, :8080)        │    │
│  │              │  /web/agent-tasks    │                      │    │
│  │              │  /web/custom-agents  │  ┌────────────────┐  │    │
│  └──────────────┘                      │  │ Auth (JWT)     │  │    │
│                                        │  │ IM (Session/   │  │    │
│  ┌──────────────┐    /edge/* callbacks  │  │   Message)     │  │    │
│  │  Desktop App │ ◄──────────────────► │  │ Contacts       │  │    │
│  │  (React)     │                      │  │ Notifications  │  │    │
│  │              │  agent.dispatch (WS)  │  │ Agent Orch.    │  │    │
│  │  ┌────────┐  │                      │  │ EventBus       │  │    │
│  │  │Hub     │  │  /client/ws           │  │ WS Manager     │  │    │
│  │  │Client  │  │  (auth frame proto)   │  └────────────────┘  │    │
│  │  │(NEW!)  │  │                      │                      │    │
│  │  ├────────┤  │                      │  DB: PostgreSQL      │    │
│  │  │Edge    │  │                      │  Cache: Redis        │    │
│  │  │Client  │  │                      └──────────────────────┘    │
│  │  │(exists)│  │                                                 │
│  │  └────────┘  │  /v1/events (WS)                                 │
│  │       │      │  /v1/runs (REST)                                 │
│  │       │      │  /v1/permissions/decide                          │
│  │       ▼      │                      ┌──────────────────────┐    │
│  │  @shared/    │  gorilla/websocket   │   Edge Server        │    │
│  │  events.ts   │  EventEnvelope       │  (net/http, :3210)   │    │
│  │  types.ts    │  cursor replay        │                      │    │
│  └──────────────┘                      │  Runner Registry     │    │
│                                        │  Agent Adapters      │    │
│  ┌──────────────┐                      │  Process Executor    │    │
│  │  CLI Tools   │  local exec          │  EventBus (seq)      │    │
│  │  (Claude     │ ◄──────────────────► │  In-Memory Store     │    │
│  │   Code, etc) │  stdin/stdout        │                      │    │
│  └──────────────┘                      │  CORS: Trusted Local │    │
│                                        └──────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

**关键双连接模式**：Desktop 同时连接两个服务：
1. **Edge Server**（本地，`127.0.0.1:3210`）：通过 WebSocket（`/v1/events`）获取 Agent 执行生命周期事件，以及通过 REST 管理 runs/threads。无认证。
2. **Hub Server**（远程，`:8080`）：用于 IM（会话、消息、联系人）、认证、接收 `agent.dispatch` 任务并上报任务进度回调。JWT 认证。

---

## 2. API 接口对比

### Hub Server 路由（来自 `hub-server/internal/router/router.go`）

| 路由组 | 方法 | 路径 | 认证 | 设备 | 用途 |
|-------|--------|------|------|--------|---------|
| **Health** | GET | `/health` | 否 | 任意 | 存活检查 |
| **Auth** | POST | `/client/auth/register` | 否 | 任意 | 注册 |
| **Auth** | POST | `/client/auth/login` | 否 | 任意 | 登录（返回 JWT） |
| **Auth** | POST | `/client/auth/refresh` | 否 | 任意 | 刷新令牌 |
| **Auth** | POST | `/client/auth/logout` | JWT | 任意 | 登出 |
| **Auth** | GET | `/client/auth/me` | JWT | 任意 | 当前用户 |
| **Auth** | PUT | `/client/auth/profile` | JWT | 任意 | 更新个人资料 |
| **Auth** | PUT | `/client/auth/password` | JWT | 任意 | 修改密码 |
| **WS** | GET | `/client/ws` | 帧 | 任意 | IM + 调度 |
| **Contacts** | GET/POST/DELETE | `/client/contacts/*` | JWT | 任意 | 好友管理 |
| **Sessions** | GET/POST/PUT/DELETE | `/client/sessions/*` | JWT | 任意 | IM 会话 |
| **Messages** | POST/GET | `/client/sessions/:id/messages*` | JWT | 任意 | 聊天消息 |
| **Messages** | POST/DELETE | `/client/messages/:id/*` | JWT | 任意 | 撤回/置顶/转发 |
| **Attachments** | POST/GET | `/client/attachments/*` | JWT | 任意 | 文件上传/下载 |
| **Notifications** | GET/POST | `/client/notifications/*` | JWT | 任意 | 通知管理 |
| **Edge** | POST | `/edge/devices/register` | JWT | desktop | 注册设备 |
| **Edge** | POST | `/edge/agent-tasks/:id/ack` | JWT | desktop | 任务确认 |
| **Edge** | POST | `/edge/agent-tasks/:id/stream` | JWT | desktop | 流式输出 |
| **Edge** | POST | `/edge/agent-tasks/:id/done` | JWT | desktop | 任务完成 |
| **Edge** | POST | `/edge/agent-tasks/:id/fail` | JWT | desktop | 任务失败 |
| **Web** | POST | `/web/agent-tasks` | JWT | web | 触发任务 |
| **Web** | POST | `/web/agent-tasks/:id/cancel` | JWT | web | 取消任务 |
| **Web** | GET/POST/PUT/DELETE | `/web/custom-agents*` | JWT | web | 自定义 Agent CRUD |

### Edge Server 路由（来自 `edge-server/internal/api/handlers.go`）

| 方法 | 路径 | 用途 |
|--------|------|---------|
| GET | `/v1/health` | 存活检查 |
| GET | `/v1/runners` | 列出 Runner |
| GET | `/v1/agents` | 列出 Agent 适配器 |
| GET/POST | `/v1/projects` | 项目列表/创建 |
| GET | `/v1/projects/:id` | 获取项目 |
| GET/POST | `/v1/threads` | 线程列表/创建 |
| GET | `/v1/threads/:id` | 获取线程 |
| GET | `/v1/threads/:id/items` | 线程项 |
| POST | `/v1/threads/:id/messages` | 发布消息 |
| GET | `/v1/items/:id` | 获取项 |
| GET/POST | `/v1/runs` | 运行列表/启动 |
| POST | `/v1/runs/:id:cancel` | 取消运行 |
| GET | `/v1/runs/:id` | 获取运行 |
| GET (WS) | `/v1/events` | 事件流 |
| POST | `/v1/permissions/decide` | 权限门控 |

### 关系：互补，而非重复

Hub 和 Edge 服务于完全不同的领域，只有一个连接点：

- **Hub**：远程云服务，用于 IM、认证、多用户协调、Agent 任务调度
- **Edge**：本地机器服务，用于 Agent 执行、进程管理、事件流
- **连接**：Hub 向 Desktop 调度 Agent 任务，Desktop 委托 Edge 执行，Desktop 将结果回报给 Hub

唯一相似的 API 特征是两者都提供 WebSocket + REST。它们的端点路径、数据模型和事件模式完全不同。

---

## 3. WebSocket 协议对比

| 特性 | Hub WS（`/client/ws`） | Edge WS（`/v1/events`） |
|---------|----------------------|------------------------|
| **库** | `coder/websocket`（通过 Gin） | `gorilla/websocket`（原生） |
| **认证** | 5 秒内发送 JWT auth 帧 | 无（受信任的本地来源） |
| **事件格式** | `{ "type": "message.new", "payload": {...} }` | `{ "version": "v1", "id": "...", "seq": 123, "type": "...", "scope": {...}, "payload": {...} }` |
| **客户端→服务器消息** | `auth`、`typing` | `permission_decide` |
| **服务器→客户端事件** | `message.{new,recall,pin,unpin,read}`、`agent.{dispatch,done,failed,cancel,timeout}`、`device.{online,offline,kicked}`、`notification.new`、`session.*`、`friend.*` | `runner.{online,offline}`、`run.{queued,started,finished,failed,cancelled}`、`run.agent.{text_delta,text_block,thinking,tool_call,tool_result,file_change,session_init,result,task_dispatched,permission_requested,permission_decided}`、`run.output{,.batch}`、`error` |
| **回放** | 无（错过时需通过 REST 同步） | 基于游标（`?cursor=<seq>`），完整历史回放 |
| **心跳** | 服务器每 30s ping，2 次丢失 → 断开 | 服务器每 30s ping |
| **连接生命周期** | 每个连接一个 Gin handler goroutine | 专用写 goroutine + 读 goroutine |

**关键差异**：Hub WS 是**消防水管**（所有事件推送，无回放）。Edge WS 是**可回放的事件日志**（单调 seq，基于游标的追补）。Desktop 连接到 Hub 后，需要单独的机制（REST 同步 API `/client/sessions/:id/messages/sync`）来追补错过的消息。

---

## 4. 数据模型映射

### Hub 模型（PostgreSQL/GORM）

位于 `hub-server/internal/model/`：

| 模型 | 表 | 关键字段 |
|-------|-------|------------|
| `User` | users | `id`、`username`、`password_hash`、`nickname`、`avatar_url` |
| `Session` | sessions | `id`、`type`（private/group）、`name`、`owner_user_id`、`next_seq`、`dissolved` |
| `SessionMember` | session_members | `id`、`session_id`、`member_type`（user/agent_instance）、`member_id`、`role`、`pinned`、`archived`、`muted`、`last_read_seq`、`left_at` |
| `Message` | messages | `id`、`session_id`、`seq_id`、`client_msg_id`、`sender_type`（user/agent）、`sender_id`、`content_type`、`content`（JSONB）、`reply_to_message_id`、`recalled` |
| `AgentInstance` | agent_instances | `id`、`agent_type`、`custom_agent_id`、`session_id`、`inviter_user_id`、`display_name` |
| `PendingAgentTask` | pending_agent_tasks | `id`、`agent_instance_id`、`triggered_by_user_id`、`trigger_message_id`、`status`（queued/dispatched/running/done/failed/timeout/cancelled）、`expire_at` |
| `CustomAgent` | custom_agents | `id`、`owner_user_id`、`name`、`agent_type`、`system_prompt`、`capability_tags`、`tool_whitelist`、`model_params` |
| `Device` | devices | `id`、`user_id`、`device_type`、`app_version`、`capabilities`（JSONB） |
| `Friendship` | friendships | `id`、`user_id`、`friend_id`、`status`（pending/accepted/rejected/blocked）、`remark` |
| `MessagePin` | message_pins | `id`、`session_id`、`message_id`、`pinned_by_user_id` |

### Edge 模型（内存）

位于 `edge-server/internal/store/`。无数据库 — 使用内存 map：

| 概念 | 关键字段 |
|---------|------------|
| `Project` | `ID`、`Name`、`CreatedAt` |
| `Thread` | `ID`、`ProjectID`、`Title`、`Status`、`CreatedAt`、`UpdatedAt` |
| `Item` | `ID`、`ProjectID`、`ThreadID`、`RunID`、`Type`、`Role`、`Status`、`Content` |
| `Run` | `ID`、`ProjectID`、`ThreadID`、`Status`、`Prompt`、`AgentID`、`Model`、`SessionID`、`CreatedAt`、`StartedAt`、`FinishedAt` |
| `Runner` | `ID`、`Name`、`Status`、`Capabilities` |

### 映射表

| Hub 概念 | Edge 概念 | Desktop 类型 | 对齐情况 |
|-------------|-------------|--------------|-----------|
| `Session`（聊天室） | `Project` + `Thread`（工作上下文） | `ThreadInfo` | 不同：Hub 围绕会话组织；Edge 围绕项目组织。可通过 SessionID **桥接**：Hub Session 映射到 Edge Project+Thread。 |
| `Message`（带 seq 的聊天消息） | `Item`（线程项） | `ChatMessage`（块） | 结构不同但方向兼容。Hub Message.content 是 JSONB 文本；Edge Item 是带类型的（run/output/message）。Hub `sender_type=agent` 消息对应 Edge `run.agent.*` 事件。 |
| `AgentInstance` | Agent 适配器（`adapters.AgentAdapter`） | `AgentInfo` | Hub 有按会话的实例（被邀请到群组中）。Edge 有按 Agent 类型的适配器（所有 run 共享）。Hub："此聊天中哪个 agent？"，Edge："执行哪个二进制？" |
| `PendingAgentTask`（queued→dispatched→running→done/failed） | `Run`（queued→started→finished/failed） | `RunInfo`（status） | **直接对应**。Hub 任务状态追踪外部生命周期；Edge run 状态追踪内部执行。Desktop 桥接二者。 |
| `CustomAgent`（system_prompt、tool_whitelist、model_params） | 不适用（Edge 使用静态适配器配置） | 不适用 | Hub 有可自定义的 Agent；Edge Agent 是固定适配器。Hub 自定义 Agent 配置 Edge 应运行什么。 |
| `Device`（用户设备注册） | 不适用（单机） | 不适用 | Hub 追踪多设备；Edge 是单实例。Hub Device 告诉 Hub 调度到哪个 Desktop 连接。 |
| `Friendship`（社交） | 不适用 | 不适用 | Hub 独有的社交功能。 |
| `User`（账户） | 不适用（无认证） | 不适用 | Hub 独有的账户系统。 |

### 事件类型映射（关键桥梁）

| Hub WS 帧类型 | Edge EventEnvelope 类型 | Desktop 处理器 | 需要桥接？ |
|-------------------|------------------------|-----------------|----------------|
| `agent.dispatch`（→ desktop） | → 触发 `POST /v1/runs` | → `startRun()` 在 `edgeClient.ts` 中 | **是** — Desktop 必须将 dispatch 载荷翻译为 Edge run 请求 |
| Agent runs → 生成 | `run.agent.text_delta` | `useChatMessages.ts` 渲染 | 已生效（Edge→Desktop） |
| Agent runs → 生成 | `run.agent.result` | `useChatMessages.ts` 渲染 | 已生效 |
| Desktop 调用 → | `POST /edge/agent-tasks/:id/stream`（→ Hub） | → 在 Hub 上广播 `message.new` | **是** — Desktop 必须将 Edge 输出转发到 Hub |
| Desktop 调用 → | `POST /edge/agent-tasks/:id/done`（→ Hub） | → 在 Hub 上广播 `agent.done` | **是** — Desktop 必须向 Hub 通知完成 |
| Hub `message.new` | 不适用（Edge 无 IM） | 必须渲染 IM 消息 | **是** — 需要新的 IM 消息 UI |
| Hub `notification.new` | 不适用 | 必须渲染通知 | **是** — 需要新的通知 UI |
| Hub `device.online`/`device.offline` | 不适用 | 必须显示在线状态 | **是** — 需要新的在线状态 UI |
| Edge `run.agent.permission_requested` | Desktop 渲染权限对话框 | Desktop 向 Edge 发送 `permission_decide` | 已生效（Edge→Desktop→Edge 循环） |

---

## 5. 认证集成方案

### 当前状态
- **Hub**：JWT 认证，claims 为 `{user_id, device_type, device_id, exp}`。按设备类型限制访问（`web` → `/web/*`、`desktop` → `/edge/*`）。
- **Edge**：无认证。CORS 限制为受信任的本地来源（`http://localhost:*`、`http://127.0.0.1:*`、`tauri://*`）。
- **Desktop**：无认证。直接与本地 Edge 通信。

### 集成路径

Desktop 需要成为经过认证的 Hub 客户端，同时保持为直接的 Edge 客户端：

```
Desktop 认证流程：
1. 用户登录 → POST /client/auth/login，带 device_type="desktop"
2. 存储 JWT access_token + refresh_token
3. 所有 Hub REST 调用：Authorization: Bearer <access_token>
4. Hub WS：发送 auth 帧 {type: "auth", payload: {access_token: "..."}}
5. 令牌刷新：在过期前调用 POST /client/auth/refresh（900s）
6. Edge 调用：不变（本地无需认证）
```

**需要新增的 Desktop 模块**：`app/desktop/src/api/hubAuth.ts`
- `login(username, password, deviceId) → tokens`
- `getStoredToken() → string | null`
- `refreshToken() → void`（收到 401 或定时器触发时调用）
- `logout() → void`

---

## 6. Desktop 集成变更

### 需要新增的文件

1. **`app/desktop/src/api/hubClient.ts`** — Hub Server 的 REST 客户端
   - `login()`、`register()`、`refreshToken()`、`logout()`、`getMe()`
   - `listSessions()`、`createPrivateSession()`、`createGroupSession()`
   - `getMessages(sessionId, beforeSeq)`、`sendMessage(sessionId, content)`
   - `listContacts()`、`searchUser()`、`sendFriendRequest()`
   - `registerDevice(deviceId, capabilities)`
   - `ackTask(taskId)`、`streamTask(taskId, content)`、`doneTask(taskId, finalContent)`、`failTask(taskId, error)`

2. **`app/desktop/src/api/hubWS.ts`** — Hub 的 WebSocket 客户端
   - 不同协议：auth 帧、无游标回放、不同的事件类型
   - `connect(token)` → 发送 auth 帧，收到 `auth.ok`/`auth.fail`
   - `subscribe(handler)` → 接收 Hub WS 帧事件
   - 重连逻辑（类似 `eventClient.ts`，但需要重新进行 auth 握手）

3. **`app/desktop/src/hooks/useHubIntegration.ts`** — Hub 和 Edge 之间的桥梁
   - 监听 Hub `agent.dispatch` 事件
   - 将 `dispatchPayload` 翻译为 Edge 的 `StartRunRequest`
   - 通过 `edgeClient.ts` 调用 `startRun()`
   - 订阅此次运行的 Edge 事件
   - 将 `run.agent.text_delta` 转发为 Hub 的 `streamTask()`
   - 在 `run.agent.result` 时向 Hub 调用 `doneTask()` 或 `failTask()`
   - 映射 `runId` ↔ `taskId` 以进行双向追踪

### 需要修改的文件

1. **`app/desktop/src/config.ts`** — 添加 Hub URL
   ```
   export const HUB_URL = 'http://<hub-host>:8080';
   export const HUB_WS_URL = 'ws://<hub-host>:8080/client/ws';
   ```

2. **`app/desktop/src/api/edgeClient.ts`** — 添加 `StartRunRequest.sessionId` 映射
   - `StartRunRequest` 中的 `sessionId` 字段已存在（`PostRuns` handler 第 311 行：`SessionID`）。
   - 在桥接 Hub→Edge 时，将 `sessionId` 设为 Hub 的 `SessionID`，以便 Edge run 与 Hub 会话关联。

3. **`app/shared/src/events.ts`** — 无需变更（Edge 事件保持不变）

4. **`app/shared/src/types.ts`** — 添加 Hub 特定类型
   - `HubSession`、`HubMessage`、`HubContact`、`HubUser`、`HubDispatchPayload`

---

## 7. 集成方案 — 分阶段实施

### 阶段 1：Desktop 认证 + Hub REST 客户端（工作量：3 天）
**目标**：Desktop 能够认证 Hub 并调用 REST API。

**文件**：
- 新增 `app/desktop/src/api/hubClient.ts` — 带类型的 REST 封装
- 新增 `app/desktop/src/api/hubAuth.ts` — 令牌管理
- 修改 `app/desktop/src/config.ts` — 添加 `HUB_URL`

**任务**：
1. 实现 `hubAuth.ts`：登录、令牌存储（localStorage）、刷新定时器
2. 实现 `hubClient.ts`：认证端点（login、refresh、me）
3. 在 StatusBar 中添加 Hub 连接状态

**验证**：Desktop 可以登录、查看用户信息、维持会话。

---

### 阶段 2：Hub WebSocket 客户端（工作量：2 天）
**目标**：Desktop 建立经过认证的 Hub WS 连接，接收事件。

**文件**：
- 新增 `app/desktop/src/api/hubWS.ts` — 含 auth 帧协议的 Hub WS 客户端
- 新增 `app/shared/src/hubEvents.ts` — Hub WS 事件类型

**任务**：
1. 实现 `hubWS.ts`：通过 auth 帧连接、解析 Frame 消息
2. 定义 Hub 事件类型：`message.new`、`agent.dispatch`、`notification.new` 等
3. 创建 `useHubEventStream` hook
4. 在 StatusBar 中添加 Hub 连接指示器

**验证**：Desktop 接收到 Hub 事件（从 Web 登录，在控制台看到事件）。

---

### 阶段 3：Agent 任务桥接（工作量：4 天）
**目标**：Desktop 从 Hub 接收 agent.dispatch，通过 Edge 执行，回报结果。

**文件**：
- 新增 `app/desktop/src/hooks/useHubIntegration.ts` — Hub↔Edge 桥接
- 修改 `edge-server/internal/api/handlers.go` — 无需变更（现有 API 足够）

**任务**：
1. 监听 Hub `agent.dispatch` 事件
2. 解析 `dispatchPayload` → 提取 agent_type、session_id、system_prompt 等
3. 为 Hub 会话创建 Edge Project+Thread（或使用已有）
4. 使用适当的 prompt 和 agent 配置调用 `startRun()`
5. 将 Edge `run.agent.*` 事件映射为 Hub `streamTask()` 调用
6. 将 Edge `run.agent.result` 映射为 Hub `doneTask()` 或 `failTask()`
7. 处理任务取消（Hub `agent.cancel` → Edge `cancelRun()`）
8. 在启动时向 Hub 注册设备（`POST /edge/devices/register`）

**验证**：Web 触发 Agent → Desktop 收到调度 → Edge 运行 → Web 在聊天中看到 Agent 消息。

---

### 阶段 4：Desktop 中的 IM UI（工作量：5 天）
**目标**：Desktop 像完整的 IM 客户端一样渲染聊天会话、消息和联系人。

**文件**：
- 新增 `app/desktop/src/components/ChatView/*` — IM UI 组件
- 新增 `app/desktop/src/hooks/useHubSessions.ts`
- 新增 `app/desktop/src/hooks/useHubMessages.ts`

**任务**：
1. 会话列表侧边栏（列出会话、创建私聊/群组、搜索）
2. 消息视图（聊天气泡 UI，区分 Agent 和用户）
3. 消息输入（文本、代码、通过 Hub 附件 API 上传文件）
4. 联系人管理（搜索、添加好友、屏蔽）
5. 通知浮层（好友请求、Agent 完成、@提及）
6. 在线状态指示器（从设备事件获取 online/offline）
7. 增量消息同步（REST `/sync` + WS `message.new`）

**验证**：Desktop 可以完全参与 IM 会话，查看 Agent 输出，管理联系人。

---

### 阶段 5：设备与同步强化（工作量：3 天）
**目标**：稳健的多设备体验，离线容错。

**任务**：
1. 消息同步对账（基于 seq，处理缺口）
2. 离线任务队列（如 Desktop 离线启动，连接后拉取待处理任务）
3. 优雅断开/重连（清除认证状态，重新握手）
4. 设备能力上报（告知 Hub Desktop 支持的 Agent 类型）
5. 权限门控集成（Hub agent.dispatch 包含权限要求）
6. 令牌刷新鲁棒性（WS 收到 401 时重新认证）

**验证**：关闭 Desktop，从 Web 发送消息，重连 Desktop — 所有消息和任务正确同步。

---

### 阶段 6：Edge Server 强化（工作量：2 天）
**目标**：Edge Server 可以作为系统服务运行，处理并发 run。

**文件**：
- 修改 `edge-server/internal/store/` — 可选的持久化 store
- 修改 `edge-server/internal/lifecycle/` — 并发 run 支持

**任务**：
1. 确保多个并发 run 正常工作（每个线程一个）
2. 添加 run 清理（过期 run、资源限制）
3. 可选：在重启后持久化 run 历史
4. 健康检查包含 runner 状态

---

## 8. 工作量估算与当前状态

> 最后更新：2026-05-25

| 阶段 | 描述 | 工作量 | 依赖 | 状态 |
|-------|-------------|--------|-------------|:--:|
| 1 | Hub 认证 + REST 客户端 | 3 天 | 无 | ✅ M5 完成 |
| 2 | Hub WebSocket 客户端 | 2 天 | 阶段 1 | ✅ M5 完成 |
| 3 | Agent 任务桥接 | 4 天 | 阶段 1、2 | ✅ M5 完成 |
| 4 | Desktop 中的 IM UI | 5 天 | 阶段 1、2、3 | 🔄 核心组件完成（IMMessageView/IMMessageInput/IMContactList），侧边栏/附件/通知/在线状态/增量同步待补 |
| 5 | 设备与同步强化 | 3 天 | 阶段 1-4 | ⬜ 未开始 |
| 6 | Edge Server 强化 | 2 天 | 阶段 3 | 🔄 并发 run + Run 清理 + Health check 完成；run 历史持久化待定 |
| **已完成** | 阶段 1-3 | **9 天** | | ✅ |
| **剩余** | 阶段 4-6 | **~10 天** | | 🔄/⬜ |

---

## 9. 关键架构决策 / 风险

### A. 双 WS 连接
Desktop 将同时维护两个 WebSocket 连接：一个到 Hub（IM + 调度），一个到 Edge（Agent 事件）。这是有意为之 — Hub 和 Edge 承担不同的角色。然而，连接生命周期管理变得至关重要。如果任意一端断开，它们之间的桥梁就会断裂。

**缓解措施**：HubIntegration hook 追踪两个连接状态。Hub 断开时，Edge 的 run 继续本地执行，但无法回报结果。Edge 断开时，Hub 调度任务在 Redis 中排队（已实现），重连后重试。

### B. 事件翻译开销
Desktop 必须在两个事件模式之间翻译：
- Hub `agent.dispatch` payload → Edge `StartRunRequest`
- Edge `run.agent.text_delta` → Hub `streamTask(taskId, content)`
- Edge `run.agent.result` → Hub `doneTask(taskId, finalContent)`

此翻译是直接的（字段重映射），但必须正确且完整。

### C. Session/Thread 映射
Hub 的 Session（聊天室）和 Edge 的 Project+Thread（工作上下文）是不同的抽象。桥接需要决定：每个 Hub Session 对应一个 Edge Thread，还是每个 Agent 任务对应一个？

**建议**：每个 Hub Session 对应一个 Edge Project（在 `StartRunRequest` 中使用 `sessionId`），每个 Hub 任务调用对应一个 Edge Thread。这为聊天上下文中的 Agent 运行提供了清晰的隔离。

### D. Edge 无认证
Edge 目前没有认证，因为它被设计为仅限本地使用。如果未来 Edge 需要被网络上其他机器访问，必须添加认证（使用 Hub 颁发的令牌进行 JWT 验证，或使用 API 密钥）。

---

## 10. 引用文件

### Hub Server
- `hub-server/internal/router/router.go` — 所有路由
- `hub-server/internal/handler/auth.go` — 认证处理器
- `hub-server/internal/handler/agent.go` — Agent 处理器 + Edge 回调
- `hub-server/internal/handler/device.go` — 设备注册
- `hub-server/internal/handler/session.go` — 会话处理器
- `hub-server/internal/handler/message.go` — 消息处理器
- `hub-server/internal/handler/response.go` — 响应辅助
- `hub-server/internal/handler/ws.go` — WebSocket 处理器
- `hub-server/internal/service/agent.go` — Agent 服务 + 调度
- `hub-server/internal/service/eventbus.go` — 内部事件总线
- `hub-server/internal/service/message.go` — 消息服务
- `hub-server/internal/service/session.go` — 会话服务
- `hub-server/internal/model/*.go` — 所有数据模型
- `hub-server/internal/ws/frame.go` — WS 帧类型
- `hub-server/internal/ws/manager.go` — WS 连接管理器
- `hub-server/internal/middleware/auth.go` — JWT 认证中间件
- `hub-server/internal/middleware/device_type.go` — 设备类型门控
- `hub-server/cmd/server-hub/main.go` — 服务器组装
- `hub-server/docs/Server-Hub API接口文档.md` — API 文档

### Edge Server
- `edge-server/internal/api/handlers.go` — REST + WS 处理器
- `edge-server/internal/events/bus.go` — 含游标回放的事件总线
- `edge-server/internal/httpserver/server.go` — 服务器组装

### Desktop
- `app/desktop/src/config.ts` — URL 配置
- `app/desktop/src/api/eventClient.ts` — Edge WS 客户端
- `app/desktop/src/api/edgeClient.ts` — Edge REST 客户端
- `app/desktop/src/hooks/useEventStream.ts` — 事件日志 hook
- `app/desktop/src/hooks/useChatMessages.ts` — Agent 事件 → UI
- `app/shared/src/events.ts` — 事件类型定义
- `app/shared/src/types.ts` — REST 类型定义
