# Hub Server

> 子文档 | 主索引：[architecture.md](../architecture.md)
>
> 最后更新：2026-06-10

## 职责

Hub Server（`hub-server/`）是 AgentHub 的云端中枢：

- TokenDance ID relying party（OIDC 认证）
- Hub session 管理
- IM 消息存储和分发
- AgentTeam 编排
- Edge 同步、中继
- 审计日志

## 在架构中的位置

```text
Web shared workbench
  -> Web platform adapter
  -> Hub Server              <-- 本文档
  -> Edge routing / relay
  -> Edge Server
  -> AgentAdapter
```

## 路由表

Hub Server（`hub-server/internal/router/router.go`）使用 Gin 框架，所有路由在 `SetupRoutes` 中注册。

### 全局中间件

CORS、API Version、Body Limit (default 10MB)、Global Rate Limit、Request ID、Access Log、Prometheus Metrics、Request Timeout。

### 路由组

| 路由前缀 | 认证 | 说明 |
|---|---|---|
| `GET /health` `/health/live` `/health/ready` | 无 | 健康检查 |
| `GET /api/public/stats` | 无 | 公开统计 |
| `GET /client/ws` | WS Auth | WebSocket 连接 |
| `POST /client/auth/refresh` | IP Rate Limit | JWT 刷新 |
| `POST /client/auth/oidc/authorize` | IP Rate Limit | OIDC 授权启动 |
| `POST /client/auth/oidc/callback` | IP Rate Limit | OIDC 回调（code exchange） |
| `GET /client/auth/oidc/callback` | IP Rate Limit | OIDC 回调（browser redirect） |
| `GET /client/auth/me` `POST /client/auth/logout` `PUT /client/auth/profile` | Hub Session | 认证管理 |
| `/client/contacts/*` | Hub Session | 联系人：搜索、好友请求、列表、删除、拉黑、备注 |
| `/client/sessions/*` | Hub Session | 会话：列表、创建、成员管理、消息、置顶、已读、搜索 |
| `/client/messages/*` | Hub Session | 消息操作：撤回、编辑、置顶、表情回复、转发、搜索 |
| `/client/attachments/*` | Hub Session | 附件：探测、上传、下载 |
| `/client/notifications/*` | Hub Session | 通知：列表、标记已读 |
| `GET/PATCH /client/settings` | Hub Session | 用户设置（key-value store） |
| `/edge/*` | Hub Session + Desktop only | Edge 设备注册、Agent Task 回调 |
| `POST /cloud/edge/register` | Hub Session | Cloud Edge 注册 |
| `/web/*` | Hub Session + Web only | Web 端专用 API |

### Web 端路由 (`/web/*`)

| 路由前缀 | 说明 |
|---|---|
| `POST /web/agent-tasks` | 触发 Agent 任务 |
| `POST /web/agent-tasks/:id/cancel` | 取消任务 |
| `GET /web/agent-tasks/:id/events` `summary` | 事件流和摘要 |
| `GET /web/agent-tasks/:id/approvals` | 任务审批列表 |
| `POST /web/agent-tasks/:id/approvals/:approval_id/decide` | 审批决定 |
| `GET /web/agent-tasks/:id/artifacts` | 任务产物列表 |
| `/web/custom-agents` | 自定义 Agent CRUD |
| `/web/agent-profiles` | Agent Profile CRUD + 发布/安装 |
| `/web/skills` | Skill CRUD + 发布/取消发布 |
| `/web/mcp-servers` | MCP Server CRUD + 发布/取消发布 |
| `/web/market/*` | 市场搜索/安装/评分 |
| `/web/provider-bindings` | Provider Binding CRUD |
| `/web/execution-targets` | Execution Target CRUD + Ping |
| `/web/documents` | 云文档 CRUD |
| `/web/projects` | 项目 CRUD + Thread + Thread Messages |
| `GET /web/audit-events` | 审计事件（Admin only） |
| `/web/relay/commands` | Relay 命令（Admin only） |
| `GET /web/devices` | 设备列表 |
| `/web/agent-teams` | Agent Team CRUD + Run + Assignment + Route Decision + Approval + Conflict |

## Hub WebSocket 事件

Hub WebSocket 使用 JSON frame 格式：`{ type, payload, seq_id? }`。事件类型定义在 `app/shared/src/hubEvents.ts`（前端常量）和 `hub-server/internal/ws/frame.go`（后端定义）。

共 26 个事件类型：

| 分类 | 事件 | 常量 |
|---|---|---|
| **Auth** | `auth` | `AUTH` |
| | `auth.ok` | `AUTH_OK` |
| | `auth.fail` | `AUTH_FAIL` |
| **Message** | `message.new` | `MESSAGE_NEW` |
| | `message.recall` | `MESSAGE_RECALL` |
| | `message.pin` | `MESSAGE_PIN` |
| | `message.unpin` | `MESSAGE_UNPIN` |
| | `message.read` | `MESSAGE_READ` |
| **Session** | `session.created` | `SESSION_CREATED` |
| | `session.dissolved` | `SESSION_DISSOLVED` |
| | `session.member_joined` | `SESSION_MEMBER_JOINED` |
| | `session.member_left` | `SESSION_MEMBER_LEFT` |
| | `session.info_updated` | `SESSION_INFO_UPDATED` |
| **Device** | `device.online` | `DEVICE_ONLINE` |
| | `device.offline` | `DEVICE_OFFLINE` |
| | `device.kicked` | `DEVICE_KICKED` |
| **Agent** | `agent.dispatch` | `AGENT_DISPATCH` |
| | `agent.stream` | `AGENT_STREAM` |
| | `agent.done` | `AGENT_DONE` |
| | `agent.failed` | `AGENT_FAILED` |
| | `agent.cancel` | `AGENT_CANCEL` |
| | `agent.control` | `AGENT_CONTROL` |
| **Notification** | `notification.new` | `NOTIFICATION_NEW` |
| | `friend.request` | `FRIEND_REQUEST` |
| | `friend.accepted` | `FRIEND_ACCEPTED` |

## Auth Token 管道模式

Desktop 的所有 Hub API 查询统一通过 `getToken` 回调注入 auth token：

```text
Desktop Tauri keyring/session
  -> getAccessToken() callback
  -> { getToken: getAccessToken }
  -> hubQueries / sessionQueries / documentQueries / projectQueries
  -> Hub REST API Authorization: Bearer <token>
```

涉及文件：`hubQueries.ts`、`sessionQueries.ts`、`documentQueries.ts`、`projectQueries.ts`。不硬编码 token 值。

## WebSocket 实时缓存失效模式

```text
Hub WS event (message.new / session.updated / ...)
  -> useHubWebSocket event handler
  -> React Query queryClient.invalidateQueries([queryKey])
  -> UI 自动重新获取最新数据
```

覆盖消息、会话、联系人和 Agent 相关的所有实时更新。

## Chat Actions

Web 和 Desktop 的 workbench model 分别暴露 chat actions，统一命名但各自实现：

| Action | Web `useWebWorkbenchModel` | Desktop `useDesktopWorkbenchModel` |
|--------|---------------------------|-----------------------------------|
| send | Hub REST sendMessage | Hub REST sendMessage |
| recall | Hub REST recallMessage | Hub REST recallMessage |
| edit | Hub REST editMessage | Hub REST editMessage |
| pin | Hub REST pinMessage | Hub REST pinMessage |
| unpin | Hub REST unpinMessage | Hub REST unpinMessage |
| markRead | Hub REST markRead | Hub REST markRead |
| addReaction | Hub REST addMessageReaction | -- |
| removeReaction | Hub REST removeMessageReaction | -- |
| forward | Hub REST forwardMessage | -- |
| searchMessages | Hub REST searchMessages | -- |

自动已读回执：进入会话后自动标记最后一条消息为已读。

## 安全边界

- Web 不能持有 TokenDance API key 或本机文件系统能力。
- Hub 权限由 Hub-local membership/resource/action 决定，TokenDance ID 只证明身份。

## 相关文档

- [02-edge-server.md](02-edge-server.md) — Edge 与 Hub 的同步和中继关系
- [06-auth-identity.md](06-auth-identity.md) — OIDC PKCE 完整流程
- [04-frontend-data-flow.md](04-frontend-data-flow.md) — 前端如何消费 Hub 数据
