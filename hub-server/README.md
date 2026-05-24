# AgentHub Hub Server

AgentHub 中央服务器 — 负责即时通讯（IM）、Agent 任务路由、设备管理、消息持久化。

## 架构定位

```
            Web (浏览器)          Desktop (Edge)
                │                      │
                ▼                      ▼
         POST /web/*             POST /edge/*
         WS /client/ws           WS /client/ws
                │                      │
                └──────────┬───────────┘
                           ▼
                    Hub Server
                     (Gin + GORM)
                           │
                    ┌──────┼──────┐
                    ▼      ▼      ▼
                PostgreSQL  Redis  文件存储
               (持久化数据) (路由/队列) (uploads/)
```

## 技术栈

| 组件 | 技术 |
|------|------|
| HTTP/WS 框架 | Gin + coder/websocket |
| ORM | GORM + PostgreSQL 16 |
| 缓存 | go-redis (Redis 7) |
| 配置 | Viper (YAML + `AGENTHUB_` 环境变量覆盖) |
| 认证 | Hub 本地 JWT HS256 (15min) + bcrypt (cost 10) + 刷新令牌；可选 TokenDance ID RS256/JWKS bearer token |
| ID 生成 | UUIDv7 (时间有序) |
| 迁移 | golang-migrate |
| 日志 | zap + zapslog（slog API 不变） |
| 语言 | Go 1.25 |

## 快速启动

### Docker Compose（推荐）

```bash
cd ..
docker compose up -d
```

这会启动 PostgreSQL、Redis 和 Hub Server 三个容器，服务监听 `localhost:8080`，admin 端口（pprof/metrics）监听 `localhost:6060`。

### 本地开发

**前置依赖**: PostgreSQL 16、Redis 7

```bash
# 1. 创建数据库
psql -U postgres -c "CREATE DATABASE agenthub"
psql -U postgres -c "CREATE USER agenthub WITH PASSWORD 'dev_password'"
psql -U postgres -c "GRANT ALL ON DATABASE agenthub TO agenthub"

# 2. 配置连接（按需修改 configs/config.yaml）
# 3. 运行服务（迁移自动执行）
go run ./cmd/server-hub
```

## 项目结构

```
hub-server/
├── cmd/server-hub/main.go       # 入口：组装依赖，启动服务
├── configs/
│   ├── config.yaml              # 本地开发配置
│   └── config.docker.yaml       # Docker 环境配置
├── deployments/
│   ├── Dockerfile                # 多阶段构建
│   ├── docker-compose.prod.yml   # 生产 compose
│   └── deploy.sh                 # 部署脚本
├── migrations/                   # SQL 迁移 (17 组 up/down)
├── uploads/                      # 文件存储目录
├── tests/                        # 集成测试
│
├── internal/
│   ├── config/                   # 配置加载
│   ├── log/                      # 结构化日志
│   ├── errcode/                  # 错误码定义
│   ├── jwtutil/                  # JWT 生成/解析
│   ├── cache/                    # Redis 客户端 + 设备路由 + seq 分配 + 业务缓存
│   ├── ws/                       # WebSocket 连接管理 + 帧协议
│   ├── metrics/                  # Prometheus 指标定义
│   ├── middleware/               # JWT 认证 + 设备类型校验 + 指标采集 + 访问日志
│   ├── router/                   # 路由注册
│   ├── handler/                  # HTTP 层：参数校验 → service
│   ├── service/                  # 业务逻辑 + 事务 + 事件发布
│   ├── repository/               # 数据访问 (GORM + 原生 SQL)
│   └── model/                    # GORM 模型定义
│
└── pkg/uuidv7/                   # UUIDv7 工具
```

## 核心设计

### 分层架构

```
handler (参数校验, 调用 service, 返回 JSON)
  → service (业务逻辑, 事务, 发布事件)
    → repository (GORM / SQL, 不包含业务逻辑)
      → PostgreSQL
```

### 事件总线

内存事件总线解耦持久化与 WebSocket 推送：

- `message.new` → 插入 DB 后，广播给会话所有成员
- `agent.done` → Agent 完成后，广播 + 发送通知
- `agent.cancel` → Agent 取消后，广播给会话
- `friend.request` → 好友请求通过通知系统推送

### 业务数据缓存

热点查询（会话成员列表、用户信息、会话元数据、好友列表）通过 Redis JSON 缓存 + singleflight 防击穿：

- **读路径**：`cache.GetOrLoad[T](key, ttl, loader)` → Redis 命中直接返回，未命中 singleflight 合并并发请求后查 DB 回填
- **写路径**：数据变更后调用 `cache.Invalidate(keys...)` 主动失效
- **降级**：Redis 不可用时自动降级为直查 DB

### 可观测性

Admin 端口（默认 6060）提供：
- `/debug/pprof/` — CPU profile、heap、goroutine 等性能分析
- `/metrics` — Prometheus 指标（HTTP QPS/延迟、WS 连接数、DB 池、Redis 池、EventBus 队列长度）

Gin 中间件自动采集每个 HTTP 请求的 method/path/status/duration，15s 周期采集 DB/Redis/WS/EventBus 运行指标。

### seq_id 分配

消息的 seq_id 是会话级别自增，通过 Redis `INCR session:seq:{sessionID}` 原子操作分配，DB 唯一索引 `(session_id, seq_id)` 兜底。

```
Redis INCR session:seq:{sessionID} → 获得 seq
  ↓ (Redis 不可用时 fallback)
DB UPDATE sessions SET next_seq = next_seq + 1 ... RETURNING next_seq
  ↓
INSERT INTO messages (..., seq_id, ...)
UPDATE sessions SET last_message_at = NOW()
```

### client_msg_id 幂等

同一会话内相同 `client_msg_id` 重复发送直接返回已有消息，不会重复插入。

### Agent 任务路由

```
Web 触发任务 → 查 Redis device_route 找用户桌面设备
  ├─ 在线 → WS 推送 agent.dispatch
  └─ 离线 → 入 Redis pending_tasks 队列
              └─ Edge 上线 → 拉取积压任务 → 执行
                                  └─ ack/stream/done/fail 回调
```

### 设备路由

Redis Hash: `device_route:{user_id}` → `{device_type: conn_id}`

同用户同设备类型新连接会踢旧连接（60s TTL 标记防止误删路由）。

### TokenDance ID 兼容鉴权

Hub Server 的认证中间件支持双路径：

1. 先尝试 TokenDance ID bearer token：使用 `tokendance_id.jwks_uri` 拉取 JWKS，按 `kid` 校验 RS256 签名和标准过期时间。
2. 失败后 fallback 到 Hub 本地 HS256 JWT：用于 `/client/auth/login`、`/client/auth/refresh` 等本地账号流程。

当前边界：

| 项 | 当前实现 |
|----|----------|
| Callback | Hub Server 的 TokenDance ID 浏览器登录 callback 尚未定稿；不要把 AgentHub Home 的站点 callback 当作 Hub API 登录 callback |
| Token exchange | 当前 Hub API 没有 TokenDance ID code exchange 路由；只接受已签发 bearer token |
| Token storage | TokenDance ID bearer token 不创建 Hub refresh token；Hub 本地 JWT refresh 仍是独立机制 |
| Refresh/logout | TokenDance ID refresh/logout 尚未作为 Hub 浏览器登录流接入 |
| JWKS validation | 已校验 RS256 签名和 `exp`；显式 `iss` / `aud` 校验仍是 P0 hardening 项 |

### 私聊去重

两用户之间只有一个私聊会话，重复创建返回已有 `session_id`。

## API 分组

| 路由前缀 | 权限 | 用途 |
|----------|------|------|
| `/client/*` | 认证 | 即时通讯（注册、登录、消息、联系人、会话、附件、通知） |
| `/web/*` | 认证 + device_type=web | Web 端 Agent 任务触发、自定义 Agent 管理 |
| `/edge/*` | 认证 + device_type=desktop | Edge 桌面端设备注册、Agent 任务回调 |

完整 API 文档见 `api/openapi.yaml`。

## WebSocket

连接: `ws://host:8080/client/ws`
首帧认证: `{"type":"auth","payload":{"access_token":"..."}}`
心跳: 服务端 30s ping，2 次丢失 pong 断开

## 数据库表

迁移文件位于 `migrations/`，当前有 17 组 up/down：

| 迁移 | 用途 |
|----|------|
| 0001_users | 用户账号 |
| 0002_friendships | 好友关系 |
| 0003_devices | 设备注册 |
| 0004_sessions | 会话 (私聊/群聊) |
| 0005_session_members | 会话成员 |
| 0006_messages | 消息 |
| 0007_message_reads | 已读记录 |
| 0008_message_pins | 消息置顶 |
| 0009_workspaces | 工作区 |
| 0010_custom_agents | 自定义 Agent 模板 |
| 0011_agent_instances | Agent 实例 |
| 0012_pending_agent_tasks | Agent 任务队列 |
| 0013_notifications | 通知 |
| 0014_attachments | 附件 |
| 0015_refresh_tokens | 刷新令牌 |
| 0016_workspace_refactor | 工作区模型调整 |
| 0017_devices_unique | 设备唯一约束修正 |

## 运行测试

```bash
# 需本地 PostgreSQL + Redis，或先启动根目录 docker compose
go test ./... -short -count=1
```

## 配置

| 环境变量 | 说明 | 默认值 |
|----------|------|--------|
| `AGENTHUB_SERVER_PORT` | 服务端口 | 8080 |
| `AGENTHUB_SERVER_ADMIN_PORT` | Admin 端口（pprof/metrics） | 6060 |
| `AGENTHUB_SERVER_LOG_LEVEL` | 日志级别（debug/info/warn/error） | info |
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
| `AGENTHUB_JWT_SECRET` | JWT 密钥 | `dev-secret-change-in-production` |
| `AGENTHUB_JWT_ACCESS_TTL` | 令牌有效期 | 15m |
| `AGENTHUB_UPLOAD_MAX_SIZE` | 上传大小限制 | 10485760 (10MB) |
| `AGENTHUB_TOKENDANCE_ID_ISSUER_URL` | TokenDance ID issuer；为空时默认 `https://id.vectorcontrol.tech` | `https://id.vectorcontrol.tech` |
| `AGENTHUB_TOKENDANCE_ID_JWKS_URI` | TokenDance ID JWKS；为空时由 issuer 拼出 `/oidc/jwks` | `https://id.vectorcontrol.tech/oidc/jwks` |
| `AGENTHUB_TOKENDANCE_ID_CLIENT_ID` | 预留给未来 Hub OIDC browser flow | — |
| `AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET` | 预留给未来 confidential-client flow；不得提交到仓库 | — |
