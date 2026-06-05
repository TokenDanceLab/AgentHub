# Hub Server 依赖注入架构设计

> 目标：消除 `config.Cfg`、`repository.DB`、`cache.RDB` 三个全局单例，实现 Manual DI（手动依赖注入）。
>
> 关联审计项：P1-2（消除 config.Cfg 全局单例）、P1-3（消除 repository.DB 全局单例）
>
> 参考：`docs/archive/build-specs/backend/02-go-services.md` 6.1 节（Manual DI 起步，Wire 加速）

## 1. 现状分析

### 1.1 三个全局单例的定义

| 全局变量 | 包 | 类型 | 赋值点 |
|---------|-----|------|-------|
| `config.Cfg` | `hub-server/internal/config` | `*Config` | `config.Load()` |
| `repository.DB` | `hub-server/internal/repository` | `*gorm.DB` | `repository.InitDB()` |
| `cache.RDB` | `hub-server/internal/cache` | `*redis.Client` | `cache.InitRedis()` |

### 1.2 全局变量引用分布

#### `config.Cfg`（14 处引用）

| 文件 | 调用次数 | 用途 |
|------|---------|------|
| `router/router.go` | 8 | `config.Cfg.JWT.Secret` 传给 AuthMiddleware |
| `service/auth.go` | 5 | `config.Cfg.JWT.{Secret,AccessTTL,RefreshTTL}` |
| `service/attachment.go` | 1 | `config.Cfg.Upload.MaxSize` |

#### `repository.DB`（24 处引用）

| 文件 | 调用次数 | 上下文 |
|------|---------|-------|
| `cmd/server-hub/main.go` | 9 | 内联业务逻辑直接访问 DB |
| `tests/setup_test.go` | 9 | 测试初始化用 `repository.DB` 构造服务 |
| `cmd/server-hub/main.go` | 1 | `repository.DB.DB()` 获取 sql.DB 做统计 |
| `cmd/server-hub/main.go` | 4 | 传给 repository 函数（`ListActiveMembers`, `GetPendingTaskByID` 等） |
| `cmd/server-hub/main.go`（metrics goroutine） | 1 | `repository.DB.DB()` 获取连接池统计 |

#### `cache.RDB`（约 30 处引用，分布在 4 个文件）

| 文件 | 调用次数 | 用途 |
|------|---------|------|
| `cmd/server-hub/main.go` | 1 | `cache.RDB.PoolStats().Hits` 指标采集 |
| `cache/data.go` | 3 | `RDB.Get`, `RDB.Set`, `RDB.Del`（通过 GetOrLoad / Invalidate） |
| `cache/route.go` | 8 | `RDB.HSet/HGet/HDel/HLen/HGetAll/Exists/Set/LPush/LRange/LLen/Del` |
| `cache/seq.go` | 3 | `RDB.Incr/SetNX/Get` |

### 1.3 已完成的依赖注入

好消息：服务层已经局部使用构造函数注入：

```go
// 所有 Service 构造函数已经接收 *gorm.DB 而非访问 repository.DB
authService := service.NewAuthService(repository.DB)        // 接收 db
contactService := service.NewContactService(repository.DB, bus)
messageService := service.NewMessageService(repository.DB, bus)
agentService := service.NewAgentService(repository.DB, bus, mgr)
// ... 等等
```

所有 Handler 也已通过构造函数接收 Service：

```go
authHandler := handler.NewAuthHandler(authService)
contactHandler := handler.NewContactHandler(contactService)
// ... 等等
```

### 1.4 仍通过全局访问的路径

| 包 | 访问方式 | 问题 |
|----|---------|-----|
| `service/auth.go` | `config.Cfg.JWT.*`（直接读全局） | 构造时传了 db 但 config 仍是全局 |
| `service/auth.go` | `cache.Invalidate()` → 内部使用 `RDB` | cache 函数内部绑定全局 RDB |
| `service/attachment.go` | `config.Cfg.Upload.MaxSize` | 全局 config |
| `service/session.go` | `cache.InitSeqIfAbsent()`, `cache.Invalidate()` | 全局 RDB |
| `service/contact.go` | `cache.IsOnline()`, `cache.Invalidate()` | 全局 RDB |
| `service/agent.go` | `cache.GetRoute()`, `cache.PushPendingTask()` | 全局 RDB |
| `router/router.go` | `config.Cfg.JWT.Secret` | 全局 config |
| `main.go` | 大量 `repository.DB` 和 `repository.Xxx(DB, ...)` 内联调用 | 全局 DB |
| `cache/*.go` | 所有函数内部使用 `RDB` | 全局 RDB |

## 2. App 结构设计

### 2.1 顶层 DI 容器

在 `hub-server/internal/app/` 新建包，定义 `App` 作为顶层 DI 容器：

```go
// hub-server/internal/app/app.go
package app

import (
    "github.com/agenthub/hub-server/internal/cache"
    "github.com/agenthub/hub-server/internal/config"
    "github.com/agenthub/hub-server/internal/handler"
    "github.com/agenthub/hub-server/internal/metrics"
    "github.com/agenthub/hub-server/internal/service"
    "github.com/agenthub/hub-server/internal/ws"
    "github.com/redis/go-redis/v9"
    "gorm.io/gorm"
)

// App 是 Hub Server 的顶层 DI 容器（Manual DI 风格）。
// 所有依赖通过构造函数注入，App 负责组装完整的依赖图。
type App struct {
    // 基础设施（可直接访问，用于测试和诊断）
    Config  *config.Config
    DB      *gorm.DB
    Redis   *redis.Client
    Manager *ws.Manager
    Bus     *service.Bus

    // 服务层（按需暴露给测试）
    AuthService         *service.AuthService
    ContactService      *service.ContactService
    SessionService      *service.SessionService
    MessageService      *service.MessageService
    AgentService        *service.AgentService
    AttachmentService   *service.AttachmentService
    NotificationService *service.NotificationService

    // 处理层
    AuthHandler         *handler.AuthHandler
    WebSocketHandler    *handler.WebSocketHandler
    DeviceHandler       *handler.DeviceHandler
    ContactHandler      *handler.ContactHandler
    SessionHandler      *handler.SessionHandler
    MessageHandler      *handler.MessageHandler
    AgentHandler        *handler.AgentHandler
    CustomAgentHandler  *handler.CustomAgentHandler
    AttachmentHandler   *handler.AttachmentHandler
    NotificationHandler *handler.NotificationHandler

    // 后台任务
    shutdowns []func() // 优雅关闭回调
}
```

### 2.2 构造函数

```go
// New 构建完整依赖图。
func New(cfg *config.Config) (*App, error) {
    app := &App{Config: cfg}

    // === Layer 0: 基础设施 ===
    db, err := initDB(&cfg.DB)
    if err != nil {
        return nil, fmt.Errorf("init db: %w", err)
    }
    app.DB = db

    if err := runMigrations(&cfg.DB); err != nil {
        return nil, fmt.Errorf("run migrations: %w", err)
    }

    rdb, err := initRedis(&cfg.Redis)
    if err != nil {
        return nil, fmt.Errorf("init redis: %w", err)
    }
    app.Redis = rdb

    // CacheClient 封装 Redis，替代包级全局 RDB
    cacheClient := cache.NewClient(rdb)

    // WebSocket 管理器
    mgr := ws.NewManager()
    app.Manager = mgr

    // 事件总线
    bus := service.NewBus()
    app.Bus = bus

    // === Layer 1: 服务层（显式传入所有依赖） ===
    app.AuthService = service.NewAuthService(db, cacheClient, &cfg.JWT)
    app.ContactService = service.NewContactService(db, bus, cacheClient)
    app.SessionService = service.NewSessionService(db, cacheClient)
    app.MessageService = service.NewMessageService(db, bus, cacheClient)
    app.AgentService = service.NewAgentService(db, bus, mgr, cacheClient)
    app.AttachmentService = service.NewAttachmentService(db, &cfg.Upload)
    app.NotificationService = service.NewNotificationService(db, mgr)

    // === Layer 2: Handler 层 ===
    app.WebSocketHandler = handler.NewWebSocketHandler(mgr, cfg.JWT.Secret)
    app.AuthHandler = handler.NewAuthHandler(app.AuthService)
    app.DeviceHandler = handler.NewDeviceHandler(db)
    app.ContactHandler = handler.NewContactHandler(app.ContactService)
    app.SessionHandler = handler.NewSessionHandler(app.SessionService)
    app.MessageHandler = handler.NewMessageHandler(app.MessageService)
    app.AgentHandler = handler.NewAgentHandler(app.AgentService)
    app.CustomAgentHandler = handler.NewCustomAgentHandler(app.AgentService)
    app.AttachmentHandler = handler.NewAttachmentHandler(app.AttachmentService)
    app.NotificationHandler = handler.NewNotificationHandler(app.NotificationService)

    // === Layer 3: 后台任务 ===
    app.setupBackgroundTasks()

    return app, nil
}
```

### 2.3 Cache Client 封装

当前 `cache` 包的所有函数直接使用全局 `RDB`。改造方案：将函数转为方法，挂在 `CacheClient` 上。

```go
// hub-server/internal/cache/client.go
package cache

import "github.com/redis/go-redis/v9"

// Client 封装 Redis 操作，替代包级全局 RDB。
// 通过 NewClient 构造，传入 App 给所有需要缓存的组件。
type Client struct {
    rdb *redis.Client
}

func NewClient(rdb *redis.Client) *Client {
    return &Client{rdb: rdb}
}

// 将现有函数转为 Client 方法：

func (c *Client) GetOrLoad[T any](ctx context.Context, key string, ttl time.Duration, loader func(context.Context) (T, error)) (T, error) {
    // 原来用 RDB.Get / RDB.Set → 改用 c.rdb.Get / c.rdb.Set
}

func (c *Client) Invalidate(ctx context.Context, keys ...string) error {
    return c.rdb.Del(ctx, keys...).Err()
}

func (c *Client) SetRoute(ctx context.Context, userID, deviceType, connID string) error {
    return c.rdb.HSet(ctx, routeKey(userID), deviceType, connID).Err()
}

func (c *Client) GetRoute(ctx context.Context, userID, deviceType string) (string, error) {
    return c.rdb.HGet(ctx, routeKey(userID), deviceType).Result()
}

func (c *Client) IsOnline(ctx context.Context, userID string) (bool, error) { ... }
func (c *Client) DeleteRoute(ctx context.Context, userID, deviceType string) error { ... }
func (c *Client) GetAllRoutes(ctx context.Context, userID string) (map[string]string, error) { ... }
func (c *Client) MarkKicked(ctx context.Context, connID string) error { ... }
func (c *Client) IsKicked(ctx context.Context, connID string) (bool, error) { ... }
func (c *Client) PushPendingTask(ctx context.Context, userID, taskJSON string) error { ... }
func (c *Client) PopPendingTasks(ctx context.Context, userID string) ([]string, error) { ... }
func (c *Client) PendingTaskCount(ctx context.Context, userID string) (int64, error) { ... }
func (c *Client) AllocateSeq(ctx context.Context, sessionID string) (int64, error) { ... }
func (c *Client) InitSeqIfAbsent(ctx context.Context, sessionID string, seq int64) error { ... }
func (c *Client) PeekSeq(ctx context.Context, sessionID string) (int64, error) { ... }

// PoolStats 暴露底层 Redis 连接池状态（供 metrics 使用）。
func (c *Client) PoolStats() *redis.PoolStats {
    return c.rdb.PoolStats()
}
```

**兼容策略**：迁移期间保留原包级函数（deprecated），内部委托给全局 Client 实例：

```go
// Deprecated: 使用 Client 方法代替。将在 P1 完成后删除。
var defaultClient *Client

func SetDefaultClient(c *Client) { defaultClient = c }

func GetOrLoad[T any](ctx context.Context, key string, ttl time.Duration, loader func(context.Context) (T, error)) (T, error) {
    return defaultClient.GetOrLoad(ctx, key, ttl, loader)
}
```

### 2.4 Service 构造函数变更

| Service | 当前构造函数 | 新构造函数 | 新增依赖 |
|---------|------------|-----------|---------|
| `AuthService` | `NewAuthService(db)` | `NewAuthService(db, cache, jwtCfg)` | `*cache.Client`, `*config.JWTConfig` |
| `ContactService` | `NewContactService(db, bus)` | `NewContactService(db, bus, cache)` | `*cache.Client` |
| `SessionService` | `NewSessionService(db)` | `NewSessionService(db, cache)` | `*cache.Client` |
| `MessageService` | `NewMessageService(db, bus)` | `NewMessageService(db, bus, cache)` | `*cache.Client` |
| `AgentService` | `NewAgentService(db, bus, mgr)` | `NewAgentService(db, bus, mgr, cache)` | `*cache.Client` |
| `AttachmentService` | `NewAttachmentService(db)` | `NewAttachmentService(db, uploadCfg)` | `*config.UploadConfig` |

## 3. main.go 重构

### 3.1 当前 main.go 的问题

`main.go`（~460 行）承载了过多职责：

1. 配置加载和初始化
2. HTTP 服务器创建和管理
3. Admin 服务器（pprof + metrics）
4. WebSocket 路由回调（onRouteSet/onRouteDel，~100 行）
5. 事件总线订阅（~8 个事件处理器，~60 行）
6. 后台 goroutine（seq 同步、超时扫描、metrics 采集）
7. 服务组装

### 3.2 瘦身后的 main.go

```go
// hub-server/cmd/server-hub/main.go
package main

import (
    "context"
    "log/slog"
    "os"
    "os/signal"
    "syscall"
    "time"

    "github.com/agenthub/hub-server/internal/app"
    "github.com/agenthub/hub-server/internal/config"
    "github.com/agenthub/hub-server/internal/log"
)

func main() {
    // 1. 加载配置
    cfg, err := config.Load("configs/config.yaml")
    if err != nil {
        slog.Error("failed to load config", "error", err)
        os.Exit(1)
    }

    // 2. 初始化日志
    log.Init(&cfg.Server)
    defer log.Sync()

    // 3. 构建 App（DI 容器完成所有初始化、路由、后台任务）
    application, err := app.New(cfg)
    if err != nil {
        slog.Error("failed to initialize app", "error", err)
        os.Exit(1)
    }

    // 4. 启动服务器
    srv := application.Start()

    // 5. 等待信号
    quit := make(chan os.Signal, 1)
    signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
    <-quit

    // 6. 优雅关闭
    slog.Info("shutting down...")
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    if err := application.Shutdown(ctx); err != nil {
        slog.Error("shutdown failed", "error", err)
    }
    slog.Info("servers exited")
}
```

### 3.3 移至 App 的内部逻辑

以下逻辑从 `main.go` 移至 `app.App` 的方法：

| 原位置 | 新位置 | 说明 |
|--------|-------|------|
| `main.go:70-86` (seq sync goroutine) | `App.syncLegacySeqs()` | 注册为 shutdown 回调 |
| `main.go:88-108` (ws manager 回调) | `App.setupWSManager()` | mgr.OnRouteSet/Del |
| `main.go:109-126` (ws handler typing) | `App.setupWSManager()` | typing handler |
| `main.go:152-251` (event bus 订阅) | `App.subscribeEvents()` | 8 个事件处理器 |
| `main.go:265-291` (timeout scanner) | `App.startTimeoutScanner()` | 注册为 shutdown 回调 |
| `main.go:293-341` (prometheus + admin) | `App.startAdminServer()` | admin HTTP server |
| `main.go:295-296` (metrics.Register) | `App` 构造函数 | 初始化阶段 |
| `main.go:329-341` (metrics goroutine) | `App.startMetricsCollector()` | 注册为 shutdown 回调 |
| `main.go:343-345` (router setup) | `App.setupRouter()` | HTTP handler |
| `main.go:347-363` (http server) | `App.Start()` | 返回 `*http.Server` |
| `main.go:383-452` (route callbacks) | `App` 内部方法 | `onRouteSet` / `onRouteDel` 等 |

## 4. 迁移路径

### 4.1 增量迁移可行

增量迁移是可行的。当前服务层已经通过构造函数接收 `*gorm.DB`，这是一个很好的起点。可以分 5 个阶段执行。

### 4.2 Phase 1: Cache Client 封装（P1-2 前置）

**目标**：消除 `cache.RDB` 全局变量，不影响现有调用者。

1. 新建 `hub-server/internal/cache/client.go`：定义 `Client` 结构体和所有方法
2. 保留 `redis.go` 中的 `InitRedis`，但在初始化后设置 `defaultClient`
3. 保留所有原函数签名（deprecated），内部委托给 `defaultClient`
4. 更新 `main.go`：调用 `cache.SetDefaultClient(cache.NewClient(rdb))`
5. **验证**：`go test ./hub-server/internal/cache/...` 和集成测试通过

**影响文件**（~6 个）：
- `hub-server/internal/cache/client.go`（新增）
- `hub-server/internal/cache/redis.go`（添加 SetDefaultClient）
- `hub-server/internal/cache/data.go`（委托 defaultClient）
- `hub-server/internal/cache/route.go`（委托 defaultClient）
- `hub-server/internal/cache/seq.go`（委托 defaultClient）
- `hub-server/cmd/server-hub/main.go`（调用 SetDefaultClient）

### 4.3 Phase 2: Service 层显式注入 Cache（P1-2 核心）

**目标**：Service 不再通过全局访问 cache，改为构造函数注入 `*cache.Client`。

1. 修改 `AuthService` 构造函数：添加 `*cache.Client`, `*config.JWTConfig` 参数
2. 修改 `ContactService` 构造函数：添加 `*cache.Client` 参数
3. 修改 `SessionService` 构造函数：添加 `*cache.Client` 参数
4. 修改 `MessageService` 构造函数：添加 `*cache.Client` 参数
5. 修改 `AgentService` 构造函数：添加 `*cache.Client` 参数
6. 修改 `AttachmentService`：添加 `*config.UploadConfig` 参数替换 `config.Cfg`
7. 更新 `main.go` 和 `tests/setup_test.go` 的构造调用
8. **验证**：`go test ./hub-server/...` 所有测试通过

**影响文件**（~9 个）：
- `hub-server/internal/service/auth.go`
- `hub-server/internal/service/contact.go`
- `hub-server/internal/service/session.go`
- `hub-server/internal/service/message.go`
- `hub-server/internal/service/agent.go`
- `hub-server/internal/service/attachment.go`
- `hub-server/cmd/server-hub/main.go`
- `hub-server/tests/setup_test.go`

### 4.4 Phase 3: Router 消除 config.Cfg（P1-2 完成）

**目标**：`router.go` 不再直接引用 `config.Cfg`。

当前 `router.go` 的 `SetupRoutes` 接收所有 handler 作为参数，但 JWT secret 从全局取。改为：
- `SetupRoutes` 新增 `jwtSecret string` 参数
- 或者创建一个 `RouteDeps` 结构体统一传参

```go
// 方案 A: 简单添加参数
func SetupRoutes(r *gin.Engine, jwtSecret string, handlers...) { ... }

// 方案 B (推荐): RouteDeps 结构体
type RouteDeps struct {
    JWTSecret string
    AuthHandler *handler.AuthHandler
    // ... 其他 handler
}
func SetupRoutes(r *gin.Engine, deps RouteDeps) { ... }
```

**影响文件**：
- `hub-server/internal/router/router.go`
- `hub-server/cmd/server-hub/main.go`
- `hub-server/tests/setup_test.go`

### 4.5 Phase 4: 提取 main.go 内联逻辑（P1-3 核心）

**目标**：`main.go` 不再直接引用 `repository.DB` 和 `cache.RDB`。

这是最大的重构步骤。创建 `hub-server/internal/app/app.go` 承载所有初始化、组装、后台任务。

子步骤：
1. 创建 `app.App` 结构体
2. 迁移初始化逻辑：`initDB`, `initRedis`, `runMigrations`
3. 迁移 WS 回调（`onRouteSet`, `onRouteDel`, `broadcastOnlineStatus`, `pushPendingTasks`）→ `App` 方法
4. 迁移事件总线订阅 → `App.subscribeEvents()`
5. 迁移后台 goroutine（seq sync, timeout scanner, metrics）→ `App` 方法
6. 迁移 HTTP 服务器创建 → `App.Start()` / `App.Shutdown()`
7. 更新 `main.go` 为瘦身版
8. **验证**：完整启动 + `go test -short ./hub-server/...` 通过

**影响文件**（~4 个）：
- `hub-server/internal/app/app.go`（新增）
- `hub-server/internal/app/background.go`（新增，后台任务）
- `hub-server/cmd/server-hub/main.go`（大幅缩减，~40 行）

### 4.6 Phase 5: 清理（P1-3 完成）

**目标**：删除全局变量声明和兼容代码。

1. 删除 `config.Cfg` 全局变量
2. 删除 `repository.DB` 全局变量
3. 删除 `cache.RDB` 全局变量
4. 删除 `cache` 包中的 deprecated 兼容函数
5. 删除 `cache.InitRedis` 中的 `RDB = rdb` 赋值（仅保留 `NewClient`）
6. 删除 `repository.InitDB` 中的 `DB = db` 赋值
7. 将 `repository.InitDB` / `cache.InitRedis` 逻辑移入 `app.App`（或保留为纯工厂函数）
8. **验证**：`go test ./...` 全绿 + 端到端集成测试通过

**影响文件**（~5 个）：
- `hub-server/internal/config/config.go`（删除 `var Cfg`）
- `hub-server/internal/repository/db.go`（删除 `var DB`）
- `hub-server/internal/cache/redis.go`（删除 `var RDB`）
- `hub-server/internal/cache/*.go`（删除 deprecated 函数）

## 5. 测试影响

### 5.1 单元测试简化

**Before**（需要真实 DB + Redis）：

```go
func TestAuthService_Login(t *testing.T) {
    // 必须先初始化全局状态
    config.Load("testdata/config.yaml")  // 设置 config.Cfg
    repository.InitDB(&cfg.DB)            // 设置 repository.DB
    cache.InitRedis(&cfg.Redis)            // 设置 cache.RDB

    // 然后才能测试
    svc := service.NewAuthService(repository.DB)
    // ...
}
```

**After**（纯内存，无全局状态）：

```go
func TestAuthService_Login(t *testing.T) {
    db := setupTestDB(t)                // SQLite 内存或 pgx mock
    cacheClient := cache.NewTestClient() // miniredis 或 mock
    jwtCfg := &config.JWTConfig{
        Secret:     "test-secret",
        AccessTTL:  15 * time.Minute,
        RefreshTTL: 7 * 24 * time.Hour,
    }

    svc := service.NewAuthService(db, cacheClient, jwtCfg)
    resp, err := svc.Login(ctx, "user", "pass", "web", "device-1")
    assert.NoError(t, err)
    assert.NotEmpty(t, resp.AccessToken)
}
```

### 5.2 测试辅助工具

提供测试工厂函数：

```go
// hub-server/internal/app/testapp.go
package app

import (
    "github.com/alicebob/miniredis/v2"
    "gorm.io/driver/sqlite"
    "gorm.io/gorm"
)

// NewTestApp 创建仅用于测试的 App，使用内存 SQLite + miniredis。
func NewTestApp(t *testing.T) *App {
    t.Helper()

    db, _ := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
    runMigrationsOn(db)

    mr := miniredis.RunT(t)
    rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})

    cfg := &config.Config{
        JWT: config.JWTConfig{
            Secret: "test-secret", AccessTTL: time.Hour, RefreshTTL: 24 * time.Hour,
        },
        Upload: config.UploadConfig{MaxSize: 10 << 20},
    }

    return newApp(cfg, db, rdb)
}
```

### 5.3 Mock 接口（可选，P2+）

对于需要 mock 外部依赖的测试，可以提取接口：

```go
// hub-server/internal/cache/interface.go
type Cache interface {
    GetOrLoad(ctx context.Context, key string, ttl time.Duration, loader Loader) (any, error)
    Invalidate(ctx context.Context, keys ...string) error
    GetRoute(ctx context.Context, userID, deviceType string) (string, error)
    IsOnline(ctx context.Context, userID string) (bool, error)
    // ...
}
```

但这增加了接口维护成本。Manual DI 风格建议直接使用具体类型 + 测试辅助（miniredis），避免过早抽象。

## 6. 受影响文件清单

### 6.1 新增文件（3 个）

| 文件 | 说明 |
|------|------|
| `hub-server/internal/app/app.go` | App 结构体 + 构造函数 + Start/Shutdown |
| `hub-server/internal/app/background.go` | 后台任务迁移（seq sync, timeout scanner, metrics 采集, event 订阅） |
| `hub-server/internal/app/testapp.go` | 测试辅助：NewTestApp（内存 DB + miniredis） |
| `hub-server/internal/cache/client.go` | CacheClient 结构体 + 方法定义 |

### 6.2 修改文件（22 个）

#### 核心重构

| 文件 | 变更说明 |
|------|---------|
| `hub-server/cmd/server-hub/main.go` | 瘦身为 ~40 行（仅配置加载 + App 创建 + 信号等待） |
| `hub-server/internal/config/config.go` | Phase 5 删除 `var Cfg` 全局变量；`Load` 不再写入全局 |
| `hub-server/internal/repository/db.go` | Phase 5 删除 `var DB`；`InitDB` 改为返回 `(*gorm.DB, error)` |
| `hub-server/internal/cache/redis.go` | Phase 5 删除 `var RDB`；`InitRedis` 改为返回 `(*redis.Client, error)` |
| `hub-server/internal/router/router.go` | 添加 `jwtSecret` 参数或 `RouteDeps` 结构体 |

#### Service 层

| 文件 | 变更说明 |
|------|---------|
| `hub-server/internal/service/auth.go` | 构造函数添加 `*cache.Client`, `*config.JWTConfig`；移除 `config.Cfg` 引用 |
| `hub-server/internal/service/attachment.go` | 构造函数添加 `*config.UploadConfig`；移除 `config.Cfg` 引用 |
| `hub-server/internal/service/contact.go` | 构造函数添加 `*cache.Client` |
| `hub-server/internal/service/session.go` | 构造函数添加 `*cache.Client` |
| `hub-server/internal/service/message.go` | 构造函数添加 `*cache.Client` |
| `hub-server/internal/service/agent.go` | 构造函数添加 `*cache.Client` |

#### Cache 层

| 文件 | 变更说明 |
|------|---------|
| `hub-server/internal/cache/data.go` | 函数改为 `Client` 方法；保留 deprecated 包装 |
| `hub-server/internal/cache/route.go` | 函数改为 `Client` 方法；保留 deprecated 包装 |
| `hub-server/internal/cache/seq.go` | 函数改为 `Client` 方法；保留 deprecated 包装 |

#### 测试

| 文件 | 变更说明 |
|------|---------|
| `hub-server/tests/setup_test.go` | 使用 `app.NewTestApp` 替代手动组装；移除全局 `repository.DB` 引用 |
| `hub-server/internal/service/eventbus_test.go` | 无变化（Bus 已无全局依赖） |
| `hub-server/internal/config/config_test.go` | 无变化（`Load` 返回指针，测试已用此模式） |

#### Log 层（微调）

| 文件 | 变更说明 |
|------|---------|
| `hub-server/internal/log/log.go` | 当前内部有 `var logger`，但外部不访问，保持不变 |

## 7. 风险评估

### 7.1 高风险点

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| `main.go` 内联逻辑移入 `App` 时遗漏行为 | 功能回归 | 逐块迁移，每块迁移后运行集成测试；对比迁移前后 HTTP 响应 |
| Cache Client 方法签名变化导致编译错误 | 大面积编译失败 | Phase 1 使用 deprecated 包装保留旧签名，所有调用点编译通过后再清理 |
| 测试初始化改变导致 CI 失败 | 无法合并 | 每个 Phase 完成后运行 `go test -short ./...` 和集成测试 |
| `onRouteSet/Del` 迁移后 conn 生命周期问题 | WebSocket 连接异常 | 保持原有函数逻辑不变，仅移动位置到 `App` 方法 |
| 后台 goroutine 生命周期管理 | goroutine 泄漏或提前退出 | 使用 `App.shutdowns` 注册所有 goroutine 的 cancel；Shutdown 时按注册逆序关闭 |

### 7.2 验证策略

每个 Phase 完成后的验证命令：

```powershell
# Phase 1-2: 编译器检查
go build ./hub-server/...

# Phase 1-5: 单元测试 + 短测试
go test -short ./hub-server/...

# Phase 4-5: 完整集成测试（需要 PostgreSQL + Redis）
go test ./hub-server/tests/...

# Phase 5: 编译检查 + 全量测试
go test ./hub-server/...
```

### 7.3 回滚策略

- 每个 Phase 作为独立 commit，出现问题时可以 revert 单个 commit
- Phase 1-2 的 deprecated 包装意味着旧调用路径仍可用，可以随时回到旧路径
- Phase 4 是最大变更，建议在独立 PR 中提交，review 通过后再合入 dev

## 8. 时间估算

| Phase | 内容 | 工时 | 风险 |
|-------|------|------|------|
| 1 | Cache Client 封装 | 0.5d | 低 |
| 2 | Service 显式注入 Cache + Config | 1d | 低 |
| 3 | Router 消除 config.Cfg | 0.5d | 低 |
| 4 | 提取 main.go 到 App | 1.5d | 中 |
| 5 | 清理全局变量 + deprecated 代码 | 0.5d | 低 |
| **总计** | | **4d** | |

与 roadmap 中的估算（P1-2: 2d + P1-3: 1d = 3d）相比多估了 1 天，主要是 Phase 4 将 main.go 内联逻辑提取到 App 的工作量。

## 9. 设计决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| DI 框架 | Manual DI | Go 社区主流做法；当前代码已半手动注入；零运行时开销；与 Wire 兼容 |
| Cache 抽象层 | 具体类型 `*cache.Client` 而非接口 | 避免过早抽象；测试用 miniredis 替代；P2+ 如有需要再提取接口 |
| Config 传递粒度 | 传递子配置（`*JWTConfig`, `*UploadConfig`）而非完整 `*Config` | 遵循接口隔离：Service 不依赖不需要的配置字段 |
| 全局变量删除时机 | Phase 5（最后一步） | 确保所有调用点先迁移完成，避免中间状态编译失败 |
| 兼容策略 | Deprecated 函数委托 | 允许增量迁移，降低每次 commit 的风险 |
