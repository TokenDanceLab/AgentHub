# server-hub 开发流程

> 本文把 server-hub 的开发拆成可独立验收的小步骤,从空目录到可部署的服务。每一步说明:**做什么**、**关键实现点**、**做完后的效果(验收标准)**。按顺序执行即可完成开发。
>
> 配套阅读:`server-hub 技术架构.md`(详细设计) + `AgentHub 架构设计.md`(整体架构)。

---

## 总览

按依赖关系分成 15 个阶段,每个阶段下有若干可独立完成的小步骤。每个步骤目标是"半天到一天能完成且可验证"。

| 阶段 | 名称 | 步骤数 | 核心产出 |
| --- | --- | --- | --- |
| P1 | 项目初始化与骨架 | 5 | 可启动的最小 HTTP 服务 |
| P2 | 配置 / 日志 / 数据库 / 缓存 | 6 | 基础设施层就绪 |
| P3 | 数据库迁移 | 3 | 所有表创建,migrate 流程跑通 |
| P4 | 认证模块 | 7 | 注册登录 + JWT + 中间件 |
| P5 | WebSocket 基础 | 5 | 长连接 + auth 帧 + 心跳 |
| P6 | 设备路由与在线状态 | 6 | 设备注册 + 踢前 + 在线广播 |
| P7 | 联系人 | 6 | 加好友 + 联系人列表 + 拉黑 |
| P8 | 会话与群聊 | 8 | 私聊/群聊 CRUD + 成员管理 |
| P9 | 消息核心 | 6 | 发消息 + seq_id + 广播 + 同步 |
| P10 | 消息高级操作 | 6 | 撤回/pin/引用/转发/已读/typing |
| P11 | Agent 模块 | 10 | 实例管理 + 任务路由 + 离线队列 |
| P12 | 附件 | 4 | 上传/下载/秒传 |
| P13 | 通知 | 3 | 通知系统接入各业务 |
| P14 | 搜索 | 3 | 联系人/会话/消息搜索 |
| P15 | 文档与部署 | 4 | Swagger + 集成测试 + Docker |

---

## P1. 项目初始化与骨架

### P1.1 创建目录结构

**做什么**:在 `Agent_Hub/server-hub/` 下按标准 Go 布局创建空目录树。

**目录清单**:
```
server-hub/
├── cmd/server-hub/
├── internal/{config,handler,service,repository,model,middleware,ws,cache,errcode,jwtutil,router}
├── pkg/uuidv7/
├── migrations/
├── api/
├── configs/
├── deployments/
├── uploads/
├── scripts/
```

**做完后**:目录结构已建,各目录留空(或放占位 `.gitkeep`)。

### P1.2 初始化 Go module

**做什么**:`cd server-hub && go mod init github.com/<owner>/agenthub-server-hub`,引入核心依赖。

**核心依赖**:
- `github.com/gin-gonic/gin`
- `gorm.io/gorm` `gorm.io/driver/postgres`
- `github.com/redis/go-redis/v9`
- `github.com/coder/websocket`
- `github.com/spf13/viper`
- `github.com/golang-migrate/migrate/v4`
- `github.com/golang-jwt/jwt/v5`
- `github.com/google/uuid`(UUIDv7 用)
- `golang.org/x/crypto/bcrypt`
- `github.com/swaggo/swag` `github.com/swaggo/gin-swagger`
- `github.com/stretchr/testify`

**做完后**:`go.mod` `go.sum` 已生成,`go mod tidy` 无报错。

### P1.3 写最小化 main.go

**做什么**:`cmd/server-hub/main.go` 启动一个 Gin 服务,监听 8080,只有 `/health` 返回 `{"status":"ok"}`。

**做完后**:`go run ./cmd/server-hub` 启动,`curl localhost:8080/health` 返回 200。

### P1.4 编写 Dockerfile

**做什么**:`deployments/Dockerfile` 多阶段构建(builder + alpine runtime),把 server-hub 打成镜像。

**关键点**:
- builder 阶段用 `golang:1.22-alpine`
- runtime 阶段用 `alpine:3.19`,装 `ca-certificates tzdata`
- 复制 `migrations/` 到镜像
- `EXPOSE 8080`

**做完后**:`docker build -t agenthub-server-hub .` 成功,`docker run -p 8080:8080 agenthub-server-hub` 后健康检查可达。

### P1.5 编写 docker-compose.yml

**做什么**:`deployments/docker-compose.yml` 定义 postgres、redis、server-hub 三个服务。

**关键点**:
- postgres 16-alpine,环境变量 DB/USER/PASSWORD,卷持久化
- redis 7-alpine,卷持久化
- server-hub depends_on postgres+redis,挂载 `uploads/` 卷
- server-hub 的环境变量覆盖 PG/Redis host

**做完后**:`docker-compose up -d` 三个容器全部 healthy,health 接口可访问。

---

## P2. 配置 / 日志 / 数据库 / 缓存

### P2.1 配置模块(viper)

**做什么**:`internal/config/config.go` 实现配置加载,支持 YAML + env 覆盖。

**配置项**:
```yaml
server:
  port: 8080
db:
  host: localhost
  port: 5432
  user: agenthub
  password: dev_password
  name: agenthub
redis:
  host: localhost
  port: 6379
jwt:
  secret: <随机字符串>
  access_ttl: 15m
  refresh_ttl: 720h
upload:
  dir: ./uploads
  max_size: 10485760
```

**关键点**:env 前缀 `AGENTHUB_`,如 `AGENTHUB_DB_HOST` 覆盖 `db.host`。

**做完后**:`configs/config.yaml` 和 `configs/config.docker.yaml` 已写好,`config.Load()` 可读取并支持 env 覆盖。

### P2.2 日志模块(slog)

**做什么**:`internal/log/log.go` 封装标准库 `slog`,结构化 JSON 输出,提供全局 logger。

**关键点**:level 由配置控制(debug/info/warn/error),启动时初始化为 `slog.Default`。

**做完后**:全局 `log.Info("msg", "key", val)` 可用,输出结构化 JSON。

### P2.3 数据库连接(GORM + PostgreSQL)

**做什么**:`internal/repository/db.go` 用 GORM 连 PG,导出全局 `*gorm.DB`。

**关键点**:
- 连接池:max idle 10,max open 100,conn lifetime 1h
- 启动时 ping 一次,失败则启动失败
- GORM logger 接到 slog

**做完后**:程序启动时打印 "db connected" 日志;断开 PG 后启动失败。

### P2.4 Redis 连接(go-redis)

**做什么**:`internal/cache/redis.go` 初始化 `*redis.Client`,导出全局。

**关键点**:启动时 `Ping()`,失败则启动失败。

**做完后**:程序启动时打印 "redis connected" 日志。

### P2.5 错误码定义

**做什么**:`internal/errcode/codes.go` 定义所有错误码常量,以及 `Error` 类型。

**结构**:
```go
type Error struct {
    Code    string
    Message string
    HTTPStatus int
}

var (
    OK = &Error{Code: "OK", Message: "", HTTPStatus: 200}
    AuthInvalidToken = &Error{Code: "AUTH_INVALID_TOKEN", Message: "token 无效或已过期", HTTPStatus: 401}
    SessionNotFound = &Error{Code: "SESSION_NOT_FOUND", ...}
    ...
)
```

**做完后**:全部预期错误码已声明,前缀分组清晰(AUTH_*/MSG_*/SESSION_*/AGENT_*/GROUP_*/USER_*/FRIEND_*/ATTACH_*/NOTIF_*)。

### P2.6 统一响应 envelope

**做什么**:`internal/handler/response.go` 提供 `OK(c, data)` `Fail(c, err)` 两个辅助函数。

**响应格式**:
```json
{ "code": "OK", "message": "", "data": {...} }
```

**关键点**:`Fail` 接 `*errcode.Error`,设置 HTTP 状态码并返回标准 JSON。

**做完后**:任意 handler 调用 `OK` / `Fail` 即可输出统一格式。

---

## P3. 数据库迁移

### P3.1 引入 golang-migrate

**做什么**:`scripts/migrate.sh` 封装 migrate 命令,支持 up/down/version。

**关键点**:
- migrate CLI 可用 docker 运行:`docker run --rm -v $(pwd)/migrations:/migrations migrate/migrate ...`
- 或者用 Go 库在程序启动时自动 migrate

**做完后**:`./scripts/migrate.sh up` 可执行所有迁移,`down` 可回滚。

### P3.2 编写所有表迁移脚本

**做什么**:在 `migrations/` 下按顺序写 up/down SQL,覆盖技术架构文档第 5 章所有 15 张表。

**文件命名**:`0001_users.up.sql` / `0001_users.down.sql` / `0002_friendships.up.sql` ...

**关键点**:
- 每张表单独一个迁移文件,便于单独回滚
- 索引、外键约束、触发器都写齐
- `CREATE EXTENSION IF NOT EXISTS pgcrypto` 用于 UUIDv7(或在应用层生成)

**做完后**:`migrate up` 执行后,PG 里 15 张表全部建好,`\dt` 可见。

### P3.3 启动时自动迁移

**做什么**:在 `main.go` 启动流程里调用 migrate,无新迁移则跳过。

**关键点**:用 `migrate.New("file://migrations", "postgres://...")` + `m.Up()`,`ErrNoChange` 忽略。

**做完后**:程序启动时若有新迁移自动执行,日志打印 "migrations applied"。

---

## P4. 认证模块

### P4.1 User model + repository

**做什么**:`internal/model/user.go` 定义 User 结构;`internal/repository/user.go` 提供 Create/GetByID/GetByUsername/Update/UpdatePassword。

**关键点**:
- model 用 GORM tag,`gorm:"primaryKey;type:uuid"`
- 用 UUIDv7 作主键(BeforeCreate hook)
- password_hash 字段不在 JSON 序列化中

**做完后**:`go test ./internal/repository -run TestUser` 通过(写一个简单 CRUD 测试)。

### P4.2 注册接口

**做什么**:`POST /client/auth/register`,handler 校验参数 → service 哈希密码 → 写库 → 返回 user_id。

**校验**:username 4-32 字符,密码 8-64 字符。

**错误码**:`USER_USERNAME_TAKEN`(用户名已存在)、`USER_INVALID_PARAM`。

**做完后**:`curl -X POST` 注册成功返回 user_id,重复注册返回 USER_USERNAME_TAKEN。

### P4.3 JWT 工具

**做什么**:`internal/jwtutil/jwt.go` 提供 `GenerateAccess(userID, deviceType, deviceID)` 和 `Parse(token)`。

**Claims 结构**:
```go
type Claims struct {
    UserID     string
    DeviceType string  // web / desktop
    DeviceID   string
    jwt.RegisteredClaims  // exp, iat
}
```

**关键点**:HS256 签名,secret 来自 config。

**做完后**:单元测试覆盖生成和解析正反两条路径。

### P4.4 登录接口

**做什么**:`POST /client/auth/login`,校验密码 → 生成 access + refresh → refresh 哈希存 PG `refresh_tokens` 表 → 返回。

**入参**:username、password、device_type、device_id

**关键点**:
- refresh_token 是随机 32 字节 base64,哈希后入库
- 同 (user_id, device_type, device_id) 已有 refresh 则更新,不创新行

**做完后**:登录返回 access_token 和 refresh_token,密码错误返回 `AUTH_INVALID_CREDENTIALS`。

### P4.5 auth 中间件

**做什么**:`internal/middleware/auth.go`,从 Authorization 头取 Bearer token,解析后注入 `c.Set("user_id", ...)` `c.Set("device_type", ...)` `c.Set("device_id", ...)`。

**device_type 校验中间件**:`internal/middleware/device_type.go`,接受白名单(`web` / `desktop`),不在白名单返回 403。

**做完后**:受保护接口加上 `authMiddleware()` 后,无 token 返回 401,token 错误返回 401。

### P4.6 token 刷新 + 登出

**做什么**:
- `POST /client/auth/refresh`:校验 refresh_token(查 PG)→ 颁发新 access_token
- `POST /client/auth/logout`:吊销 refresh_token(`revoked = true`)+ Redis 路由表清理(后续 P6 接入)

**做完后**:刷新成功返回新 access_token;登出后旧 refresh 不可用。

### P4.7 修改资料 / 修改密码 / 当前用户信息

**做什么**:
- `GET /client/auth/me`:返回当前用户信息
- `PUT /client/auth/profile`:改昵称、头像 URL
- `PUT /client/auth/password`:校验旧密码 → 改新密码 → 吊销该用户所有 refresh_token

**做完后**:三个接口正常工作,改密后旧 refresh 全部失效。

---

## P5. WebSocket 基础

### P5.1 WS Manager 设计

**做什么**:`internal/ws/manager.go` 维护 conn 集合,提供注册/注销/推送方法。

**核心数据结构**:
```go
type Manager struct {
    mu     sync.RWMutex
    conns  map[string]*Conn   // conn_id → *Conn
    byUser map[string]map[string]string  // user_id → device_type → conn_id
}

type Conn struct {
    ID         string
    UserID     string
    DeviceType string
    DeviceID   string
    ws         *websocket.Conn
    send       chan []byte
}
```

**核心方法**:`Register(c *Conn)` `Unregister(connID)` `PushToUser(userID, frame)` `PushToConn(connID, frame)` `PushToSession(sessionID, frame)`(后者要查会话成员表)。

**做完后**:Manager 单元测试通过(注册→推送→注销)。

### P5.2 WS 路由与升级

**做什么**:`GET /client/ws` 路由,用 coder/websocket Accept 升级 HTTP → WebSocket。

**关键点**:
- 不在升级前做 auth(让连接先建立)
- 升级成功后启 reader 和 writer 两个 goroutine
- 连接 5 秒内未收到 auth 帧则关闭

**做完后**:浏览器控制台用 `new WebSocket("ws://localhost:8080/client/ws")` 能连上,5 秒后被服务端关闭。

### P5.3 auth 帧处理

**做什么**:reader 收到第一个 message 必须是 `{"type":"auth", "payload":{"access_token":"...","device_id":"..."}}`,校验后调用 Manager.Register。

**关键点**:
- token 校验失败:推 `{"type":"auth.fail"}` 后关闭
- 成功:推 `{"type":"auth.ok"}`,后续才接受其他帧
- 注册时把 conn_id 写 Redis 路由表(P6.3 接入,本步先留 TODO)

**做完后**:浏览器先发 auth 帧能成功,token 错误被关闭。

### P5.4 心跳机制

**做什么**:Manager 每 30 秒给每个 conn 发 ping(coder/websocket 内置 ping/pong),连续 2 次未回 pong 关闭连接。

**做完后**:连接稳定保活,网络断开后 60 秒内 conn 被清理。

### P5.5 推送统一帧格式

**做什么**:`internal/ws/frame.go` 定义 `Frame` 结构和编码方法。

**结构**:
```go
type Frame struct {
    Type    string      `json:"type"`
    SeqID   int64       `json:"seq_id,omitempty"`
    Payload interface{} `json:"payload,omitempty"`
}
```

**做完后**:Manager.PushToUser 等方法接受 Frame,序列化后发送。

---

## P6. 设备路由与在线状态

### P6.1 Device model + repository

**做什么**:`devices` 表的 GORM model 和 CRUD repo(Upsert by user_id+device_id)。

**做完后**:repo 单元测试通过。

### P6.2 Redis 设备路由表

**做什么**:`internal/cache/route.go` 封装 Redis Hash 操作:
- `SetRoute(userID, deviceType, connID)` → HSET
- `GetRoute(userID, deviceType)` → HGET
- `DeleteRoute(userID, deviceType)` → HDEL
- `IsOnline(userID)` → HEXISTS web OR desktop

**做完后**:操作 Redis 的几个方法单元测试通过(用 miniredis 或真 Redis 集成测试)。

### P6.3 WS 注册时写路由表

**做什么**:在 P5.3 的 auth 成功后,调用 `cache.SetRoute(userID, deviceType, connID)`;Unregister 时 DeleteRoute。

**做完后**:WS 连接建立后,Redis `device_route:{user_id}` 有对应 entry;断开后清除。

### P6.4 单设备登录踢前

**做什么**:auth 帧处理时,检查同 (user_id, device_type) 是否已有 conn_id;若有则:
1. 推 `{"type":"device.kicked"}` 给旧 conn
2. 关闭旧 conn
3. 注册新 conn

**关键点**:加锁防竞态;`kicked:{conn_id}` Redis 标记 60 秒,避免被踢的客户端立刻重连又触发踢前循环。

**做完后**:同一 (user_id, device_type) 第二次连上,第一个连接收到 device.kicked 后断开。

### P6.5 设备注册接口(/edge/devices/register)

**做什么**:`POST /edge/devices/register`,接收 `device_id app_version capabilities`,upsert 到 devices 表。

**关键点**:device_id 由客户端生成 UUIDv7 持久化,服务端只做 upsert。

**做完后**:edge 启动时调用一次,devices 表有对应行。

### P6.6 上下线广播给好友

**做什么**:WS 注册成功后,查该用户的好友列表,给每个在线好友推 `{"type":"device.online", "payload":{"user_id":...}}`;断开时同理推 `device.offline`。

**关键点**:只有从"全离线 → 上线"和"上线 → 全离线"才广播,避免 web 上线 + App 上线推两次。

**做完后**:用户上线,其在线好友的客户端能收到事件。

---

## P7. 联系人

### P7.1 Friendship model + repository

**做什么**:friendships 表 model 和 repo,包括 `(user_id, friend_id)` 双向写入辅助方法。

**做完后**:repo 单元测试通过。

### P7.2 按 ID 搜索陌生人

**做什么**:`GET /client/contacts/search?id=xxx`,返回基础信息(昵称、头像、是否已是好友)。

**做完后**:接口可调通,搜索自己/不存在的 ID 返回相应错误。

### P7.3 发送好友请求

**做什么**:`POST /client/contacts/friend-requests`,入参 friend_id 和 验证消息;创建 status=pending 的 friendship。

**关键点**:
- 已是好友返回 `FRIEND_ALREADY`
- 自己加自己返回参数错误
- 已被对方拉黑返回 `FRIEND_BLOCKED`(对外不暴露,统一返回 USER_NOT_FOUND)
- 创建后给对方推 `notification.new`(P13 接入,本步先留 TODO)

**做完后**:发送成功返回 OK;对方查询收到的请求能看到。

### P7.4 处理好友请求

**做什么**:
- `GET /client/contacts/friend-requests?direction=incoming|outgoing`
- `POST /client/contacts/friend-requests/{id}/accept`:status → accepted,同时反向插一行 accepted
- `POST /client/contacts/friend-requests/{id}/reject`:status → rejected

**做完后**:同意后双方都在对方的联系人列表里。

### P7.5 联系人列表

**做什么**:`GET /client/contacts`,返回所有 status=accepted 的好友(用户)+ 平台预置 agent 列表。

**关键点**:agent 列表先 hardcode(claude-code、codex、orchestrator 三个),后续 P11 自建 agent 接入再扩展。

**做完后**:列表正确显示用户和 agent 混合,带在线状态。

### P7.6 删除 / 拉黑 / 备注

**做什么**:
- `DELETE /client/contacts/{user_id}`:双向删除 friendship 行
- `POST /client/contacts/{user_id}/block`:status → blocked
- `DELETE /client/contacts/{user_id}/block`:取消拉黑
- `PUT /client/contacts/{user_id}/remark`:更新 remark

**做完后**:四个接口工作正常,拉黑后对方发消息被拒(在 P9 消息发送时校验)。

---

## P8. 会话与群聊

### P8.1 Session + SessionMember model + repository

**做什么**:两张表的 model 和 repo;repo 提供 GetSessionsByUser、GetMembers、IsMember、GetByPrivatePair 等方法。

**做完后**:repo 单元测试通过。

### P8.2 创建私聊

**做什么**:`POST /client/sessions/private`,入参 target_id(user 或 agent_instance)。

**关键点**:
- 用户↔用户:按 (min, max) 顺序查重,已存在则返回已有 session
- 用户↔agent:每次创建新 session(因为每个用户跟每种 agent 可能有多个独立会话)— 这一点需要确认,先按"每对用户唯一"实现,agent 私聊场景 P11 再优化

**做完后**:创建成功返回 session_id,重复创建私聊返回同一 session。

### P8.3 创建群聊

**做什么**:`POST /client/sessions/group`,入参 name 和 member_ids;创建 session(owner=自己) + session_members(自己 owner 角色 + 邀请的成员 member 角色)。

**做完后**:返回 session_id,所有被邀请人在自己的会话列表能看到。

### P8.4 会话列表

**做什么**:`GET /client/sessions`,返回当前用户加入的所有未删除会话,按 last_message_at 倒序。

**返回字段**:session_id、type、name、avatar、last_message preview、unread_count、pinned、archived、muted。

**关键点**:
- unread_count = max(0, session.next_seq - member.last_read_seq)
- last_message preview 需要 join messages 表取最新一条

**做完后**:列表正确分页(本步先返全部,后续大数据量再加分页),字段完整。

### P8.5 拉人 / 踢人 / 退群

**做什么**:
- `POST /client/sessions/{id}/members`:任何成员可拉用户;拉 agent 走 P11 流程
- `DELETE /client/sessions/{id}/members/{member_id}`:
  - 自己退群:任何成员可
  - 踢人:仅群主
  - 群主自己尝试退群:返回 `GROUP_OWNER_CANNOT_LEAVE`
- 退群事务:删 session_member(软删,设 left_at)+ 找出该成员邀请的 agent_instance + 取消未完成任务(P11 接入)+ 广播

**做完后**:三个接口工作,广播事件正确。

### P8.6 转让群主 + 解散群

**做什么**:
- `POST /client/sessions/{id}/transfer`,入参 new_owner_id;事务:更新 session.owner_user_id + 修改两个成员的 role + 广播
- `POST /client/sessions/{id}/dissolve`:仅群主可;session.dissolved=true;广播 `session.dissolved`;所有成员的会话变只读

**做完后**:转让后原群主可正常退群;解散后无法发消息(P9 校验)。

### P8.7 修改群信息

**做什么**:`PUT /client/sessions/{id}/info`,仅群主;支持改 name、avatar、announcement;广播 `session.info_updated`。

**做完后**:接口正常,非群主返回 `GROUP_NOT_OWNER`。

### P8.8 置顶 / 归档 / 免打扰 / 删除会话

**做什么**:对 `session_members` 表对应字段切换。

- `PUT /client/sessions/{id}/pin` 切 pinned
- `PUT /client/sessions/{id}/archive` 切 archived
- `PUT /client/sessions/{id}/mute` 切 muted
- `DELETE /client/sessions/{id}`:本端隐藏(set archived 或类似)

**做完后**:四个状态切换正常,会话列表能按状态过滤。

---

## P9. 消息核心

### P9.1 Message model + repository

**做什么**:messages 表 model 和 repo,核心方法:
- `Insert(msg)`:在事务内调用(由 service 层提供事务上下文)
- `GetBySession(sessionID, beforeSeq, limit)`
- `GetIncrement(sessionID, afterSeq)`
- `GetByClientMsgID(sessionID, clientMsgID)`(去重查询)

**做完后**:repo 单元测试通过。

### P9.2 EventBus(进程内事件总线)

**做什么**:`internal/service/eventbus.go`,简单 channel 实现。

**接口**:
```go
type Event struct {
    Type    string
    Payload interface{}
}

type Bus struct { ch chan Event }

func (b *Bus) Publish(e Event)
func (b *Bus) Subscribe(handler func(Event))
```

**关键点**:消息写库后 Publish,WS 层 Subscribe 然后调 Manager 推送。这样 service 不直接依赖 WS。

**做完后**:单元测试覆盖发布订阅。

### P9.3 发消息接口

**做什么**:`POST /client/sessions/{id}/messages`,入参 client_msg_id、content_type、content、reply_to_message_id?。

**业务流程**:
1. 校验:发送者是该会话成员;会话未解散;发送者未被群主全员禁言(暂不实现);content_type 合法
2. 事务:
   - SELECT FOR UPDATE 取 sessions.next_seq
   - UPDATE sessions SET next_seq = next_seq + 1, last_message_at = NOW() RETURNING next_seq
   - INSERT messages(seq_id = next_seq, ...)
3. 提交事务后 EventBus.Publish("message.new", msg)
4. WS 层 Subscribe 后 Manager.PushToSession(sessionID, frame)
5. 返回 message_id 和 seq_id

**关键点**:
- 用 (session_id, client_msg_id) 唯一索引去重,违反唯一约束时回查已有消息返回(幂等)
- 推送时排除发送者自己(可选,看产品决策)

**做完后**:两个客户端在同一会话各发消息,都能看到对方消息;重复 client_msg_id 返回同一 seq_id 不生成重复消息。

### P9.4 消息历史查询

**做什么**:`GET /client/sessions/{id}/messages?before_seq=xxx&limit=50`,返回 seq_id < before_seq 的最近 limit 条,按 seq_id 倒序。

**做完后**:分页拉取正常,空会话返回空数组。

### P9.5 增量同步接口

**做什么**:`GET /client/sessions/{id}/messages/sync?after_seq=xxx`,返回 seq_id > after_seq 的所有消息,按 seq_id 升序,limit 500。

**关键点**:客户端断线重连或冷启动时调用,补齐错过的消息。

**做完后**:断线 → 重连 → 调 sync 能拿到错过的消息。

### P9.6 发消息时校验拉黑关系

**做什么**:在私聊中,发送前校验对方是否拉黑自己;若拉黑返回 `MSG_BLOCKED_BY_RECEIVER`。

**做完后**:被拉黑后无法发消息。

---

## P10. 消息高级操作

### P10.1 撤回

**做什么**:`POST /client/messages/{id}/recall`。

**权限**:
- 自己的消息:发送后 2 分钟内
- 群主:无时限,任何成员的消息
- agent 消息:邀请人可撤(无时限)

**实现**:UPDATE messages SET recalled=true;同时 unpin(若 pinned);广播 `message.recall`。

**做完后**:撤回后客户端显示"已撤回";超时撤回返回 `MSG_RECALL_TIMEOUT`。

### P10.2 pin / unpin

**做什么**:
- `POST /client/messages/{id}/pin`:写 message_pins;广播 `message.pin`
- `DELETE /client/messages/{id}/pin`:仅 pin 发起人或群主;删 message_pins;广播 `message.unpin`
- `GET /client/sessions/{id}/pins`:返回 pin 列表

**关键点**:每会话上限 50,超限返回 `MSG_PIN_LIMIT_EXCEEDED`。

**做完后**:三个接口正常;撤回时同步 unpin(在 P10.1 加上)。

### P10.3 引用回复

**做什么**:发消息时支持 `reply_to_message_id`,字段已在 P9.3 数据表里;客户端拉历史时一并返回被引用消息(若已撤回则 content 字段为空,UI 显示"该消息已撤回")。

**做完后**:引用消息渲染正常。

### P10.4 转发

**做什么**:`POST /client/messages/{id}/forward`,入参 target_session_id;复制原消息内容(含原 sender 标识)生成新消息发到目标会话。

**关键点**:转发的 content JSON 里加 `forwarded_from: {original_sender_id, original_sender_name, original_session_id}`。

**做完后**:转发后目标会话收到带"转发自 X"标识的消息。

### P10.5 已读回执

**做什么**:
- `POST /client/messages/{id}/read`(批量上报最近读到的位置:其实更合理是 `POST /client/sessions/{id}/read?up_to_seq=xxx`)
- `GET /client/messages/{id}/reads`:群聊查已读列表
- 实现:更新 session_members.last_read_seq;同时给该 session 其他成员推 `message.read`

**做完后**:私聊"对方已读"显示正确;群聊已读人数正确。

### P10.6 输入中提示

**做什么**:WS 接收 `{"type":"typing", "payload":{"session_id":"..."}}`,服务端写 Redis `typing:{session_id}:{user_id}` TTL 5s,然后广播给该会话其他成员。

**做完后**:输入时其他端 5 秒内显示"对方正在输入"。

---

## P11. Agent 模块

### P11.1 AgentInstance + CustomAgent model + repository

**做什么**:两张表的 model 和 repo。

**做完后**:repo 单元测试通过。

### P11.2 拉 agent 进群(创建实例)

**做什么**:扩展 P8.5 的拉人接口,支持 `member_type=agent_instance`。

**业务流程**:
1. 接收 agent_type(预置或 custom_agent_id)+ workspace_id?
2. INSERT agent_instances(session_id, agent_type, custom_agent_id?, inviter_user_id=自己, workspace_id?)
3. INSERT session_members(member_type=agent_instance, member_id=新建的 agent_instance_id, role=member)
4. 广播 `session.member_joined`

**做完后**:agent 出现在会话成员列表,可被 @。

### P11.3 邀请人退群联动

**做什么**:在 P8.5 的退群事务里加上:
1. 找出 agent_instances WHERE session_id=xxx AND inviter_user_id=离开者
2. 对每个 agent_instance:
   - 删 session_members 中对应行
   - DELETE agent_instances 行(或软删)
   - 取消该 agent_instance 的所有 PendingAgentTask(status=cancelled)
3. 广播 `agent_instance.removed`

**做完后**:邀请人退群后,他拉的 agent 跟着退群,正在跑的任务取消。

### P11.4 自建 agent 管理

**做什么**:
- `POST /web/custom-agents`:创建,owner=自己
- `PUT /web/custom-agents/{id}`:编辑(校验 owner)
- `DELETE /web/custom-agents/{id}`:软删
- `GET /web/custom-agents`:列表

**做完后**:创建的 agent 出现在自己的联系人列表,可拉进会话。

### P11.5 PendingAgentTask model + repository

**做什么**:表的 model 和 repo;repo 提供 Create/UpdateStatus/GetByUser/GetExpired 方法。

**做完后**:repo 单元测试通过。

### P11.6 web 触发 agent 任务接口

**做什么**:`POST /web/agent-tasks`,入参:trigger_message_id(已经发出去的 @消息 ID)。

**业务流程**:
1. 校验 trigger_message_id 存在,且消息 @ 了某 agent_instance
2. 创建 PendingAgentTask(status=queued, expire_at=now+24h)
3. 计算上下文:取该会话最近 N 条 + pinned 消息(过滤 recalled)
4. 调用 P11.7 的路由逻辑

**做完后**:web 调用接口返回 task_id。

### P11.7 任务路由

**做什么**:`internal/service/agent_dispatch.go`。

**逻辑**:
```
inviter := agent_instance.inviter_user_id
edge_conn := cache.GetRoute(inviter, "desktop")
if edge_conn 存在:
    Manager.PushToConn(edge_conn, Frame{Type: "agent.dispatch", Payload: {task_id, agent_type, system_prompt, context_messages, workspace_path}})
    UpdateStatus(task_id, "dispatched")
else:
    LPUSH pending_tasks:{inviter} task_payload
    UpdateStatus(task_id, "queued")
```

**做完后**:edge 在线则收到派发,离线则进队列。

### P11.8 离线队列推送

**做什么**:edge WS 注册成功的回调里,RPOP/LRANGE `pending_tasks:{user_id}`,逐个 Manager.PushToConn。

**关键点**:推送后 UpdateStatus 为 dispatched;若推送失败保留在队列里。

**做完后**:App 上线后,排队任务被推送给 edge。

### P11.9 任务取消 / 超时扫描

**做什么**:
- `POST /web/agent-tasks/{id}/cancel`:发起人可取消;status=cancelled;若已 dispatched 则给 edge 推 `agent.cancel` 事件
- 定时任务(每分钟):查 expire_at < now 且 status in (queued, dispatched) 的任务,标记 timeout,通知发起人

**做完后**:超时任务 24h 后自动失败;手动取消立即生效。

### P11.10 edge 上报任务状态接口

**做什么**:
- `POST /edge/agent-tasks/{id}/ack`:edge 确认收到派发,status=running
- `POST /edge/agent-tasks/{id}/stream`:流式上报输出片段,服务端将其作为 agent 消息插入(增加一条 message 或追加内容,取决于产品决策——建议每个流式片段是一条新消息,客户端按需合并显示)
- `POST /edge/agent-tasks/{id}/done`:完成,带最终 final 内容,status=done
- `POST /edge/agent-tasks/{id}/fail`:失败,带错误原因,status=failed

**关键点**:stream 方式可考虑用 WS 帧 `agent.stream` 替代 HTTP,效率更高;也可两者都支持。这里建议 HTTP 接口先实现简单版,后续优化为 WS。

**做完后**:agent 输出能从 edge 流到所有客户端。

---

## P12. 附件

### P12.1 hash 路径工具

**做什么**:`internal/service/attachment.go` 提供 `PathFromHash(hash) string`,返回 `uploads/xx/yy/{full_hash}`。

**做完后**:工具函数单元测试通过。

### P12.2 探测秒传

**做什么**:`POST /client/attachments/probe`,入参 hash;若 attachments 表有该 hash 返回 attachment_id(秒传成功),否则返回 NOT_FOUND 让客户端继续上传。

**做完后**:重复文件秒传成功。

### P12.3 上传

**做什么**:`POST /client/attachments`,multipart/form-data,字段:file、hash(客户端先算)、original_name。

**业务流程**:
1. 服务端接收文件流,边接收边算 sha256,落到临时文件
2. 上传完成后核对 hash 一致,不一致拒绝
3. 移动文件到 `PathFromHash(hash)`(若已存在直接复用)
4. INSERT attachments
5. 返回 attachment_id

**关键点**:大小上限 10MB(配置项),超过返回 `ATTACH_TOO_LARGE`。

**做完后**:上传成功返回 attachment_id,文件可在 uploads 目录找到。

### P12.4 下载

**做什么**:`GET /client/attachments/{id}`,查 attachments 取路径,流式返回文件;Content-Type 用 mime_type;支持 Range 头(可选,先不实现)。

**关键点**:404 返回 `ATTACH_NOT_FOUND`;文件被外部删除返回 500。

**做完后**:下载链接能直接在浏览器打开图片/文件。

---

## P13. 通知

### P13.1 Notification model + 基础接口

**做什么**:notifications 表的 model 和 repo;实现:
- `GET /client/notifications?unread_only=true&limit=50&offset=0`
- `POST /client/notifications/{id}/read`
- `POST /client/notifications/read-all`

**做完后**:三个接口正常,通知列表按 created_at 倒序。

### P13.2 通知服务封装

**做什么**:`internal/service/notification.go` 提供 `Notify(userID, type, payload)`,内部:
1. INSERT notifications
2. 若该用户在线,推 `notification.new` 事件

**做完后**:服务可单元测试,推送依赖 Manager 可 mock。

### P13.3 各业务接入通知

**做什么**:在以下业务点调 Notify:
- @ 消息(P9.3 发消息时,如果 content 含 mention,给被 @ 用户发 type=mention 通知;若该会话 muted 则跳过)
- 好友请求(P7.3 发送时给对方发 friend_request 通知)
- 群邀请(P8.5 拉人时给被拉者发 group_invite 通知)
- agent 任务完成(P11.10 done 时给发起人发 agent_done 通知)

**做完后**:四类业务都能在通知中心看到。

---

## P14. 搜索

### P14.1 联系人搜索

**做什么**:`GET /client/contacts?q=xxx`(扩展 P7.5),按 username/nickname/remark 模糊匹配。

**关键点**:用 PG 的 `ILIKE '%xxx%'`,数据量小够用;需要时加 pg_trgm 扩展。

**做完后**:输入字符返回匹配的联系人。

### P14.2 会话搜索

**做什么**:`GET /client/sessions/search?q=xxx`,按群名 + 最近消息内容 ILIKE 匹配。

**做完后**:能搜到群名匹配或近期有匹配消息的会话。

### P14.3 消息搜索

**做什么**:
- `GET /client/messages/search?q=xxx&session_id=&content_type=&from=&to=`:全局或会话内搜索,带过滤器
- `GET /client/sessions/{id}/messages/search?q=xxx`:会话内简化版

**关键点**:content_type=text 时直接 ILIKE content->>'text' 字段;其他类型按 content 整体 ILIKE 即可;后续数据量大再考虑全文索引(tsvector 或 ES)。

**做完后**:能搜到匹配消息,跳转到原会话定位到该消息(前端实现)。

---

## P15. 文档与部署

### P15.1 Swagger 注释 + 生成

**做什么**:在所有 handler 上加 swag 注释;启动时挂 `/swagger/index.html`。

**关键点**:`make swagger` 调用 `swag init -g cmd/server-hub/main.go -o api/`。

**做完后**:浏览器访问 swagger 页面能看到全部 API。

### P15.2 集成测试基础设施

**做什么**:
- `internal/integration_test/` 目录
- 测试启动脚本:跑迁移、起测试用 PG/Redis(testcontainers-go)、启服务、跑 case
- 提供 helper:创建测试用户、登录拿 token、构建会话

**做完后**:`go test ./internal/integration_test` 一条命令跑通基础场景。

### P15.3 关键流程集成测试

**做什么**:覆盖以下场景:
- 注册→登录→改密→刷新→登出
- 加好友→列表→拉黑
- 建群→拉人→发消息→历史→撤回→pin
- 拉 agent→web 触发任务→edge ack→stream→done→消息广播
- 单设备登录踢前
- 断线重连增量同步

**做完后**:六大流程的集成测试全绿。

### P15.4 Docker 镜像优化与部署文档

**做什么**:
- Dockerfile 用 distroless 或更小 base 减镜像大小
- docker-compose 加上 healthcheck
- 写 `README.md`:开发环境启动、生产部署、环境变量说明、常见排错

**做完后**:`docker-compose up -d` 一键启动整个 stack;按 README 步骤新人 30 分钟内能跑起来。

---

## 开发节奏建议

- 阶段 P1-P3 是基建,1-2 天搞定后续不再大改
- 阶段 P4-P6 是骨架,完成后服务的"形"已成,后续都是往里塞业务
- 阶段 P7-P11 是核心业务,占总工作量 60%+
- 阶段 P12-P14 是补充功能,可以根据时间灵活裁剪(课题 demo 阶段优先级:P14 > P12 > P13)
- 阶段 P15 收尾,贯穿整个开发过程,不必等到最后才做

每完成一个阶段,在 `README.md` 里勾选完成状态;每个步骤完成后跑相关单元测试 + 手动验收一次,避免后期回归大量返工。
