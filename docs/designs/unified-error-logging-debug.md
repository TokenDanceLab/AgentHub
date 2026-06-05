# 统一错误码、日志与调试系统设计

日期：2026-06-05
状态：实施中

---

## 1. 目标

1. Edge Server 和 Hub Server 返回**完全相同的 JSON 错误格式**，前端只需一套错误处理逻辑
2. 每个错误自动携带 traceId，可通过 X-Request-ID 串联完整请求链路
3. 结构化日志统一字段命名，支持按 traceId/requestId 检索
4. 生产可用的调试端点：健康检查、性能分析、脱敏配置转储

---

## 2. 模块架构

```
AgentHub/
├── pkg/                              # 共享 Go 模块 (github.com/agenthub/pkg)
│   ├── go.mod                        # module github.com/agenthub/pkg
│   ├── errcode/                      # 错误类型 + envelope + 常用 codes
│   │   ├── error.go                  # Error struct, New, With*, WriteError, WriteJSON
│   │   ├── codes.go                  # 通用错误码 (INTERNAL_ERROR, NOT_FOUND...)
│   │   └── errcode_test.go
│   ├── reqlog/                       # 请求日志 + 追踪中间件
│   │   ├── trace.go                  # TraceID/NewRequestID/context 注入/提取
│   │   ├── nethttp.go                # net/http 中间件 (Edge 用)
│   │   ├── gin.go                    # Gin 中间件 (Hub 用)
│   │   └── reqlog_test.go
│   └── debug/                        # 调试端点
│       ├── debug.go                  # 注册 health/pprof/config 路由
│       └── debug_test.go
├── go.work                           # use ./pkg ./edge-server ./hub-server
├── edge-server/
│   └── internal/
│       └── errcode/                  # Edge 域错误码
│           └── codes.go              # EXECUTOR_UNAVAILABLE 等域代码
└── hub-server/
    └── internal/
        └── errcode/                  # Hub 域错误码
            └── codes.go              # MSG_NOT_FOUND, SESSION_NOT_FOUND 等域代码
```

### 为什么用 Go workspace

Edge 和 Hub 是独立 Go module（`github.com/agenthub/edge-server` / `hub-server`）。共享类型必须放在第三个 module 中。`go.work` 让三者互引无需 publish 到外部 registry，CI 也原生支持。

### 为什么不删各 server 的 internal/errcode

Hub 有 50+ 文件引用 `errcode.XXX`。用 type alias 保持零改动：

```go
// hub-server/internal/errcode/codes.go
package errcode

import (
    sharederr "github.com/agenthub/pkg/errcode"
)

type Error = sharederr.Error            // 零改动所有 *errcode.Error 引用

var (
    ErrBadRequest = sharederr.ErrBadRequest
    ErrInternal   = sharederr.ErrInternal
    // ... 域代码:
    MsgNotFound    = sharederr.New("MSG_NOT_FOUND", "message not found", 404)
)
```

---

## 3. 统一 JSON Envelope

### 成功响应

Edge 和 Hub 都沿用现有成功格式，不变：

```json
{"code": "OK", "data": {...}}
```

```json
[{"id": "...", ...}]
```

### 错误响应（统一）

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "session not found",
    "traceId": "trace_000142"
  }
}
```

规则：
- `code`：SCREAMING_SNAKE_CASE，全部大写+下划线
- `message`：人类可读描述，不含内部路径或密钥
- `traceId`：每个错误自动附加，可通过 X-Request-ID 头串联请求链路
- 外层包 `error` wrapper，前端 `if (response.error)` 即可判断

### 与现有格式对比

| | 旧 Edge | 旧 Hub | 新统一 |
|---|---|---|---|
| Envelope | `{"error":{"code":"not_found",...}}` | `{"code":"NOT_FOUND","message":"..."}` | `{"error":{"code":"NOT_FOUND",...}}` |
| Code 风格 | lowercase | SCREAMING_CASE | SCREAMING_CASE |
| traceId | 有 | 无 | 有 |
| 外层 wrapper | 有 | 无 | 有 |

Hub 改动：成功响应保持 `{"code":"OK","data":...}`，错误响应改为 `{"error":{...}}`。

---

## 4. 错误码分级

### 4.1 通用码（pkg/errcode/codes.go）

| Code | HTTP | 语义 |
|------|------|------|
| INTERNAL_ERROR | 500 | 未知服务端错误 |
| BAD_REQUEST | 400 | 请求参数无效 |
| NOT_FOUND | 404 | 资源不存在 |
| METHOD_NOT_ALLOWED | 405 | HTTP 方法不支持 |
| REQUEST_TIMEOUT | 504 | 请求超时 |
| NOT_IMPLEMENTED | 501 | 端点未实现 |
| TOO_MANY_REQUESTS | 429 | 限流 |
| UNAUTHORIZED | 401 | 需要认证 |
| FORBIDDEN | 403 | 权限不足 |
| INVALID_TOKEN | 401 | Token 无效或过期 |
| TOKEN_EXPIRED | 401 | Token 已过期 |
| INVALID_JSON | 400 | JSON 解析失败 |
| VALIDATION_ERROR | 400 | 字段校验失败 |
| CONTENT_REQUIRED | 400 | 内容字段缺失 |
| PAYLOAD_TOO_LARGE | 413 | 请求体过大 |
| CONFLICT | 409 | 资源冲突 |
| ALREADY_EXISTS | 409 | 资源已存在 |

### 4.2 Edge 域码（edge-server/internal/errcode/codes.go）

| Code | HTTP | 语义 |
|------|------|------|
| EXECUTOR_UNAVAILABLE | 503 | 无 Agent Runtime 执行器 |
| EXECUTOR_START_FAILED | 500 | Run 启动失败 |
| WORKSPACE_NOT_ALLOWED | 403 | 工作目录不在白名单 |
| INVALID_PERMISSION_MODE | 400 | 权限模式参数无效 |
| INVALID_AGENT_ID | 400 | Agent 适配器 ID 无效 |
| TOO_MANY_CONCURRENT_RUNS | 429 | 并发 Run 数达上限 |
| ACTIVE_RUN_EXISTS | 409 | Thread 已有活跃 Run |
| PERMISSION_REQUEST_NOT_FOUND | 404 | 权限请求不存在 |
| METRICS_NOT_CONFIGURED | 503 | Metrics 未配置 |
| AGENT_NOT_REGISTERED | 404 | Agent 实例未注册 |

### 4.3 Hub 域码（hub-server/internal/errcode/codes.go）

沿用现有域码，仅改 import 来源：

MSG_NOT_FOUND, SESSION_NOT_FOUND, AGENT_OFFLINE, FRIEND_ALREADY, OIDC_* 等 — 全部保留，改为 `sharederr.New(...)` 构造。

### 4.4 命名规范

- `{DOMAIN}_{ENTITY}_{EVENT}` 三段式
- 例：`AGENT_TASK_TIMEOUT`、`SESSION_NOT_MEMBER`、`MSG_RECALL_TIMEOUT`
- HTTP 语义由 Error.HTTPStatus 决定，code 不含 HTTP 状态信息

---

## 5. 请求追踪与日志

### 5.1 模块接口设计

`pkg/reqlog` 提供两套中间件适配器：

```go
// pkg/reqlog/trace.go — 共享逻辑

// 关键 context key 类型，不可导出以避免外部包直接读写。
type traceIDKey struct{}
type requestIDKey struct{}

// NewRequestID 生成 request_ 前缀 UUIDv7（请求级别唯一）。
func NewRequestID() string

// NewTraceID 生成 trace_ 前缀递增 ID（错误级别唯一，短且有序）。
func NewTraceID() string

// GetRequestID 从 context 提取 X-Request-ID。
func GetRequestID(ctx context.Context) string

// GetTraceID 从 context 提取当前 trace ID。
func GetTraceID(ctx context.Context) string

// WithRequestID 将 request ID 注入 context。
func WithRequestID(ctx context.Context, id string) context.Context
```

```go
// pkg/reqlog/nethttp.go — net/http 中间件（Edge 用）
// 签名: func AccessLog(next http.Handler) http.Handler
// 行为:
//   1. 从请求头提取 X-Request-ID，无则调用 NewRequestID() 生成
//   2. 注入 context: ctx = WithRequestID(ctx, requestID)
//   3. 设置响应头 X-Request-ID
//   4. 记录: request_id, method, path, status, duration_ms, client_ip
//   5. 字段名统一: request_id（不是 requestId 或 reqID）
```

```go
// pkg/reqlog/gin.go — Gin 中间件（Hub 用）
// 签名: func AccessLog() gin.HandlerFunc
// 行为: 同 nethttp 版，但适配 gin.Context
```

### 5.2 Trace ID 传播

```
客户端 → [X-Request-ID: req_xxx] → Edge/Hub 中间件
                                      ↓ 注入 context
                                   handler 读取
                                      ↓ 写入错误
                                   WriteErrorWithTrace(w, err, traceID)
```

- 如果请求带 `X-Request-ID` 头，复用（支持分布式链路串联）
- 否则生成 `req_` 前缀 UUIDv7
- 错误响应的 `traceId` 字段使用 `trace_` 前缀自增 ID（短且有序）

### 5.2 日志字段规范

每条请求日志必须包含：

```go
slog.Info("access",
    "request_id", reqID,        // X-Request-ID
    "method",     "POST",
    "path",       "/api/sessions",
    "status",     200,
    "duration_ms", 12,
    "client_ip",  "127.0.0.1",
)
```

错误日志额外包含：

```go
slog.Error("request_error",
    "request_id", reqID,
    "error_code", "NOT_FOUND",
    "message",    "session not found",
)
```

### 5.3 Edge→Hub 跨服务追踪

Edge 调用 Hub API 时，将当前请求的 X-Request-ID 通过 `X-Request-ID` 头传递给 Hub。Hub 的 RequestID 中间件检测到已有值时直接复用。这样一次前端请求在 Edge 和 Hub 的日志中有相同的 request_id。

---

## 6. 调试端点

### 6.1 模块接口设计

```go
// pkg/debug/debug.go

// Config 暴露脱敏后的配置快照。
type ConfigProvider func() map[string]any

// Handler 注册调试路由到 http.ServeMux（Edge）或 gin.Engine（Hub）。
// prefix 为路由前缀，如 "/debug"。auth 为 nil 时 health/ready 公开，其余需要认证。
type Handler struct {
    Health  HealthChecker
    Config  ConfigProvider
    Auth    func(r *http.Request) bool
}

// HealthChecker 执行各依赖的健康检查。
type HealthChecker struct {
    Checks map[string]func(context.Context) error
}

// Check 运行所有健康检查，返回 {"status":"ok"} 或 {"status":"degraded","checks":{...}}。
func (h *HealthChecker) Check(ctx context.Context) *HealthResult

// Register 注册全部子路由。
// 路由: <prefix>/health, <prefix>/ready, <prefix>/pprof/, <prefix>/vars, <prefix>/config
func (h *Handler) Register(mux *http.ServeMux, prefix string)
```

### 6.2 路由

两个服务器都注册以下路由（需要管理员认证）：

| 路径 | 功能 |
|------|------|
| `/debug/health` | 健康检查（返回 `{"status":"ok"}` 或 `{"status":"degraded","checks":{...}}`） |
| `/debug/ready` | 就绪检查（DB/Redis 连通性） |
| `/debug/pprof/` | Go pprof 性能分析 |
| `/debug/vars` | expvar 运行时变量 |
| `/debug/config` | 脱敏配置转储（隐藏 secret/password/token 字段） |

### 6.2 健康检查格式

```json
{
  "status": "ok",
  "version": "v0.1.0-dev",
  "uptime_seconds": 3600,
  "checks": {
    "database": "ok",
    "redis": "ok"
  }
}
```

Hub Server 的 health 检查 DB + Redis 连通性；Edge Server 检查本地 store 和 event bus。

### 6.3 安全

- `/debug/health` 和 `/debug/ready` 不需要认证（K8s liveness/readiness probe）
- `/debug/pprof`、`/debug/vars`、`/debug/config` 需要管理员认证
- Edge：通过 local auth middleware 保护
- Hub：通过 RequireAdmin 中间件保护

---

## 7. Hub Server 迁移

### 7.1 envelope 变更

Hub 错误响应从 `{"code":"...","message":"..."}` 改为 `{"error":{"code":"...","message":"...","traceId":"..."}}`。

**影响面**：Hub 的 `handler/response.go` 的 `Fail()` 和 `middleware/response.go` 的 `fail()` 是唯二写错误响应的位置。改这两处即可。

**前端适配**：Desktop 前端需要从 `response.code` 改为 `response.error.code`。这是一个 breaking change，需要同步更新前端 error handler。

### 7.2 errcode 包迁移

```go
// hub-server/internal/errcode/codes.go — 改造后
package errcode

import (
    "net/http"
    sharederr "github.com/agenthub/pkg/errcode"
)

type Error = sharederr.Error

func New(code, message string, httpStatus int) *Error {
    return sharederr.New(code, message, httpStatus)
}

// 通用码 re-export
var (
    OK              = &Error{Code: "OK", Message: "", HTTPStatus: http.StatusOK}
    ErrInternal     = sharederr.ErrInternal
    ErrBadRequest   = sharederr.ErrBadRequest
    ErrTimeout      = sharederr.ErrTimeout
    ErrNotImplemented = sharederr.ErrNotImplemented
)

// Hub 域码 — 不变
var (
    MsgNotFound      = New("MSG_NOT_FOUND", "message not found", http.StatusNotFound)
    SessionNotFound  = New("SESSION_NOT_FOUND", "session not found", http.StatusNotFound)
    // ...
)
```

所有现有 handler/service/middleware 代码的 `errcode.XXX` 引用保持不变。

---

## 8. Edge Server 迁移

### 8.1 新增 internal/errcode/codes.go

```go
package errcode

import (
    "net/http"
    sharederr "github.com/agenthub/pkg/errcode"
)

type Error = sharederr.Error

var (
    ErrBadRequest      = sharederr.ErrBadRequest
    ErrNotFound        = sharederr.ErrNotFound
    ErrMethodNotAllowed = sharederr.ErrMethodNotAllowed
    ErrInternal        = sharederr.ErrInternal
    ErrInvalidJSON     = sharederr.ErrInvalidJSON

    // Edge 域码
    ErrExecutorUnavailable      = sharederr.New("EXECUTOR_UNAVAILABLE", "no agent runtime executor configured", http.StatusServiceUnavailable)
    ErrExecutorStartFailed      = sharederr.New("EXECUTOR_START_FAILED", "failed to start run executor", http.StatusInternalServerError)
    ErrWorkspaceNotAllowed      = sharederr.New("WORKSPACE_NOT_ALLOWED", "workspace path not in allowlist", http.StatusForbidden)
    ErrInvalidPermissionMode    = sharederr.New("INVALID_PERMISSION_MODE", "invalid permission mode", http.StatusBadRequest)
    ErrInvalidAgentID           = sharederr.New("INVALID_AGENT_ID", "unknown agent adapter", http.StatusBadRequest)
    ErrTooManyConcurrentRuns    = sharederr.New("TOO_MANY_CONCURRENT_RUNS", "too many concurrent runs", http.StatusTooManyRequests)
    ErrActiveRunExists          = sharederr.New("ACTIVE_RUN_EXISTS", "thread already has an active run", http.StatusConflict)
    ErrPermissionRequestNotFound = sharederr.New("PERMISSION_REQUEST_NOT_FOUND", "permission request not found", http.StatusNotFound)
    ErrMetricsNotConfigured     = sharederr.New("METRICS_NOT_CONFIGURED", "metrics not configured", http.StatusServiceUnavailable)
    ErrAgentNotRegistered       = sharederr.New("AGENT_NOT_REGISTERED", "agent registry not configured", http.StatusNotFound)
)
```

### 8.2 handlers.go 重构

删除 `errorResponse()` 函数和 `genID()` 函数。

每个 `errorResponse(code, msg)` 调用替换为：

```go
// 旧:
writeJSON(w, http.StatusNotFound, errorResponse("not_found", msgProjectNotFound))

// 新:
errcode.WriteErrorWithTrace(w, errcode.ErrNotFound.WithMessage(msgProjectNotFound), traceID)
```

其中 `traceID` 从请求 context 中获取（由 reqlog 中间件注入）。

---

## 9. 实施顺序

| 阶段 | 内容 | 状态 |
|------|------|:----:|
| 1 | pkg/errcode 共享模块 | ✅ |
| 2 | go.work workspace | ✅ |
| 3 | Hub errcode re-export | ✅ |
| 4 | Hub envelope + traceId | ✅ |
| 5 | Edge errcode 包（14 域错误码） | ✅ |
| 6 | Edge handlers 迁移（52 调用点） | ✅ |
| 7 | pkg/reqlog 追踪中间件 | ✅ |
| 8 | Edge/Hub 接入 reqlog | ✅ |
| 9 | pkg/debug 调试端点 | 🔧 |
| 10 | 两边接入 debug | — |
| 11 | 前端适配 envelope 变更 | ✅ 已兼容 |
| 12 | 测试 + commit | 持续 |

---

## 10. 验收标准

- [ ] `go test ./pkg/... -short` 全绿
- [ ] `go test ./edge-server/... -short` 全绿
- [ ] `go test ./hub-server/... -short` 全绿
- [ ] Edge 返回 `{"error":{"code":"NOT_FOUND",...,"traceId":"trace_xxx"}}`
- [ ] Hub 返回 `{"error":{"code":"MSG_NOT_FOUND",...,"traceId":"trace_xxx"}}`
- [ ] 两边 access log 都有 request_id 和 duration_ms 字段
- [ ] `/debug/health` 返回 `{"status":"ok"}`
- [ ] `/debug/pprof/` 可用
- [ ] Hub→Edge 错误码可按文档中的完整列表查询
