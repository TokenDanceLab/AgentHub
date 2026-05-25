# AgentHub Hub Server

AgentHub 中央服务器负责账号、IM、联系人/群聊、多端同步、设备路由、Edge 中继、Profile catalog 和审计。它是云端控制面，不直接启动 Agent CLI；实际执行由 Edge Server 完成。

Runtime: Go 1.25.

## 架构定位

```text
Desktop / Web
    |
    | Hub session + device proof
    v
Hub Server (Gin + GORM)
    |
    +-- PostgreSQL: 用户、会话、消息、设备、Profile、任务
    +-- Redis: seq、缓存、设备路由、pending task
    +-- WebSocket: IM、通知、Edge relay
```

Hub 是账号、云端 IM、多端同步、远程中继和审计权威。Local Edge 本地执行不依赖 Hub；当需要团队 IM、跨设备同步、Web/Mobile 远程查看/审批、远程 Edge 或 Cloud Edge 时，Hub 才进入执行控制链路。

## 技术栈

| 组件 | 技术 |
|---|---|
| HTTP/WS 框架 | Gin + coder/websocket |
| ORM | GORM + PostgreSQL 16 |
| 缓存 | go-redis (Redis 7) |
| 配置 | Viper (YAML + `AGENTHUB_` 环境变量覆盖) |
| 认证 | Hub 本地 access/refresh session；TokenDance ID RS256/JWKS bearer middleware 仅作兼容路径 |
| ID 生成 | UUIDv7 |
| 迁移 | golang-migrate |
| 日志 | zap + zapslog |

## TokenDance ID 边界

TokenDance ID 是跨产品身份入口；Hub session 是 AgentHub 自己的产品会话。最终浏览器/桌面登录必须由 Hub Server 作为 TokenDance ID relying party 完成：

1. Desktop/Web 打开 TokenDance ID Authorization Code + PKCE 登录。
2. Hub-owned callback 接收 code。
3. Hub Server 完成 code exchange。
4. Hub Server 校验 ID token 的 issuer、audience、exp、JWKS 签名。
5. Hub Server 把 `tokendance_sub` 映射到 Hub user。
6. Hub Server 签发 Hub 本地 access/refresh session，并绑定 device proof。

现有 `hub-server/internal/middleware/auth.go` 可先尝试 TokenDance ID RS256/JWKS bearer token，再 fallback 到 Hub 本地 HS256 JWT。这只是兼容路径，不能替代 Hub session、refresh token、device proof 或 Edge 权限检查。

| 项 | 当前说明 |
|---|---|
| Hub OIDC callback | 目标归 Hub Server；不要把 AgentHub Home 静态站 callback 当成 Hub API callback |
| Code exchange | 目标由 Hub Server 完成；产品客户端不得保存第三方 provider token |
| Hub session | AgentHub API 的长期授权边界；浏览器/桌面最终消费 Hub access/refresh session |
| Bearer middleware | 兼容已签发 TokenDance ID bearer token；需要配置 TokenDance issuer 和 AgentHub client id；不创建 Hub refresh session |
| JWKS validation | 校验 RS256 签名、`kid`、`exp`、TokenDance issuer 和 AgentHub client audience |

## AgentHub 产品模型

Hub 侧长期权威应保存用户和团队可管理对象；Edge 侧负责实际执行。

| 概念 | Hub 责任 |
|---|---|
| Agent Runtime | 记录可用 Runtime adapter 能力和团队策略，不直接启动 Runtime |
| Agent Profile | 保存用户/团队可管理的 Agent 实体、模板、安装状态和可见性 |
| Agent Configuration | 保存模型偏好、Skill/MCP 配置、审批策略、cc-switch provider binding 引用和审计元数据 |
| Execution Target | 保存 Edge device、Remote/Cloud/Relay target 的注册、在线状态、权限和路由 |

真实 API 字段仍在演进时，新增接口应优先用 `runtimeId`、`profileId`、`targetId` 等显式字段，避免继续扩大旧 `agentId` 的歧义。

## 快速启动

### Docker Compose

从仓库根目录运行：

```powershell
docker compose up -d
```

这会启动 PostgreSQL、Redis 和 Hub Server，服务监听 `localhost:8080`，admin 端口监听 `localhost:6060`。

### 本地开发

前置依赖：PostgreSQL 16、Redis 7。

```powershell
cd hub-server
go run ./cmd/server-hub
```

默认配置来自 `configs/config.yaml`：

| 服务 | 默认 |
|---|---|
| Hub HTTP | `localhost:8080` |
| Admin / pprof / metrics | `localhost:6060` |
| PostgreSQL | `localhost:5432`, DB `agenthub` |
| Redis | `localhost:6380` |

迁移在启动时自动执行。

## 项目结构

```text
hub-server/
├── cmd/server-hub/main.go       # 入口：组装依赖，启动服务
├── configs/
│   ├── config.yaml              # 本地开发配置
│   └── config.docker.yaml       # Docker 环境配置
├── deployments/                 # Dockerfile、生产 compose、部署脚本
├── migrations/                  # SQL 迁移 (17 组 up/down)
├── uploads/                     # 文件存储目录
├── tests/                       # 集成测试
├── internal/
│   ├── app/                     # 应用装配
│   ├── config/                  # 配置加载
│   ├── cache/                   # Redis 客户端 + 路由/缓存
│   ├── ws/                      # WebSocket 连接管理 + 帧协议
│   ├── metrics/                 # Prometheus 指标
│   ├── middleware/              # JWT/TokenDance bearer 兼容鉴权、设备类型、日志、指标
│   ├── router/                  # 路由注册
│   ├── handler/                 # HTTP 层：参数校验 -> service
│   ├── service/                 # 业务逻辑 + 事务 + 事件发布
│   ├── repository/              # 数据访问
│   └── model/                   # GORM 模型
└── pkg/uuidv7/                  # UUIDv7 工具
```

## 核心设计

### 分层架构

```text
handler -> service -> repository -> PostgreSQL
```

handler 只做参数校验和响应；service 承担业务逻辑、事务和事件发布；repository 不包含业务规则。

### 事件总线和 WebSocket

- `message.new`：消息插入后广播给会话成员。
- `agent.done` / `agent.cancel`：Agent 任务状态变化后广播给会话并发送通知。
- `friend.request`：好友请求通过通知系统推送。
- 慢客户端背压会统计 dropped frames，避免单个连接拖垮广播。

连接：`ws://host:8080/client/ws`

首帧认证：

```json
{"type":"auth","payload":{"access_token":"..."}}
```

### 业务数据缓存

热点查询通过 Redis JSON 缓存 + singleflight 防击穿：

- 读路径：`cache.GetOrLoad[T](key, ttl, loader)`。
- 写路径：数据变更后主动 `cache.Invalidate(keys...)`。
- 降级：Redis 不可用时直查 DB。

### seq_id 和幂等

消息 `seq_id` 是会话级自增，优先用 Redis `INCR session:seq:{sessionID}` 分配，Redis 不可用时 fallback 到 DB。DB 唯一索引 `(session_id, seq_id)` 兜底。同一会话内相同 `client_msg_id` 重复发送直接返回已有消息。

### Agent 任务路由

```text
Web/Hub 触发任务
  -> 查 Redis device_route 找目标 Edge
  -> 在线：WS 推送 agent.dispatch
  -> 离线：写 pending_tasks
  -> Edge 上线后拉取/确认/stream/done/fail
```

Hub 只做路由、队列、权限和状态持久化；Agent Runtime 进程仍由 Edge 启动。

## API 分组

| 路由前缀 | 权限 | 用途 |
|---|---|---|
| `/client/*` | Hub session | 注册、登录、消息、联系人、会话、附件、通知 |
| `/web/*` | Hub session + `device_type=web` | Web 端 Agent 任务触发、自定义 Agent/Profile 管理 |
| `/edge/*` | Hub session + `device_type=desktop` / device proof | Edge 设备注册、任务回调、relay/sync |

完整 REST 契约见 `api/openapi.yaml`；WebSocket 事件见 `api/events.md`。部分已实现 Hub 路由仍在补 OpenAPI 覆盖，改接口时必须同步契约。

## 数据库表

迁移文件位于 `migrations/`，当前有 17 组 up/down：

| 迁移 | 用途 |
|---|---|
| 0001_users | 用户账号 |
| 0002_friendships | 好友关系 |
| 0003_devices | 设备注册 |
| 0004_sessions | 会话 |
| 0005_session_members | 会话成员 |
| 0006_messages | 消息 |
| 0007_message_reads | 已读记录 |
| 0008_message_pins | 消息置顶 |
| 0009_workspaces | 工作区 |
| 0010_custom_agents | 自定义 Agent / Profile 模板 |
| 0011_agent_instances | Agent 实例 |
| 0012_pending_agent_tasks | Agent 任务队列 |
| 0013_notifications | 通知 |
| 0014_attachments | 附件 |
| 0015_refresh_tokens | Hub refresh token |
| 0016_workspace_refactor | 工作区模型调整 |
| 0017_devices_unique | 设备唯一约束修正 |

## 运行测试

```powershell
cd hub-server
go test ./... -short -count=1
```

需要完整本地依赖时先在仓库根目录启动 compose。

## 配置

| 环境变量 | 说明 | 默认值 |
|---|---|---|
| `AGENTHUB_SERVER_PORT` | 服务端口 | 8080 |
| `AGENTHUB_SERVER_ADMIN_PORT` | Admin 端口（pprof/metrics） | 6060 |
| `AGENTHUB_SERVER_LOG_LEVEL` | 日志级别 | info |
| `AGENTHUB_SERVER_LOG_FILE` | 日志文件路径（空=stdout） | "" |
| `AGENTHUB_DB_HOST` | 数据库地址 | localhost |
| `AGENTHUB_DB_PORT` | 数据库端口 | 5432 |
| `AGENTHUB_DB_USER` | 数据库用户 | agenthub |
| `AGENTHUB_DB_PASSWORD` | 数据库密码 | dev_password |
| `AGENTHUB_DB_NAME` | 数据库名 | agenthub |
| `AGENTHUB_REDIS_HOST` | Redis 地址 | localhost |
| `AGENTHUB_REDIS_PORT` | Redis 端口 | 6380 |
| `AGENTHUB_REDIS_POOL_SIZE` | Redis 连接池大小 | 100 |
| `AGENTHUB_REDIS_MIN_IDLE_CONNS` | Redis 最小空闲连接 | 10 |
| `AGENTHUB_JWT_SECRET` | Hub JWT 密钥 | 必须由环境注入 |
| `AGENTHUB_JWT_ACCESS_TTL` | Hub access token 有效期 | 15m |
| `AGENTHUB_UPLOAD_MAX_SIZE` | 上传大小限制 | 10485760 |
| `AGENTHUB_TOKENDANCE_ID_ISSUER_URL` | TokenDance ID issuer | `https://id.vectorcontrol.tech` |
| `AGENTHUB_TOKENDANCE_ID_JWKS_URI` | TokenDance ID JWKS | `https://id.vectorcontrol.tech/oidc/jwks` |
| `AGENTHUB_TOKENDANCE_ID_CLIENT_ID` | Hub OIDC client id；启用 TokenDance bearer 兼容路径时用于强制 `aud` 校验 | 待配置 |
| `AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET` | Hub confidential-client secret；不得提交 | 待配置 |
