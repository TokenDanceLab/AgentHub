# server-hub 架构设计

> 本文是 AgentHub 项目中 **server-hub 模块**的技术架构文档,目标读者是 server-hub 的开发者(人和 AI agent)。读完本文应能清楚地了解:server-hub 的定位、技术栈、要实现的功能、数据库表结构、API 设计、模块间协作方式、项目目录结构、Docker 部署方式。
>
> 项目整体架构请参见 `AgentHub 架构设计.md`。

---

## 1. 模块定位与作用

server-hub 是 AgentHub 五模块架构中的**中心服务器**,在系统中扮演四个角色:

**1. 唯一权威数据源**
所有用户数据、会话数据、消息数据都以 hub 的存储为准。web 和 edge 的本地数据都是 hub 的副本/缓存。多端一致性的根基就是"一切以 hub 为准"。

**2. 消息总线**
所有客户端(web、edge)发出的消息都先到 hub,hub 分配会话内单调递增的 `seq_id`,然后广播给该会话所有在线设备。这是跨端实时同步的核心机制。

**3. 任务路由器**
web 发起的 agent 任务没有本地 runner 可用,hub 负责查找该用户在线的 edge,把执行指令转发过去。涉及在线状态查询、设备路由、离线队列等。

**4. 身份与权限中心**
账号注册登录、token 颁发与校验、好友关系、群成员权限,都由 hub 统一管理。

### 1.1 与其他模块的关系

```
┌─────────┐                ┌──────────────┐
│   web   │ ─── WS/HTTP ──►│  server-hub  │
└─────────┘                │              │
                           │   (本模块)    │
┌─────────┐                │              │
│server-edge ─── WS/HTTP ─►│              │
└─────────┘                └──────────────┘
                                  │
                                  ├── PostgreSQL (主存储)
                                  ├── Redis (易失数据)
                                  └── 本地文件系统 (附件)
```

- **web ↔ hub**:web 客户端直连 hub,做 IM 操作和 agent 任务触发
- **edge ↔ hub**:edge 代表桌面端连 hub,同步消息、注册设备、接收 agent 派发
- **App、runner**:不直接与 hub 交互

---

## 2. 技术栈

| 类别 | 选型 | 说明 |
| --- | --- | --- |
| 语言 | Go 1.22+ | 性能好,并发原语适合 IM 场景 |
| Web 框架 | Gin | 轻量,中间件生态完善 |
| ORM | GORM | 开发快,自带迁移钩子,够用 |
| 数据库 | PostgreSQL 16 | 主存储,事务+JSON 字段 |
| 缓存/易失存储 | Redis 7 | 设备路由、在线状态、typing、限流、任务队列 |
| WebSocket | coder/websocket | 现代 API,context 友好 |
| 数据库迁移 | golang-migrate | SQL 文件版本化 |
| 配置管理 | viper + YAML + env 覆盖 | 多环境配置 |
| 日志 | zap + zapslog (slog API 不变) | 异步写入、文件滚动、结构化 JSON |
| 监控 | Prometheus + pprof | 指标采集与性能分析 |
| 密码哈希 | bcrypt (cost=10) | 业界标准 |
| ID 生成 | UUIDv7 | 时间有序,分页友好 |
| API 文档 | swaggo/swag | 注释驱动生成 OpenAPI |
| 测试 | testify | 断言+mock |
| 对象存储 | 本地文件系统 | 单机部署阶段够用 |
| 容器化 | Docker + Docker Compose | 整套服务一键启动 |

---

## 3. 整体架构

### 3.1 进程内分层

```
┌────────────────────────────────────────────────┐
│           HTTP Server (Gin)                    │
│  ┌──────────────┬─────────────┬─────────────┐  │
│  │  /client/*   │   /web/*    │  /edge/*    │  │
│  └──────┬───────┴──────┬──────┴──────┬──────┘  │
│         └──────────────┼─────────────┘         │
│                        ▼                       │
│  ┌──────────────────────────────────────────┐  │
│  │     Middleware (auth/log/recover/cors)   │  │
│  └──────────────────────────────────────────┘  │
│                        ▼                       │
│  ┌──────────────────────────────────────────┐  │
│  │           Handler 层(参数校验)             │  │
│  └──────────────────────────────────────────┘  │
│                        ▼                       │
│  ┌──────────────────────────────────────────┐  │
│  │        Service 层(业务逻辑+事务)           │  │
│  └──────────────────────────────────────────┘  │
│                        ▼                       │
│  ┌─────────────┬────────────────┬───────────┐  │
│  │ Repository  │  WS Manager    │ EventBus  │  │
│  │  (GORM)     │ (连接路由)      │ (内存队列)  │  │
│  └──────┬──────┴────────┬───────┴─────┬─────┘  │
└─────────┼───────────────┼─────────────┼────────┘
          ▼               ▼             ▼
     PostgreSQL        Redis        本地文件系统
```

### 3.2 关键内部组件

- **HTTP Server**:Gin 路由 + 中间件 + handler，配置 ReadHeaderTimeout(5s)/ReadTimeout(30s)/WriteTimeout(60s)/IdleTimeout(120s)，支持 SIGTERM 优雅停机
- **Admin Server**:独立端口（默认 6060），暴露 `/debug/pprof/`（CPU/heap/goroutine profile）和 `/metrics`（Prometheus 指标）
- **WS Manager**:维护所有活跃 WebSocket 连接,提供"按 user_id / device_type / session_id 推送"能力
- **EventBus**:进程内事件总线（ants 协程池实现，1024 worker），消息写库后通过 EventBus 触发广播，解耦 Service 与 WS
- **Repository**:GORM 封装的数据访问层
- **Cache**:Redis 客户端封装（go-redis），包含设备路由、序列号分配（INCR）、业务数据缓存（JSON + singleflight）

---

## 4. 功能模块详解

### 4.1 账号与认证

**功能**:
- 注册(用户名+密码)、登录、登出
- access_token + refresh_token 颁发与刷新
- token 中携带 `device_type`,接口分层鉴权
- 修改个人资料、修改密码

**实现要点**:
- 密码用 bcrypt(cost=10) 哈希
- access_token 有效期 15 分钟,refresh_token 30 天
- access_token 是 JWT(自携带 user_id、device_type、device_id),refresh_token 是随机串存 Redis
- 单设备登录踢前:Redis 维护 `(user_id, device_type) → conn_id` 映射,新登录覆盖旧映射并推 `device.kicked` 给旧 conn
- WS 鉴权:连上后第一帧发 auth 消息(带 access_token),5 秒未鉴权断连

### 4.2 联系人

**功能**:
- 按用户 ID 搜索陌生人
- 发送/接收/处理好友请求(同意/拒绝/忽略)
- 联系人列表查询(用户+agent 混合)
- 删除联系人、拉黑/取消拉黑、设置备注

**实现要点**:
- 好友关系双向落库(A→B 和 B→A 各一行),便于按 user_id 单边查询
- 好友请求复用通知系统,状态变更触发 `notification.new` 推送
- 拉黑后:被拉黑者无法发起新会话和发消息,已存在的群聊不受影响

### 4.3 会话管理

**功能**:
- 创建私聊(用户↔用户、用户↔agent)
- 创建群聊
- 会话列表查询(按最近活跃排序)
- 置顶/归档/删除会话(仅本端可见状态)
- 会话搜索(按群名/最近消息)

**实现要点**:
- 私聊会话用 `(min_user_id, max_user_id)` 唯一约束去重
- 置顶/归档/删除存在 `session_member` 表的字段上,每个成员独立
- 会话列表按 `last_message_seq` 倒序

### 4.4 群聊管理

**功能**:
- 拉用户/拉 agent 进群
- 成员退群、群主踢人
- 群主转让、群主解散群
- 邀请人退群联动:其拉的 agent 跟着退,该 agent 未完成任务取消
- 修改群名、群头像、群公告

**实现要点**:
- 角色只有 owner / member 两种
- 解散群:广播 `session.dissolved` 事件,所有成员的会话变只读归档
- 成员退群事务:删 session_member → 找出该成员邀请的 agent_instance → 删除 → 取消未完成 PendingAgentTask → 广播 `session.member_left` 和 `agent_instance.removed`

### 4.5 消息核心

**功能**:
- 发消息(支持文本、代码、diff、链接卡片、图片、文件、@ 提醒、部署卡片)
- 接收消息后分配 `seq_id`、持久化、广播
- 客户端 `client_msg_id` 去重
- 消息历史查询(按 seq_id 分页)
- 增量同步(基于 last_synced_seq)
- 引用回复、转发(保留原发送者标识)

**seq_id 策略**:
- **会话内单调递增**(不是全局)
- 实现:每个 session 在 Redis 中使用 `INCR session:seq:{sessionID}` 原子递增，DB 唯一索引 `(session_id, seq_id)` 兜底
- Redis 不可用时自动 fallback 到 PostgreSQL 行锁路径（`UPDATE sessions SET next_seq = next_seq + 1`）
- 新会话创建时通过 `SetNX` 初始化 seq key；旧会话在启动时从 DB 同步到 Redis
- 客户端按 (session_id, seq_id) 排序,跨会话不可比

**写入流程**:
```
1. handler 接收请求,校验参数和权限
2. service 先通过 Redis INCR 分配 seq_id:
   a. Redis INCR session:seq:{sessionID} → 获得 seq_id
   b. 若 Redis 不可用:fallback 到 DB 行锁路径（UPDATE sessions SET next_seq = next_seq + 1 RETURNING next_seq）
3. 开 DB 事务:
   a. INSERT INTO messages (..., seq_id = 上一步分配的seq, ...)
   b. UPDATE sessions SET last_message_at = NOW() WHERE id = ?
4. 事务提交后,通过 EventBus（ants 协程池）触发广播
5. WS Manager 找到该 session 所有在线成员,推 message.new 事件
6. 接收方按 client_msg_id 去重,按 seq_id 排序展示
```

### 4.6 消息高级操作

**撤回**:
- 时限:发送后 2 分钟内可撤回
- 谁能撤:自己的消息(2 分钟内);群主可撤群里任何人的消息(无时限);agent 发的消息,邀请人可撤
- 实现:消息表 `recalled` 字段置 true,广播 `message.recall` 事件
- 撤回的消息从 agent 上下文窗口去掉(后续 agent 触发时按 recalled = false 过滤)

**pin**:
- 任何成员可 pin,每会话上限 50 条
- 实现:`message_pins` 表,广播 `message.pin` / `message.unpin`
- pin 的消息恒定参与 agent 上下文,撤回时同步 unpin

**引用回复**:
- 消息表 `reply_to_message_id` 字段
- 客户端展示时拉取被引用消息(若已撤回显示"该消息已撤回")

**转发**:
- 新消息保留原发送者标识(content 里存原 sender)
- 并发转发：使用 errgroup 并发处理多个目标会话（并发度限制 8），任一失败取消其余
- 不可链式撤回(撤原消息不影响转发副本)

**已读回执**:
- 私聊:`message_reads` 表存 (message_id, user_id, read_at)
- 群聊:同表,客户端聚合显示"已读 N 人"
- 客户端按"展示到第 X 条"批量上报

**输入中提示**:
- 客户端每 3 秒推一次 `typing` 事件给 hub
- hub 不持久化,直接广播给该会话其他在线成员
- 接收方 5 秒未收到新 typing 事件自动隐藏

### 4.7 设备路由与在线状态

**功能**:
- 设备注册:edge 启动时上报 `device_id` `app_version` `capabilities`
- 实时维护设备路由表 `(user_id, device_type) → conn_id`
- 在线状态合并:web OR App 任一在线即在线
- 单设备登录踢前
- 心跳与连接健康检测

**实现要点**:
- 设备路由表存 Redis Hash:`device_route:{user_id}` → `{web: conn_id_1, desktop: conn_id_2}`
- WS 连接建立后 30 秒一次心跳(ping/pong),超时关连接
- 在线状态查询:`HEXISTS device_route:{user_id} web` 或 `desktop`
- 用户上下线广播给其好友(用于联系人列表的状态指示)

### 4.8 Agent 实例与任务管理

**功能**:
- agent 实例创建(拉 agent 进会话时)
- agent 实例销毁(邀请人退群/会话解散)
- 用户自建 agent 管理(创建/编辑/删除)
- web 发起的 agent 任务路由到在线 edge
- App 离线时任务进队列(上限 20 / 超时 24h)
- App 上线后推送队列任务给 edge
- 取消正在排队/执行的任务

**任务路由流程**:
```
1. web 发 @agent 消息,走标准消息流程(广播给所有人)
2. service 检测到接收方含 agent → 找出该 agent 的 inviter_user_id
3. 查 device_route:{inviter_id}.desktop 是否存在
   - 在线:推 agent.dispatch 给该 edge 的 conn,任务标记 dispatched
   - 离线:任务入 Redis List pending_tasks:{inviter_id},任务标记 queued
4. App 上线时,edge 重连 hub → hub 把队列里的任务批量推给 edge
5. edge 执行后通过 agent.stream / agent.done 上报输出和最终结果
```

**离线队列**:
- Redis List 实现:`LPUSH pending_tasks:{user_id} task_payload`
- 上限 20:LPUSH 前先 LLEN 判断
- 超时:任务带 expire_at,后台 cron 每分钟扫描过期任务,标记 timeout 并通知发起人

### 4.9 文件附件

**功能**:
- 小文件(< 10MB):客户端直接 POST 到 hub
- 大文件:hub 颁发上传凭证,客户端直传存储,完成回调
- 同 hash 秒传
- 附件元数据存 PG,文件按 hash 两级目录存本地

**存储路径**:`uploads/{hash[:2]}/{hash[2:4]}/{hash}`

**实现要点**:
- 上传时客户端先发 hash 探测:`POST /client/attachments/probe {hash}`,若已存在直接返回 attachment_id(秒传)
- 否则走完整上传流程
- 下载用 `GET /client/attachments/{id}`,服务端按 attachment_id 查路径,返回文件流
- 单机部署阶段够用,后续可换 MinIO/S3 不影响业务代码

### 4.10 通知系统

**功能**:
- 通知生成与持久化(@提醒、好友请求、群邀请、agent 完成、系统公告)
- 通知列表查询、标记已读
- 会话级免打扰开关

**实现要点**:
- `notifications` 表持久化所有通知
- 在线时:WS 推 `notification.new`
- 免打扰会话:不生成 @ 提醒类型的通知,但消息本身仍正常推送(只是不响铃/不弹窗)
- 客户端打开通知中心时拉列表

### 4.11 WebSocket 推送

**统一 envelope**:
```json
{
  "type": "message.new",
  "seq_id": 12345,
  "payload": { ... }
}
```

**推送过滤**:
- 按 `user_id` 推:广播给该用户所有在线设备
- 按 `session_id` 推:广播给该会话所有在线成员
- 按 `device_type` 过滤:`agent.dispatch` 只推 edge,`device.kicked` 只推被踢端
- 按 `device_id` 推:精确推给某一台设备

**事件类型清单**:
- `message.new` `message.recall` `message.pin` `message.unpin`
- `session.created` `session.dissolved` `session.member_joined` `session.member_left`
- `device.online` `device.offline` `device.kicked`
- `agent.dispatch` `agent.stream` `agent.done` `agent.failed`
- `notification.new`
- `typing`
- `friend.request` `friend.accepted`

### 4.12 接口分层

- **`/client/*`**(web 和 edge 共用):IM 基础能力
- **`/web/*`**(web 专属):agent 任务触发、查 App 在线状态、自建 agent 管理
- **`/edge/*`**(edge 专属):设备注册、任务派发接收、runner 状态上报、workspace 元数据同步

中间件按 token 中的 `device_type` 字段做入口校验,跨域调用直接 403。

---

## 5. 数据库表结构

所有表使用 PostgreSQL,主键统一 UUIDv7(`uuid` 类型),时间戳 `timestamptz` 存 UTC。

### 5.1 users(用户表)

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | uuid | PK | UUIDv7 |
| username | varchar(64) | UNIQUE NOT NULL | 登录名 |
| password_hash | varchar(128) | NOT NULL | bcrypt |
| nickname | varchar(64) | NOT NULL | 显示名 |
| avatar_url | varchar(512) | | 头像 URL |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | |
| updated_at | timestamptz | NOT NULL DEFAULT NOW() | |

索引:`username` 唯一索引

### 5.2 friendships(好友关系)

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | uuid | PK | |
| user_id | uuid | FK users(id) NOT NULL | |
| friend_id | uuid | FK users(id) NOT NULL | |
| status | varchar(16) | NOT NULL | pending / accepted / blocked |
| remark | varchar(64) | | 备注名 |
| request_message | varchar(255) | | 申请验证消息 |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | |
| updated_at | timestamptz | NOT NULL DEFAULT NOW() | |

索引:`(user_id, friend_id)` 唯一索引、`(user_id, status)` 联合索引

### 5.3 devices(设备表)

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | uuid | PK | UUIDv7,客户端生成 |
| user_id | uuid | FK users(id) NOT NULL | |
| device_type | varchar(16) | NOT NULL | web / desktop |
| app_version | varchar(32) | | edge 版本号 |
| capabilities | jsonb | | 支持的 agent 类型列表 |
| last_active_at | timestamptz | NOT NULL DEFAULT NOW() | |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | |

索引:`(user_id, device_type)` 联合索引

### 5.4 sessions(会话表)

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | uuid | PK | |
| type | varchar(16) | NOT NULL | private / group |
| name | varchar(64) | | 群名,私聊为空 |
| avatar_url | varchar(512) | | 群头像 |
| announcement | text | | 群公告 |
| owner_user_id | uuid | FK users(id) | 群主,私聊为空 |
| next_seq | bigint | NOT NULL DEFAULT 0 | 下一条消息的 seq_id |
| last_message_at | timestamptz | | 最近消息时间 |
| dissolved | boolean | NOT NULL DEFAULT false | 是否已解散 |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | |

`next_seq` 是会话内 seq_id 的计数器，实际分配通过 Redis `INCR session:seq:{id}` 完成，PostgreSQL 中的值作为 fallback 和启动时的种子数据。

### 5.5 session_members(会话成员)

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | uuid | PK | |
| session_id | uuid | FK sessions(id) NOT NULL | |
| member_type | varchar(16) | NOT NULL | user / agent_instance |
| member_id | uuid | NOT NULL | user_id 或 agent_instance_id |
| role | varchar(16) | NOT NULL | owner / member |
| pinned | boolean | NOT NULL DEFAULT false | 置顶 |
| archived | boolean | NOT NULL DEFAULT false | 归档 |
| muted | boolean | NOT NULL DEFAULT false | 免打扰 |
| last_read_seq | bigint | NOT NULL DEFAULT 0 | 已读到的 seq_id |
| joined_at | timestamptz | NOT NULL DEFAULT NOW() | |
| left_at | timestamptz | | 退出时间(软删除) |

索引:`(session_id, member_type, member_id)` 唯一索引、`(member_type, member_id)` 联合索引(查"我加入的会话")

### 5.6 messages(消息表)

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | uuid | PK | |
| session_id | uuid | FK sessions(id) NOT NULL | |
| seq_id | bigint | NOT NULL | 会话内单调递增 |
| client_msg_id | uuid | NOT NULL | 客户端去重 ID |
| sender_type | varchar(16) | NOT NULL | user / agent_instance |
| sender_id | uuid | NOT NULL | |
| content_type | varchar(32) | NOT NULL | text / code / diff / link_card / file / image / mention / deploy_card |
| content | jsonb | NOT NULL | 按 content_type 解析 |
| reply_to_message_id | uuid | FK messages(id) | 引用 |
| recalled | boolean | NOT NULL DEFAULT false | |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | |

索引:`(session_id, seq_id)` 唯一索引、`(session_id, client_msg_id)` 唯一索引(去重)、`(session_id, created_at desc)` 联合索引

### 5.7 message_reads(已读回执)

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| message_id | uuid | FK messages(id) NOT NULL | |
| user_id | uuid | FK users(id) NOT NULL | |
| read_at | timestamptz | NOT NULL DEFAULT NOW() | |

主键:`(message_id, user_id)`

### 5.8 message_pins(pin 消息)

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| session_id | uuid | FK sessions(id) NOT NULL | |
| message_id | uuid | FK messages(id) NOT NULL | |
| pinned_by_user_id | uuid | FK users(id) NOT NULL | |
| pinned_at | timestamptz | NOT NULL DEFAULT NOW() | |

主键:`(session_id, message_id)`

### 5.9 agent_instances(agent 实例)

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | uuid | PK | |
| agent_type | varchar(64) | NOT NULL | claude-code / codex / opencode / orchestrator / custom |
| custom_agent_id | uuid | FK custom_agents(id) | 自建 agent 引用,预置为空 |
| session_id | uuid | FK sessions(id) NOT NULL | |
| inviter_user_id | uuid | FK users(id) NOT NULL | |
| workspace_id | uuid | FK workspaces(id) | 绑定的工作目录 |
| display_name | varchar(64) | NOT NULL | 在群里显示的名字 |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | |

索引:`(session_id)` 索引、`(inviter_user_id)` 索引

### 5.10 custom_agents(用户自建 agent)

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | uuid | PK | |
| owner_user_id | uuid | FK users(id) NOT NULL | |
| name | varchar(64) | NOT NULL | |
| avatar_url | varchar(512) | | |
| agent_type | varchar(64) | NOT NULL | 底层 CLI |
| system_prompt | text | NOT NULL | |
| capability_tags | jsonb | | 能力标签数组 |
| tool_whitelist | jsonb | | 允许调用的工具白名单 |
| model_params | jsonb | | 温度/max tokens 等 |
| deleted_at | timestamptz | | 软删除 |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | |
| updated_at | timestamptz | NOT NULL DEFAULT NOW() | |

### 5.11 workspaces(工作目录元数据)

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | uuid | PK | |
| device_id | uuid | FK devices(id) NOT NULL | 归属哪台 edge |
| local_path | varchar(512) | NOT NULL | 本地绝对路径 |
| display_name | varchar(64) | | 用户起的名字 |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | |

只存元数据,实际文件在 edge 本地。

### 5.12 pending_agent_tasks(离线任务队列)

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | uuid | PK | |
| agent_instance_id | uuid | FK agent_instances(id) NOT NULL | |
| triggered_by_user_id | uuid | FK users(id) NOT NULL | |
| trigger_message_id | uuid | FK messages(id) NOT NULL | |
| status | varchar(16) | NOT NULL | queued / dispatched / running / done / failed / timeout / cancelled |
| error_message | text | | 失败原因 |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | |
| dispatched_at | timestamptz | | |
| finished_at | timestamptz | | |
| expire_at | timestamptz | NOT NULL | 默认 created_at + 24h |

索引:`(triggered_by_user_id, status)` 联合索引、`(expire_at)` 索引(扫超时)

PG 表用于持久化和审计;实时调度的快速队列在 Redis(见 §7)。

### 5.13 notifications(通知)

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | uuid | PK | |
| user_id | uuid | FK users(id) NOT NULL | 接收人 |
| type | varchar(32) | NOT NULL | mention / friend_request / group_invite / agent_done / system |
| payload | jsonb | NOT NULL | 通知内容 |
| read | boolean | NOT NULL DEFAULT false | |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | |

索引:`(user_id, read, created_at desc)` 联合索引

### 5.14 attachments(附件)

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | uuid | PK | |
| hash | varchar(64) | UNIQUE NOT NULL | sha256 |
| size | bigint | NOT NULL | 字节数 |
| mime_type | varchar(128) | NOT NULL | |
| original_name | varchar(255) | | 上传时的原文件名 |
| uploader_user_id | uuid | FK users(id) NOT NULL | |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | |

文件路径由 hash 推导:`uploads/{hash[:2]}/{hash[2:4]}/{hash}`。

### 5.15 refresh_tokens(刷新令牌)

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | uuid | PK | |
| user_id | uuid | FK users(id) NOT NULL | |
| device_type | varchar(16) | NOT NULL | |
| device_id | uuid | FK devices(id) NOT NULL | |
| token_hash | varchar(128) | UNIQUE NOT NULL | 哈希后存 |
| expires_at | timestamptz | NOT NULL | |
| revoked | boolean | NOT NULL DEFAULT false | |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | |

索引:`(user_id, device_type, device_id)` 联合索引

---

## 6. API 设计

接口按调用方角色分三组,统一返回 envelope:

```json
{
  "code": "OK",
  "message": "",
  "data": { ... }
}
```

错误响应 `code` 用字符串前缀分组(`AUTH_*` / `MSG_*` / `SESSION_*` / `AGENT_*` / `GROUP_*` 等)。

### 6.1 `/client/*`(web 和 edge 共用)

#### 认证
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /client/auth/register | 注册 |
| POST | /client/auth/login | 登录,返回 access_token + refresh_token |
| POST | /client/auth/refresh | 用 refresh_token 换新 access_token |
| POST | /client/auth/logout | 登出 |
| GET | /client/auth/me | 当前用户信息 |
| PUT | /client/auth/profile | 修改昵称/头像 |
| PUT | /client/auth/password | 修改密码 |

#### 联系人
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /client/contacts | 联系人列表(用户+agent) |
| GET | /client/contacts/search?id=xxx | 按 ID 搜索陌生人 |
| POST | /client/contacts/friend-requests | 发送好友请求 |
| GET | /client/contacts/friend-requests?direction=incoming | 收到的请求 |
| POST | /client/contacts/friend-requests/{id}/accept | 同意 |
| POST | /client/contacts/friend-requests/{id}/reject | 拒绝 |
| DELETE | /client/contacts/{user_id} | 删除联系人 |
| POST | /client/contacts/{user_id}/block | 拉黑 |
| DELETE | /client/contacts/{user_id}/block | 取消拉黑 |
| PUT | /client/contacts/{user_id}/remark | 设置备注 |

#### 会话
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /client/sessions | 会话列表 |
| POST | /client/sessions/private | 创建私聊 |
| POST | /client/sessions/group | 创建群聊 |
| GET | /client/sessions/{id} | 会话详情 |
| PUT | /client/sessions/{id}/pin | 置顶 |
| PUT | /client/sessions/{id}/archive | 归档 |
| PUT | /client/sessions/{id}/mute | 免打扰 |
| DELETE | /client/sessions/{id} | 本端隐藏 |
| GET | /client/sessions/search?q=xxx | 会话搜索 |

#### 群成员
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /client/sessions/{id}/members | 成员列表 |
| POST | /client/sessions/{id}/members | 拉用户/agent 进群 |
| DELETE | /client/sessions/{id}/members/{member_id} | 踢人(群主)/退群(自己) |
| POST | /client/sessions/{id}/transfer | 转让群主 |
| POST | /client/sessions/{id}/dissolve | 解散群 |
| PUT | /client/sessions/{id}/info | 改群名/头像/公告 |

#### 消息
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /client/sessions/{id}/messages | 发消息 |
| GET | /client/sessions/{id}/messages?before_seq=xx&limit=50 | 拉历史 |
| GET | /client/sessions/{id}/messages/sync?after_seq=xx | 增量同步 |
| POST | /client/messages/{id}/recall | 撤回 |
| POST | /client/messages/{id}/pin | pin |
| DELETE | /client/messages/{id}/pin | 取消 pin |
| GET | /client/sessions/{id}/pins | pin 列表 |
| POST | /client/messages/{id}/forward | 转发到目标会话 |
| POST | /client/messages/{id}/read | 标记已读 |
| GET | /client/messages/{id}/reads | 已读列表(群聊) |
| GET | /client/sessions/{id}/messages/search?q=xxx | 会话内消息搜索 |
| GET | /client/messages/search?q=xxx | 全局消息搜索 |

#### 通知
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /client/notifications?unread_only=true | 通知列表 |
| POST | /client/notifications/{id}/read | 标记单条已读 |
| POST | /client/notifications/read-all | 全部已读 |

#### 附件
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /client/attachments/probe | 按 hash 探测是否秒传 |
| POST | /client/attachments | 上传附件(小文件) |
| GET | /client/attachments/{id} | 下载/查看 |

#### WebSocket
| 路径 | 说明 |
| --- | --- |
| WS /client/ws | 长连接,连上后第一帧发 auth |

### 6.2 `/web/*`(web 专属)

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /web/agent-tasks | 触发 agent 任务(路由到 edge) |
| GET | /web/agent-tasks?status=queued | 自己 pending 的任务列表 |
| POST | /web/agent-tasks/{id}/cancel | 取消任务 |
| GET | /web/desktop-status | 查自己的 App 是否在线 |
| GET | /web/custom-agents | 自建 agent 列表 |
| POST | /web/custom-agents | 创建 |
| PUT | /web/custom-agents/{id} | 编辑 |
| DELETE | /web/custom-agents/{id} | 删除 |

### 6.3 `/edge/*`(edge 专属)

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /edge/devices/register | 设备注册(上报 capabilities) |
| POST | /edge/agent-tasks/{id}/ack | 确认收到派发 |
| POST | /edge/agent-tasks/{id}/stream | 流式上报 agent 输出片段 |
| POST | /edge/agent-tasks/{id}/done | 上报任务完成 |
| POST | /edge/agent-tasks/{id}/fail | 上报任务失败 |
| GET | /edge/agent-tasks/pending | 拉取自己设备的 pending 任务(上线时用) |
| POST | /edge/workspaces | 上报 workspace 元数据 |
| DELETE | /edge/workspaces/{id} | 解绑 workspace |

### 6.4 中间件链

```
recover → log → cors → rate-limit → auth → device_type_check → handler
```

- **auth**:校验 JWT,解析 user_id 和 device_type 注入 context
- **device_type_check**:`/web/*` 要求 device_type=web,`/edge/*` 要求 device_type=desktop,不匹配 403

---

## 7. WebSocket 协议

### 7.1 连接建立

```
1. 客户端连 WS /client/ws
2. 服务端 accept 后,等待第一帧(5 秒超时)
3. 客户端发 auth 帧:
   { "type": "auth", "payload": { "access_token": "...", "device_id": "..." } }
4. 服务端校验 token,成功则:
   - 注册 conn 到 WS Manager
   - 写 device_route:{user_id}.{device_type} = conn_id (Redis)
   - 推 device.online 事件给该用户的好友(可选)
   - 回 auth.ok 给客户端
5. 失败:推 auth.fail 并断连
```

### 7.2 心跳

服务端 30 秒一次发 ping,客户端必须回 pong。两次未回断连。

### 7.3 客户端 → 服务端的帧

只有 `auth` 和 `typing`:

```json
{ "type": "auth", "payload": { "access_token": "...", "device_id": "..." } }
{ "type": "typing", "payload": { "session_id": "..." } }
```

其他操作(发消息、撤回等)走 HTTP,保证幂等和可重试。

### 7.4 服务端 → 客户端的帧

统一 envelope:
```json
{
  "type": "message.new",
  "seq_id": 12345,
  "payload": { ... }
}
```

事件类型清单见 §4.11。

### 7.5 断线重连

客户端重连后:
1. 重新走 auth 流程
2. 调 `GET /client/sessions/{id}/messages/sync?after_seq=last_synced_seq` 拉每个活跃会话的增量
3. 调 `GET /client/notifications?unread_only=true` 拉未读通知

---

## 8. Redis 用途

### 8.1 易失数据（路由 / 状态）

| Key | 类型 | TTL | 用途 |
| --- | --- | --- | --- |
| `device_route:{user_id}` | Hash | 永久(下线时 HDEL) | `{web: conn_id, desktop: conn_id}` |
| `pending_tasks:{user_id}` | List | 永久 | edge 离线时的 agent 任务队列 |
| `kicked:{conn_id}` | String | 60s | 踢前标记,避免重连竞态 |

### 8.2 持久化数据（需 AOF 保证不丢失）

| Key | 类型 | TTL | 用途 |
| --- | --- | --- | --- |
| `session:seq:{sessionID}` | String (int64) | 永久 | 会话 seq 计数器（Redis INCR 分配，DB 唯一索引兜底） |

### 8.3 业务数据缓存（可丢失，有 TTL）

| Key | 类型 | TTL | 用途 |
| --- | --- | --- | --- |
| `session:members:{sessionID}` | String (JSON) | 5min (±10%) | 会话活跃成员列表缓存 |
| `session:meta:{sessionID}` | String (JSON) | 10min (±10%) | 会话元数据缓存 |
| `user:profile:{userID}` | String (JSON) | 30min (±10%) | 用户基本信息缓存 |
| `user:friends:{userID}` | String (JSON) | 10min (±10%) | 用户好友 ID 列表缓存 |

缓存层通过 `GetOrLoad[T]` 泛型函数实现 cache-through 模式，内嵌 `singleflight` 防止缓存击穿。
写入路径在数据变更后调用 `Invalidate` 主动失效对应 key。
Redis 不可用时自动降级为直查数据库，不阻塞业务。

---

## 9. 项目目录结构

标准 Go 布局:

```
server-hub/
├── docs/                        # 说明文档
├── cmd/
│   └── server-hub/
│       └── main.go              # 程序入口
├── internal/
│   ├── config/                  # 配置加载(viper)
│   │   └── config.go
│   ├── handler/                 # HTTP handler(参数校验)
│   │   ├── auth.go
│   │   ├── contact.go
│   │   ├── session.go
│   │   ├── message.go
│   │   ├── agent.go
│   │   ├── notification.go
│   │   ├── attachment.go
│   │   ├── device.go
│   │   ├── custom_agent.go
│   │   ├── response.go
│   │   └── ws.go
│   ├── service/                 # 业务逻辑
│   │   ├── auth.go
│   │   ├── contact.go
│   │   ├── session.go
│   │   ├── message.go
│   │   ├── agent.go
│   │   ├── notification.go
│   │   ├── attachment.go
│   │   └── eventbus.go
│   ├── repository/              # GORM 数据访问
│   │   ├── db.go
│   │   ├── migrate.go
│   │   ├── user.go
│   │   ├── friendship.go
│   │   ├── device.go
│   │   ├── session.go
│   │   ├── session_member.go
│   │   ├── message.go
│   │   ├── agent.go
│   │   ├── notification.go
│   │   ├── attachment.go
│   │   └── refresh_token.go
│   ├── model/                   # GORM 模型 + DTO
│   │   ├── user.go
│   │   ├── session.go
│   │   ├── session_member.go
│   │   ├── message.go
│   │   └── ...
│   ├── middleware/              # Gin 中间件
│   │   ├── auth.go
│   │   ├── device_type.go
│   │   ├── metrics.go           # Prometheus HTTP 指标采集
│   │   └── access_log.go        # 结构化访问日志
│   ├── metrics/                 # Prometheus 指标定义
│   │   └── metrics.go
│   ├── ws/                      # WebSocket 管理
│   │   ├── manager.go           # 连接管理
│   │   └── frame.go             # 帧编解码
│   ├── cache/                   # Redis 封装
│   │   ├── redis.go             # 连接池初始化
│   │   ├── route.go             # 设备路由
│   │   ├── seq.go               # 序列号分配 (INCR)
│   │   └── data.go              # 业务数据缓存 (GetOrLoad + singleflight)
│   ├── log/                     # 日志初始化 (zap + zapslog)
│   │   └── log.go
│   ├── errcode/                 # 错误码常量
│   │   └── codes.go
│   ├── jwtutil/                 # JWT 工具
│   │   └── jwt.go
│   └── router/                  # 路由注册
│       └── router.go
├── pkg/                         # 可被外部复用的工具
│   └── uuidv7/
│       └── uuidv7.go
├── migrations/                  # SQL 迁移脚本
│   ├── 0001_init.up.sql
│   ├── 0001_init.down.sql
│   └── ...
├── api/                         # OpenAPI 生成产物
│   └── swagger.yaml
├── configs/                     # 配置文件
│   ├── config.yaml
│   └── config.docker.yaml
├── deployments/                 # 部署相关
│   ├── Dockerfile
│   └── docker-compose.yml
├── uploads/                     # 附件存储(本地文件系统)
├── scripts/                     # 开发脚本
│   ├── migrate.sh
│   └── gen-swagger.sh
├── go.mod
├── go.sum
└── README.md
```

---

## 10. Docker 部署

### 10.1 Dockerfile(多阶段构建)

```dockerfile
# Build 阶段
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o server-hub ./cmd/server-hub

# Runtime 阶段
FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=builder /app/server-hub .
COPY --from=builder /app/configs/config.docker.yaml ./configs/config.yaml
COPY --from=builder /app/migrations ./migrations
EXPOSE 8080
CMD ["./server-hub"]
```

### 10.2 docker-compose.yml(开发期)

```yaml
version: '3.9'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: agenthub
      POSTGRES_USER: agenthub
      POSTGRES_PASSWORD: dev_password
    ports:
      - "5432:5432"
    volumes:
      - pg_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --appendfsync everysec
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  server-hub:
    build:
      context: .
      dockerfile: deployments/Dockerfile
    depends_on:
      - postgres
      - redis
    environment:
      AGENTHUB_DB_HOST: postgres
      AGENTHUB_REDIS_HOST: redis
    ports:
      - "8080:8080"
    volumes:
      - ./uploads:/app/uploads

volumes:
  pg_data:
  redis_data:
```

### 10.3 启动流程

```
1. docker-compose up -d postgres redis
2. ./scripts/migrate.sh up   # 跑数据库迁移
3. docker-compose up server-hub
```

迁移可作为 entrypoint 一部分:容器启动时先执行 `migrate up` 再启服务。

**Admin 端口**:服务同时监听 `admin_port`（默认 6060），提供 `/debug/pprof/`（性能分析）和 `/metrics`（Prometheus 指标）。生产环境应配置防火墙仅允许内网访问该端口。

---

## 11. 开发顺序建议

按依赖关系从底层往上推:

1. **基建**:项目骨架、config、log、PG/Redis 连接池、迁移框架、Docker 配置
2. **认证**:注册/登录/token + 中间件
3. **WebSocket 基础**:连接建立、auth 帧、心跳、WS Manager
4. **设备路由**:注册、踢前、在线状态
5. **联系人**:好友请求与列表
6. **会话与群成员**:CRUD + 权限
7. **消息核心**:发消息、seq_id 分配、广播、增量同步
8. **消息高级**:撤回、pin、引用、转发、已读、typing
9. **agent 任务路由**:实例管理、web→edge 派发、离线队列、自建 agent
10. **附件、通知、搜索**:补功能
11. **集成测试 + Swagger 文档**:验证交付

每个阶段产出可独立测试的接口,边写边联调。
