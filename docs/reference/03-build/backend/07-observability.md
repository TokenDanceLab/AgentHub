# AgentHub Observability -- 监控与可观测性方案

> 日期：2026-05-21
> 基于：opcode.md, claude-code-viewer.md, design-go-services.md, design-eventstore-memory.md, design-protocol.md
> 包路径：`packages/observability/`

---

## 1. 日志策略

### 1.1 slog 结构化日志最佳实践

AgentHub 使用 Go 1.24 stdlib `log/slog`，零依赖。参考 design-go-services.md 的决策。

**初始化模式**：

```go
// packages/observability/logger.go
package observability

import (
    "log/slog"
    "os"
)

// NewLogger 创建结构化 logger。
// format: "json"（生产）或 "text"（本地开发）
// level: "debug" | "info" | "warn" | "error"
func NewLogger(format string, level slog.Level, attrs ...slog.Attr) *slog.Logger {
    opts := &slog.HandlerOptions{
        Level:     level,
        AddSource: level <= slog.LevelDebug, // DEBUG 时附带源文件行号
    }
    var h slog.Handler
    switch format {
    case "json":
        h = slog.NewJSONHandler(os.Stderr, opts)
    default:
        h = slog.NewTextHandler(os.Stderr, opts)
    }
    logger := slog.New(h)
    if len(attrs) > 0 {
        logger = logger.With(attrs...)
    }
    return logger
}
```

**约定**：
- 所有 key 使用 `snake_case`
- 错误字段固定使用 `"error"` 作为 key
- 耗时字段固定使用 `"duration_ms"`（毫秒整数）
- 不把敏感信息（token/key/password）写入日志
- `slog.Info` 只记录关键状态变更，不记录高频轮询

### 1.2 日志级别

| 级别 | 环境 | 用途 | 示例 |
|------|------|------|------|
| `DEBUG` | 本地开发 | 详细执行流、变量值、请求/响应体 | `slog.Debug("tool dispatch", "tool", "Bash", "input", input)` |
| `INFO` | 生产 | 关键状态变更、启动/关闭、Run 生命周期 | `slog.Info("run started", "run_id", id, "agent", "claude-code")` |
| `WARN` | 生产 | 可恢复错误、降级、超时重试 | `slog.Warn("hub unreachable, operating offline", "error", err)` |
| `ERROR` | 生产 | 不可恢复错误、数据损坏、进程即将退出 | `slog.Error("eventstore write failed", "error", err, "seq", seq)` |

**生产环境必须设为 `INFO`**，通过环境变量 `LOG_LEVEL=info` 控制。

### 1.3 日志格式

**生产 JSON**：
```json
{"time":"2026-05-21T10:00:00.000Z","level":"INFO","msg":"run started","run_id":"abc123","agent":"claude-code","model":"claude-sonnet-4-6","service":"runner","edge_id":"us1"}
```

**本地 Text**：
```
2026-05-21T10:00:00.000+08:00 INFO run started run_id=abc123 agent=claude-code model=claude-sonnet-4-6
```

**切换逻辑**：
- 本地开发（`go run`）：默认 `text` + `DEBUG`
- 生产部署：默认 `json` + `INFO`
- 通过 `LOG_FORMAT` 和 `LOG_LEVEL` 环境变量覆盖

### 1.4 各服务日志输出规范

#### Hub

```go
// hub/server.go 中的 logger 初始化
hubLogger := observability.NewLogger(cfg.LogFormat, cfg.LogLevel,
    slog.String("service", "hub"),
    slog.String("hostname", hostname),
)
```

**Hub 关键日志点**：
| 事件 | 级别 | 字段 |
|------|------|------|
| Hub 启动 | INFO | `addr`, `db_path` |
| Hub 优雅关闭 | INFO | `reason`, `active_edges` |
| Edge 注册 | INFO | `edge_id`, `device_name`, `os` |
| Edge 断连 | WARN | `edge_id`, `reason`, `last_seen_ago` |
| WebSocket 房间创建 | DEBUG | `room_id`, `room_type` |
| 同步事件接收 | DEBUG | `edge_id`, `event_type`, `seq` |
| 认证失败 | WARN | `remote_addr`, `reason` |
| DB 迁移 | INFO | `version`, `file` |
| 数据库错误 | ERROR | `query`, `error` |

#### Edge

```go
edgeLogger := observability.NewLogger(cfg.LogFormat, cfg.LogLevel,
    slog.String("service", "edge"),
    slog.String("edge_id", cfg.EdgeID),
)
```

**Edge 关键日志点**：
| 事件 | 级别 | 字段 |
|------|------|------|
| Edge 启动 | INFO | `addr`, `hub_url` |
| Hub 连接成功 | INFO | `hub_id` |
| Hub 连接断开 | WARN | `reason`, `retry_in_ms` |
| Runner 注册 | INFO | `runner_id`, `agent_type` |
| Run 分配 | INFO | `run_id`, `conversation_id`, `agent_id` |
| 本地 API 请求 | DEBUG | `method`, `path`, `status` |
| 同步推送 | DEBUG | `event_type`, `seq`, `batch_size` |
| 上下文构建 | DEBUG | `thread_id`, `token_count`, `truncated` |
| 审批请求 | INFO | `approval_id`, `tool_name`, `risk_level` |

#### Runner

```go
runnerLogger := observability.NewLogger(cfg.LogFormat, cfg.LogLevel,
    slog.String("service", "runner"),
    slog.String("runner_id", cfg.RunnerID),
)
```

**Runner 关键日志点**：
| 事件 | 级别 | 字段 |
|------|------|------|
| Runner 启动 | INFO | `addr`, `agent_type` |
| Agent 子进程启动 | INFO | `run_id`, `session_id`, `agent`, `pid` |
| Agent 子进程退出 | INFO | `run_id`, `exit_code`, `duration_ms` |
| Tool 执行 | DEBUG | `run_id`, `tool_name`, `tool_call_id` |
| Tool 被拒绝 | WARN | `run_id`, `tool_name`, `reason` |
| 权限请求 | DEBUG | `run_id`, `tool_name`, `risk_level` |
| 上下文压缩 | INFO | `run_id`, `before_tokens`, `after_tokens` |
| Workspace 创建 | DEBUG | `workspace_id`, `provider` |
| Checkpoint 创建 | DEBUG | `checkpoint_id`, `turn_id`, `file_count` |
| Checkpoint 恢复 | INFO | `checkpoint_id`, `target_turn` |
| 子进程强制终止 | WARN | `run_id`, `pid`, `reason` |
| Execute 超时 | ERROR | `run_id`, `max_duration_ms` |

### 1.5 slog 分组与子 logger

```go
// 从 service logger 派生领域 logger，自动继承 service/hostname 属性
func (s *Server) runLogger(runID, agentID string) *slog.Logger {
    return s.logger.With(
        slog.String("run_id", runID),
        slog.String("agent_id", agentID),
    )
}

// 使用时
s.runLogger(runID, "claude-code").Info("tool executed",
    "tool", "Bash",
    "duration_ms", elapsed,
)
```

### 1.6 敏感信息防护

```go
// packages/observability/sanitize.go

// SanitizeForLog 移除敏感字段，返回安全日志用的 map
func SanitizeForLog(m map[string]any) map[string]any {
    sanitized := make(map[string]any, len(m))
    sensitiveKeys := map[string]bool{
        "api_key": true, "api_key_env_var": true,
        "token": true, "password": true, "secret": true,
        "credentials": true, "authorization": true,
        "ssh_key": true, "private_key": true,
    }
    for k, v := range m {
        if sensitiveKeys[k] {
            sanitized[k] = "[REDACTED]"
        } else {
            sanitized[k] = v
        }
    }
    return sanitized
}
```

---

## 2. 指标采集

### 2.1 指标类型与命名约定

| 类型 | 命名模式 | 示例 |
|------|---------|------|
| Counter | `{domain}_total` | `runs_completed_total` |
| Gauge | `{domain}_current` | `runs_active_current` |
| Histogram | `{domain}_duration_ms` | `run_duration_ms` |
| Summary | `{domain}_distribution` | `token_usage_distribution` |

所有指标带 label: `service`, `edge_id`（Edge/Runner）, `agent_id`（Runner）。

### 2.2 AgentRun 生命周期指标

参考 design-protocol.md 中的 `RunStatus` 状态机：
```
starting → running → {done | failed | cancelled}
                  → waiting_approval → running
                  → draining → done
```

```go
// packages/observability/metrics.go

// RunMetrics 追踪 AgentRun 生命周期指标
type RunMetrics struct {
    // Counters
    RunsStartedTotal    atomic.Int64  // 启动次数
    RunsCompletedTotal  atomic.Int64  // done 次数
    RunsFailedTotal     atomic.Int64  // failed 次数
    RunsCancelledTotal  atomic.Int64  // cancelled 次数

    // Gauges
    RunsActive          atomic.Int64  // 当前 running 数

    // Timing (毫秒)
    RunDurationHist     *Histogram    // 总执行时间分布
    QueueLatencyHist    *Histogram    // starting → running 排队延迟

    // Failure breakdown
    FailureReasons      sync.Map      // reason → count
}

func (m *RunMetrics) RecordStart() {
    m.RunsStartedTotal.Add(1)
    m.RunsActive.Add(1)
}

func (m *RunMetrics) RecordComplete(durationMs int64) {
    m.RunsCompletedTotal.Add(1)
    m.RunsActive.Add(-1)
    m.RunDurationHist.Record(durationMs)
}

func (m *RunMetrics) RecordFailure(reason string, durationMs int64) {
    m.RunsFailedTotal.Add(1)
    m.RunsActive.Add(-1)
    m.RunDurationHist.Record(durationMs)
    // reason 分类
    val, _ := m.FailureReasons.LoadOrStore(reason, new(atomic.Int64))
    val.(*atomic.Int64).Add(1)
}

func (m *RunMetrics) Snapshot() RunMetricsSnapshot {
    reasons := make(map[string]int64)
    m.FailureReasons.Range(func(k, v any) bool {
        reasons[k.(string)] = v.(*atomic.Int64).Load()
        return true
    })
    return RunMetricsSnapshot{
        RunsStarted:   m.RunsStartedTotal.Load(),
        RunsCompleted: m.RunsCompletedTotal.Load(),
        RunsFailed:    m.RunsFailedTotal.Load(),
        RunsCancelled: m.RunsCancelledTotal.Load(),
        RunsActive:    m.RunsActive.Load(),
        DurationP50:   m.RunDurationHist.Percentile(0.5),
        DurationP95:   m.RunDurationHist.Percentile(0.95),
        DurationP99:   m.RunDurationHist.Percentile(0.99),
        FailureReasons: reasons,
    }
}
```

**失败原因分类**（对齐 design-protocol.md ResultSubtype）：
- `error_during_execution` — Agent 执行异常
- `error_max_turns` — 超过最大轮数
- `error_max_budget_usd` — 超过预算
- `error_max_structured_output_retries` — 结构化输出重试耗尽
- `cancelled_by_user` — 用户取消
- `cancelled_timeout` — 超时取消
- `cancelled_edge_disconnected` — Edge 断连
- `process_crash` — 子进程崩溃
- `permission_denied` — 权限拒绝

### 2.3 模型调用指标

参考 design-protocol.md 的 `UsageInfo` 和 `CostInfo`：

```go
// ModelMetrics 追踪模型调用指标
type ModelMetrics struct {
    // Token usage (累计)
    InputTokensTotal         atomic.Int64
    OutputTokensTotal        atomic.Int64
    CacheReadTokensTotal     atomic.Int64
    CacheCreationTokensTotal atomic.Int64
    ReasoningTokensTotal     atomic.Int64

    // Cost (USD * 10000，整数存储避免浮点)
    TotalCostMicroUSD        atomic.Int64

    // Latency
    APILatencyHist           *Histogram // API 调用延迟

    // Per-model breakdown
    PerModel                 sync.Map   // modelName → *ModelStats
}

type ModelStats struct {
    Calls         atomic.Int64
    InputTokens   atomic.Int64
    OutputTokens  atomic.Int64
    CostMicroUSD  atomic.Int64
    Errors        atomic.Int64
}

func (m *ModelMetrics) RecordUsage(model string, usage *protocol.UsageInfo, costUSD float64, latencyMs int64) {
    m.InputTokensTotal.Add(usage.InputTokens)
    m.OutputTokensTotal.Add(usage.OutputTokens)
    m.CacheReadTokensTotal.Add(usage.CacheReadTokens)
    m.CacheCreationTokensTotal.Add(usage.CacheCreationTokens)
    m.ReasoningTokensTotal.Add(usage.ReasoningTokens)
    m.TotalCostMicroUSD.Add(int64(costUSD * 1_000_000))
    m.APILatencyHist.Record(latencyMs)

    // Per-model
    stats := m.getOrCreateModelStats(model)
    stats.Calls.Add(1)
    stats.InputTokens.Add(usage.InputTokens)
    stats.OutputTokens.Add(usage.OutputTokens)
    stats.CostMicroUSD.Add(int64(costUSD * 1_000_000))
}
```

### 2.4 系统指标

```go
// SystemMetrics 采集运行时系统指标
type SystemMetrics struct {
    // Go runtime
    Goroutines   atomic.Int64
    HeapAllocMB  atomic.Int64
    HeapInUseMB  atomic.Int64
    NumGC        atomic.Int64

    // Process
    CPUPercent   atomic.Int64  // * 100 (如 45.2% = 4520)
    RSSMB        atomic.Int64

    // WebSocket
    WSConnections   atomic.Int64
    WSMessageSent   atomic.Int64
    WSMessageRecv   atomic.Int64
    WSWriteErrors   atomic.Int64

    // SQLite
    DBOpenConns     atomic.Int64
    DBQueryCount    atomic.Int64
    DBQueryLatency  *Histogram
    DBWriteLatency  *Histogram
}

// Collect 采样系统指标（每 15s 调用一次）
func (m *SystemMetrics) Collect(ctx context.Context) {
    var rtm runtime.MemStats
    runtime.ReadMemStats(&rtm)
    m.Goroutines.Store(int64(runtime.NumGoroutine()))
    m.HeapAllocMB.Store(int64(rtm.HeapAlloc / 1024 / 1024))
    m.HeapInUseMB.Store(int64(rtm.HeapInuse / 1024 / 1024))
    m.NumGC.Store(int64(rtm.NumGC))
}
```

### 2.5 事件流指标（参考 opcode 埋点体系）

参考 opcode.md 中 50+ 事件类型和 9 个 PII 脱敏器，为 AgentHub 定义关键事件埋点：

```go
// TelemetryEvent 通用埋点事件（不发给外部服务，仅本地聚合）
type TelemetryEvent struct {
    Event     string         // 事件名
    Timestamp int64          // Unix 毫秒
    Props     map[string]any // 事件属性（已脱敏）
}

// 事件分类（对齐 opcode events.ts:48-134 的分类）
const (
    // Session 类
    TelSessionCreated   = "session_created"
    TelThreadCreated    = "thread_created"
    TelTurnStarted      = "turn_started"
    TelTurnCompleted    = "turn_completed"
    TelCheckpointCreated = "checkpoint_created"
    TelCheckpointRestored = "checkpoint_restored"

    // Agent Run 类
    TelRunStarted       = "run_started"
    TelRunCompleted     = "run_completed"
    TelRunFailed        = "run_failed"
    TelRunCancelled     = "run_cancelled"
    TelApprovalRequested = "approval_requested"
    TelApprovalResolved = "approval_resolved"

    // Tool 类
    TelToolExecuted     = "tool_executed"
    TelToolFailed       = "tool_failed"
    TelToolDenied       = "tool_denied"

    // MCP 类
    TelMCPConnected     = "mcp_connected"
    TelMCPDisconnected  = "mcp_disconnected"
    TelMCPError         = "mcp_error"

    // Sync 类
    TelSyncBatchSent    = "sync_batch_sent"
    TelSyncBatchAcked   = "sync_batch_acked"
    TelSyncLagDetected  = "sync_lag_detected"

    // Error 类
    TelAPIError         = "api_error"
    TelProcessCrash     = "process_crash"
    TelMemoryWarning    = "memory_warning"
)
```

**PII 脱敏器**（参考 opcode events.ts:648-700）：

```go
// packages/observability/sanitize.go

func SanitizeFilePath(path string) string {
    // 替换具体文件名为 *.ext
    ext := filepath.Ext(path)
    if ext == "" {
        return "file"
    }
    return "*" + ext
}

func SanitizeProjectPath(path string) string {
    // 替换为 "project"
    return "project"
}

func SanitizeErrorMessage(msg string) string {
    // 移除路径、API key 模式、邮箱
    msg = pathRegex.ReplaceAllString(msg, "[path]")
    msg = apiKeyRegex.ReplaceAllString(msg, "[api_key]")
    msg = emailRegex.ReplaceAllString(msg, "[email]")
    return msg
}

func SanitizeEndpoint(url string) string {
    // /api/conversations/abc123 → /api/conversations/:id
    return uuidRegex.ReplaceAllString(url, ":id")
}
```

---

## 3. 健康检查

### 3.1 端点设计

每个服务暴露两个健康检查端点（参考 design-go-services.md 的 chi 路由）：

| 端点 | 用途 | 检查范围 | 成功 HTTP 码 |
|------|------|---------|:---:|
| `GET /healthz` | 进程存活 | 仅自身进程响应 | 200 |
| `GET /readyz` | 依赖就绪 | DB + WebSocket + 上游连接 | 200 或 503 |

**`/healthz` 实现（极简）**：
```go
// 只需进程能响应 HTTP 即可，不做任何依赖检查
func HealthzHandler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusOK)
    w.Write([]byte(`{"status":"ok"}`))
}
```

**`/readyz` 实现（依赖检查）**：
```go
// ReadyzHandler 检查所有依赖是否就绪
func (s *Server) ReadyzHandler(w http.ResponseWriter, r *http.Request) {
    checks := s.runReadinessChecks(r.Context())
    result := ReadinessResult{
        Status: "ok",
        Checks: checks,
    }
    for _, c := range checks {
        if c.Status != "ok" {
            result.Status = "degraded"
            break
        }
    }
    w.Header().Set("Content-Type", "application/json")
    if result.Status != "ok" {
        w.WriteHeader(http.StatusServiceUnavailable)
    }
    json.NewEncoder(w).Encode(result)
}
```

### 3.2 各服务 Readiness 检查项

#### Hub

```go
func (s *HubServer) runReadinessChecks(ctx context.Context) []CheckResult {
    return []CheckResult{
        checkSQLite(ctx, s.DB),                    // DB 可读写
        checkWSHub(s.WSHub),                       // WSHub 事件循环运行中
        // Hub 无上游依赖（它是 root）
    }
}
```

#### Edge

```go
func (s *EdgeServer) runReadinessChecks(ctx context.Context) []CheckResult {
    checks := []CheckResult{
        checkSQLite(ctx, s.DB),                    // 本地 DB
        checkLocalWS(s.WSHub),                     // 本地 WSHub
    }
    if s.Config.HubURL != "" {
        checks = append(checks, checkHubConnection(ctx, s.HubClient))
    }
    // Runner 的健康由 Runner 心跳独立报告，不阻塞 Edge ready
    return checks
}
```

#### Runner

```go
func (s *RunnerServer) runReadinessChecks(ctx context.Context) []CheckResult {
    return []CheckResult{
        checkWorkspaceProvider(ctx, s.WsProvider), // workspace 可用
        checkToolRegistry(s.ToolRegistry),         // tool 已注册
        checkAdapterBinary(s.Executor),            // Agent 二进制存在
    }
}
```

### 3.3 检查实现

```go
// packages/observability/health.go

type CheckResult struct {
    Name    string `json:"name"`
    Status  string `json:"status"`  // "ok" | "degraded" | "unavailable"
    Message string `json:"message,omitempty"`
    LatencyMs int64 `json:"latency_ms"`
}

type ReadinessResult struct {
    Status string        `json:"status"`
    Checks []CheckResult `json:"checks"`
}

func checkSQLite(ctx context.Context, db *sql.DB) CheckResult {
    start := time.Now()
    err := db.PingContext(ctx)
    elapsed := time.Since(start).Milliseconds()
    if err != nil {
        return CheckResult{
            Name: "sqlite", Status: "unavailable",
            Message: err.Error(), LatencyMs: elapsed,
        }
    }
    return CheckResult{
        Name: "sqlite", Status: "ok", LatencyMs: elapsed,
    }
}

func checkHubConnection(ctx context.Context, client hub_client.HubClient) CheckResult {
    start := time.Now()
    err := client.Ping(ctx) // 轻量 WebSocket ping
    elapsed := time.Since(start).Milliseconds()
    if err != nil {
        return CheckResult{
            Name: "hub_connection", Status: "degraded",
            Message: err.Error(), LatencyMs: elapsed,
        }
    }
    return CheckResult{
        Name: "hub_connection", Status: "ok", LatencyMs: elapsed,
    }
}

func checkWorkspaceProvider(ctx context.Context, wp workspace.Provider) CheckResult {
    start := time.Now()
    _, err := wp.Get(ctx, "_health_check_") // 验证 provider 可达
    elapsed := time.Since(start).Milliseconds()
    if err != nil {
        return CheckResult{
            Name: "workspace_provider", Status: "unavailable",
            Message: err.Error(), LatencyMs: elapsed,
        }
    }
    return CheckResult{
        Name: "workspace_provider", Status: "ok", LatencyMs: elapsed,
    }
}
```

### 3.4 Runner 心跳

Runner 向 Edge 定期报告自身和活跃 Run 的状态：

```go
// runner/internal/health/heartbeat.go

type HeartbeatSender struct {
    edgeURL    string
    runnerID   string
    interval   time.Duration // 默认 10s
    executor   *executor.Executor
    metrics    *MetricsCollector
    logger     *slog.Logger
}

func (h *HeartbeatSender) Start(ctx context.Context) {
    ticker := time.NewTicker(h.interval)
    defer ticker.Stop()
    for {
        select {
        case <-ticker.C:
            h.send(ctx)
        case <-ctx.Done():
            return
        }
    }
}

func (h *HeartbeatSender) send(ctx context.Context) {
    hb := HeartbeatPayload{
        RunnerID:    h.runnerID,
        Status:      "healthy",
        ActiveRuns:  h.executor.ActiveCount(),
        Metrics:     h.metrics.Snapshot(),
        Timestamp:   time.Now().UnixMilli(),
    }
    // POST /api/runners/{runnerID}/heartbeat
    if err := h.sendToEdge(ctx, hb); err != nil {
        h.logger.Warn("heartbeat send failed", "error", err)
    }
}
```

### 3.5 Edge 心跳

Edge 向 Hub 报告自身和所有 Runner 的聚合状态（复用 design-protocol.md 的 `Heartbeat` 类型）：

```go
// edge/internal/health/heartbeat.go

func (h *HeartbeatSender) BuildHeartbeat() protocol.Heartbeat {
    runners := make([]protocol.RunnerStatus, 0)
    for _, r := range h.runnerMgr.List() {
        runners = append(runners, protocol.RunnerStatus{
            RunnerID:      r.ID,
            EdgeID:        h.edgeID,
            Status:        r.Status,
            CurrentRunID:  r.CurrentRunID,
            ActiveSessions: r.ActiveSessions,
            LastHeartbeat: r.LastHeartbeat,
        })
    }
    return protocol.Heartbeat{
        EdgeID:  h.edgeID,
        Seq:     h.seqGen.Next(),
        Runners: runners,
        SentAt:  time.Now(),
    }
}
```

### 3.6 健康检查超时与重试策略

| 检查项 | 超时 | 重试 | 间隔 | 备注 |
|--------|:---:|:---:|------|------|
| `/healthz` | 1s | 0 | - | 越简单越好，无重试 |
| `/readyz` SQLite | 2s | 1 | - | 单次重试 |
| `/readyz` Hub连接 | 3s | 2 | 1s | 网络抖动容忍 |
| Runner → Edge 心跳 | 5s | 3 | 10s | 3 次连续失败 → 标记 Runner unhealthy |
| Edge → Hub 心跳 | 10s | 3 | 30s | 3 次连续失败 → Hub 标记 Edge offline |
| Hub 内 WSHub Ping | 15s | 0 | 15s | 使用 coder/websocket 内建 Ping/Pong |

**状态判定**：
- Runner: 30s 无心跳 → `unhealthy`, 60s 无心跳 → `offline`
- Edge: 90s 无心跳 → `offline`, 触发 authority transfer（参考 protocol.md AuthorityTransfer）

---

## 4. 成本追踪

### 4.1 模型定价表

参考 claude-code-viewer.md 的 7 种模型定价（`src/server/core/session/constants/pricing.ts:36-79`），并扩展 Codex/Gemini 定价：

```go
// packages/observability/pricing.go

// ModelPricing 定义模型的 token 定价（USD / 1M tokens）
type ModelPricing struct {
    InputPerMTok     float64 // 输入价格
    OutputPerMTok    float64 // 输出价格
    CacheWritePerMTok float64 // 缓存写入价格
    CacheReadPerMTok  float64 // 缓存读取价格
}

// PricingTable 模型定价表
var PricingTable = map[string]ModelPricing{
    // Anthropic (来源: claude-code-viewer.md)
    "claude-opus-4.5":    {Input: 15.00, Output: 75.00, CacheWrite: 18.75, CacheRead: 1.50},
    "claude-opus-4.1":   {Input: 15.00, Output: 75.00, CacheWrite: 18.75, CacheRead: 1.50},
    "claude-sonnet-4.5": {Input: 3.00, Output: 15.00, CacheWrite: 3.75, CacheRead: 0.30},
    "claude-sonnet-4":   {Input: 3.00, Output: 15.00, CacheWrite: 3.75, CacheRead: 0.30},
    "claude-3.5-sonnet": {Input: 3.00, Output: 15.00, CacheWrite: 3.75, CacheRead: 0.30},
    "claude-haiku-4.5":  {Input: 0.80, Output: 4.00, CacheWrite: 1.00, CacheRead: 0.08},
    "claude-3-opus":     {Input: 15.00, Output: 75.00, CacheWrite: 18.75, CacheRead: 1.50},
    "claude-3-haiku":    {Input: 0.25, Output: 1.25, CacheWrite: 0.30, CacheRead: 0.03},

    // OpenAI (2026 Q1 参考)
    "gpt-5":            {Input: 2.50, Output: 10.00},
    "gpt-5-mini":       {Input: 0.15, Output: 0.60},
    "gpt-4.1":          {Input: 5.00, Output: 15.00},

    // Gemini (2026 Q1 参考)
    "gemini-3-pro":     {Input: 1.25, Output: 5.00},
    "gemini-3-flash":   {Input: 0.10, Output: 0.40},

    // OpenCode / DeepSeek
    "deepseek-v4":     {Input: 0.27, Output: 1.10},
}

// NormalizeModelName 将完整 model name 标准化为定价表 key
// 参考 claude-code-viewer.md normalize (calculateSessionCost.ts:63-107)
func NormalizeModelName(fullName string) string {
    // claude-opus-4-5-20251101 → claude-opus-4.5
    // gpt-5-2026-01-01 → gpt-5
    // 先精确匹配，再前缀匹配
    if _, ok := PricingTable[fullName]; ok {
        return fullName
    }
    for key := range PricingTable {
        if strings.HasPrefix(fullName, key) {
            return key
        }
    }
    // fallback
    return "claude-sonnet-4.5"
}

// DefaultPricing 未知模型的 fallback 定价
var DefaultPricing = PricingTable["claude-sonnet-4.5"]
```

### 4.2 单次 AgentRun 成本计算

```go
// packages/observability/cost.go

// CalculateCost 计算单次 AgentRun 的成本
// 参考 design-protocol.md UsageInfo + CostInfo
func CalculateCost(model string, usage *protocol.UsageInfo) float64 {
    pricing := lookupPricing(model)

    inputCost := float64(usage.InputTokens) / 1_000_000 * pricing.InputPerMTok
    outputCost := float64(usage.OutputTokens) / 1_000_000 * pricing.OutputPerMTok
    cacheWriteCost := float64(usage.CacheCreationTokens) / 1_000_000 * pricing.CacheWritePerMTok
    cacheReadCost := float64(usage.CacheReadTokens) / 1_000_000 * pricing.CacheReadPerMTok

    total := inputCost + outputCost + cacheWriteCost + cacheReadCost
    return math.Round(total*1_000_000) / 1_000_000 // 6 位小数精度
}

// RunCostBreakdown 单次 Run 的成本分解
type RunCostBreakdown struct {
    RunID              string             `json:"run_id"`
    Model              string             `json:"model"`
    TotalCostUSD       float64            `json:"total_cost_usd"`
    InputCostUSD       float64            `json:"input_cost_usd"`
    OutputCostUSD      float64            `json:"output_cost_usd"`
    CacheWriteCostUSD  float64            `json:"cache_write_cost_usd"`
    CacheReadCostUSD   float64            `json:"cache_read_cost_usd"`
    PerModelCost       map[string]float64 `json:"per_model_cost"` // 子 Agent 使用不同模型时
}
```

### 4.3 Budget 预算追踪与预警

```go
// packages/observability/budget.go

// BudgetTracker 追踪项目/Agent/用户的成本预算
type BudgetTracker struct {
    mu       sync.RWMutex
    budgets  map[string]*Budget // budgetID → Budget
    db       *sql.DB            // 持久化
}

// Budget 定义
type Budget struct {
    ID        string    `json:"id"`
    Scope     string    `json:"scope"`     // "project" | "agent" | "user" | "conversation"
    ScopeID   string    `json:"scope_id"`
    LimitUSD  float64   `json:"limit_usd"`  // 预算上限
    Window    string    `json:"window"`     // "daily" | "weekly" | "monthly" | "total"
    SpentUSD  float64   `json:"spent_usd"`  // 已使用
    AlertPct  float64   `json:"alert_pct"`  // 预警阈值（如 0.8 = 80% 时预警）
    CreatedAt time.Time `json:"created_at"`
}

// CheckAndRecord 检查预算并记录消费
func (bt *BudgetTracker) CheckAndRecord(ctx context.Context, scope, scopeID string, costUSD float64) (*BudgetAlert, error) {
    bt.mu.Lock()
    defer bt.mu.Unlock()

    budgetID := scope + ":" + scopeID
    b, ok := bt.budgets[budgetID]
    if !ok {
        return nil, nil // 无预算，不追踪
    }

    b.SpentUSD += costUSD
    ratio := b.SpentUSD / b.LimitUSD

    // 持久化
    bt.saveBudget(ctx, b)

    if ratio >= 1.0 {
        return &BudgetAlert{
            BudgetID:  budgetID,
            Level:     "exceeded",
            SpentUSD:  b.SpentUSD,
            LimitUSD:  b.LimitUSD,
            Ratio:     ratio,
        }, nil
    }
    if ratio >= b.AlertPct {
        return &BudgetAlert{
            BudgetID:  budgetID,
            Level:     "warning",
            SpentUSD:  b.SpentUSD,
            LimitUSD:  b.LimitUSD,
            Ratio:     ratio,
        }, nil
    }
    return nil, nil
}

type BudgetAlert struct {
    BudgetID string  `json:"budget_id"`
    Level    string  `json:"level"` // "warning" | "exceeded"
    SpentUSD float64 `json:"spent_usd"`
    LimitUSD float64 `json:"limit_usd"`
    Ratio    float64 `json:"ratio"`
}
```

**预警行为**：
| 级别 | 条件 | Hub 行为 | Runner 行为 |
|------|------|---------|------------|
| `warning` | 消耗 >= AlertPct (默认 80%) | 记录 WARN 日志 | 继续执行 |
| `exceeded` | 消耗 >= 100% | 拒绝新 Run 启动 | 通过 `ResultSubtype = "error_max_budget_usd"` 终止当前 Run |

**预算配置示例**（环境变量）：
```bash
# 项目 agenthub 每月预算 $500，80% 预警
AGENTHUB_BUDGET_PROJECT_agenthub="500:monthly:0.8"
# 用户 user123 总计 $1000
AGENTHUB_BUDGET_USER_user123="1000:total:0.9"
```

### 4.4 成本聚合查询

```go
// GetCostReport 生成指定时间范围的成本报告
// 参考 opcode.md UsageDashboard 五个 Tab (overview/models/projects/sessions/timeline)
func (bt *BudgetTracker) GetCostReport(ctx context.Context, opts CostQueryOpts) (*CostReport, error) {
    rows, err := bt.db.QueryContext(ctx, `
        SELECT
            r.model,
            COUNT(*) as run_count,
            SUM(json_extract(r.usage, '$.inputTokens')) as total_input,
            SUM(json_extract(r.usage, '$.outputTokens')) as total_output,
            SUM(json_extract(r.usage, '$.cacheReadTokens')) as total_cache_read,
            SUM(json_extract(r.usage, '$.cacheCreationTokens')) as total_cache_write
        FROM runs r
        WHERE r.created_at >= ? AND r.created_at < ?
          AND r.status IN ('completed', 'failed')
        GROUP BY r.model
    `, opts.StartAt, opts.EndAt)
    // ... 计算 per-model cost
}
```

---

## 5. Metrics API 端点

### 5.1 端点设计

| 端点 | 方法 | 用途 |
|------|:---:|------|
| `/api/metrics` | GET | 当前服务指标快照（Prometheus text 格式优先，JSON 兜底） |
| `/api/metrics/runs` | GET | AgentRun 聚合统计 |
| `/api/metrics/models` | GET | 模型调用统计 |
| `/api/metrics/system` | GET | 系统指标 |
| `/api/metrics/cost` | GET | 成本报告 |
| `/api/budgets` | GET | 预算状态列表 |
| `/api/budgets` | POST | 创建/更新预算 |

### 5.2 Go 实现

```go
// runner/internal/service/metrics_handler.go

type MetricsHandler struct {
    collector *observability.MetricsCollector
    budget    *observability.BudgetTracker
    logger    *slog.Logger
}

func (h *MetricsHandler) RegisterRoutes(r chi.Router) {
    r.Get("/api/metrics", h.ServeMetrics)
    r.Get("/api/metrics/runs", h.ServeRunMetrics)
    r.Get("/api/metrics/models", h.ServeModelMetrics)
    r.Get("/api/metrics/system", h.ServeSystemMetrics)
    r.Get("/api/metrics/cost", h.ServeCostReport)
    r.Get("/api/budgets", h.ListBudgets)
    r.Post("/api/budgets", h.UpdateBudget)
}

// ServeMetrics 返回 Prometheus 文本格式（Prometheus 不依赖，但格式可读）
func (h *MetricsHandler) ServeMetrics(w http.ResponseWriter, r *http.Request) {
    snap := h.collector.Snapshot()
    w.Header().Set("Content-Type", "text/plain; version=0.0.4")
    fmt.Fprintf(w, "# HELP agenthub_runs_started_total Total runs started\n")
    fmt.Fprintf(w, "# TYPE agenthub_runs_started_total counter\n")
    fmt.Fprintf(w, "agenthub_runs_started_total{service=\"runner\"} %d\n", snap.RunsStarted)
    // ... 其余指标
}
```

### 5.3 Edge/Hub 聚合端点

Edge 和 Hub 的 metrics 端点聚合本地 + 下级组件的指标：

- **Edge** `/api/metrics`：本地 Edge 指标 + 所有已连接 Runner 的 `/api/metrics` 聚合
- **Hub** `/api/metrics`：Hub 自身指标 + 所有在线 Edge 的 `/api/metrics` 聚合（通过 Sync 协议返回）

```go
// edge/internal/metrics/aggregator.go

type MetricsAggregator struct {
    local      *observability.MetricsCollector
    runnerMgr  runner_manager.RunnerManager
    cache      *MetricsSnapshot
    cacheMu    sync.RWMutex
    cacheTTL   time.Duration // 30s
}

func (a *MetricsAggregator) GetAggregated(ctx context.Context) (*MetricsSnapshot, error) {
    a.cacheMu.RLock()
    if a.cache != nil && time.Since(a.cache.CollectedAt) < a.cacheTTL {
        defer a.cacheMu.RUnlock()
        return a.cache, nil
    }
    a.cacheMu.RUnlock()

    // 并行拉取所有 Runner 指标
    snapshot := a.local.Snapshot()
    for _, runner := range a.runnerMgr.List() {
        runnerMetrics, err := a.fetchRunnerMetrics(ctx, runner)
        if err != nil {
            slog.Warn("failed to fetch runner metrics", "runner_id", runner.ID, "error", err)
            continue
        }
        snapshot.Merge(runnerMetrics)
    }

    a.cacheMu.Lock()
    a.cache = snapshot
    a.cacheMu.Unlock()
    return snapshot, nil
}
```

---

## 6. packages/observability/ 包设计

### 6.1 文件结构

```
packages/observability/
├── logger.go          # slog 初始化 + 子 logger 创建
├── metrics.go         # MetricsCollector + RunMetrics + ModelMetrics + SystemMetrics
├── health.go          # HealthChecker + ReadinessResult + 检查函数
├── pricing.go         # PricingTable + NormalizeModelName + CalculateCost
├── budget.go          # BudgetTracker + BudgetAlert
├── sanitize.go        # SanitizeForLog + PII 脱敏器
├── histogram.go       # 轻量 Histogram 实现
└── telemetry.go       # TelemetryEvent + 事件类型常量
```

### 6.2 核心类型

```go
// packages/observability/metrics.go

// MetricsCollector 聚合所有指标
type MetricsCollector struct {
    // 生命周期
    ctx    context.Context
    cancel context.CancelFunc

    // 子指标
    Runs   *RunMetrics
    Models *ModelMetrics
    System *SystemMetrics

    // 事件缓冲区
    events   []TelemetryEvent
    eventsMu sync.Mutex
    maxEvents int // 默认 10000，环形缓冲

    // 持久化
    db *sql.DB // 可选，用于持久化 metrics
}

func NewMetricsCollector(db *sql.DB, maxEvents int) *MetricsCollector {
    mc := &MetricsCollector{
        Runs:      &RunMetrics{RunDurationHist: NewHistogram()},
        Models:    &ModelMetrics{APILatencyHist: NewHistogram()},
        System:    &SystemMetrics{DBQueryLatency: NewHistogram(), DBWriteLatency: NewHistogram()},
        maxEvents: maxEvents,
        db:        db,
    }
    return mc
}

// Start 启动后台采样
func (mc *MetricsCollector) Start(ctx context.Context) {
    mc.ctx, mc.cancel = context.WithCancel(ctx)
    go mc.samplingLoop()
}

// samplingLoop 每 15s 采集系统指标
func (mc *MetricsCollector) samplingLoop() {
    ticker := time.NewTicker(15 * time.Second)
    defer ticker.Stop()
    for {
        select {
        case <-ticker.C:
            mc.System.Collect(mc.ctx)
        case <-mc.ctx.Done():
            return
        }
    }
}

// RecordEvent 记录埋点事件
func (mc *MetricsCollector) RecordEvent(event string, props map[string]any) {
    mc.eventsMu.Lock()
    defer mc.eventsMu.Unlock()

    ev := TelemetryEvent{
        Event:     event,
        Timestamp: time.Now().UnixMilli(),
        Props:     SanitizeEventProps(props),
    }
    mc.events = append(mc.events, ev)
    if len(mc.events) > mc.maxEvents {
        mc.events = mc.events[len(mc.events)-mc.maxEvents:]
    }
}

// Snapshot 返回所有指标的只读快照
func (mc *MetricsCollector) Snapshot() *MetricsSnapshot {
    return &MetricsSnapshot{
        CollectedAt: time.Now(),
        Runs:        mc.Runs.Snapshot(),
        System:      mc.System.Snapshot(),
        // Models 和 Events 按需查询
    }
}

// MetricsSnapshot 不可变指标快照
type MetricsSnapshot struct {
    CollectedAt  time.Time          `json:"collected_at"`
    Runs         RunMetricsSnapshot `json:"runs"`
    System       SystemSnapshot     `json:"system"`
    // Models 按需计算，不包含在 Snapshot 中
}

type RunMetricsSnapshot struct {
    RunsStarted   int64            `json:"runs_started"`
    RunsCompleted int64            `json:"runs_completed"`
    RunsFailed    int64            `json:"runs_failed"`
    RunsCancelled int64            `json:"runs_cancelled"`
    RunsActive    int64            `json:"runs_active"`
    DurationP50   float64          `json:"duration_p50_ms"`
    DurationP95   float64          `json:"duration_p95_ms"`
    DurationP99   float64          `json:"duration_p99_ms"`
    FailureReasons map[string]int64 `json:"failure_reasons"`
}

type SystemSnapshot struct {
    Goroutines    int64 `json:"goroutines"`
    HeapAllocMB   int64 `json:"heap_alloc_mb"`
    HeapInUseMB   int64 `json:"heap_in_use_mb"`
    NumGC         int64 `json:"num_gc"`
    CPUPercent    int64 `json:"cpu_percent_hundredths"`
    RSSMB         int64 `json:"rss_mb"`
    WSConnections int64 `json:"ws_connections"`
    WSMessageSent int64 `json:"ws_message_sent"`
    WSMessageRecv int64 `json:"ws_message_recv"`
}
```

### 6.3 轻量 Histogram

```go
// packages/observability/histogram.go

// Histogram 基于 DDSketch 的简化实现，适合嵌入式指标收集
type Histogram struct {
    mu       sync.RWMutex
    values   []int64   // 采样值（最多 10000 个）
    count    int64
    sum      int64
    min, max int64
}

func NewHistogram() *Histogram {
    return &Histogram{
        values: make([]int64, 0, 10000),
        min:    math.MaxInt64,
    }
}

func (h *Histogram) Record(value int64) {
    h.mu.Lock()
    defer h.mu.Unlock()

    h.count++
    h.sum += value
    if value < h.min { h.min = value }
    if value > h.max { h.max = value }

    // 蓄水池采样保持最多 10000 个值
    if len(h.values) < 10000 {
        h.values = append(h.values, value)
    } else {
        idx := rand.Intn(int(h.count))
        if idx < 10000 {
            h.values[idx] = value
        }
    }
}

func (h *Histogram) Percentile(p float64) float64 {
    h.mu.RLock()
    defer h.mu.RUnlock()

    if len(h.values) == 0 {
        return 0
    }
    sorted := make([]int64, len(h.values))
    copy(sorted, h.values)
    sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })

    k := int(math.Ceil(p * float64(len(sorted)))) - 1
    if k < 0 { k = 0 }
    if k >= len(sorted) { k = len(sorted) - 1 }
    return float64(sorted[k])
}

func (h *Histogram) Mean() float64 {
    h.mu.RLock()
    defer h.mu.RUnlock()
    if h.count == 0 { return 0 }
    return float64(h.sum) / float64(h.count)
}
```

### 6.4 集成到 Server 装配

在 Manual DI 装配时注入 `MetricsCollector`（参考 design-go-services.md 的 `NewServer` 模式）：

```go
// hub/server.go 扩展示例
func NewServer(cfg *Config) *Server {
    // ... 现有 Layer 0-2 代码 ...

    // Layer: Observability
    metricsCollector := observability.NewMetricsCollector(db, 10000)
    budgetTracker := observability.NewBudgetTracker(db) // 从 DB 加载预算配置

    // Layer 3: HTTP 路由（追加健康检查 + metrics）
    r := chi.NewRouter()
    r.Get("/healthz", observability.HealthzHandler)
    r.Get("/readyz", srv.ReadyzHandler) // srv 持有 dependencies

    metricsHandler := &MetricsHandler{
        collector: metricsCollector,
        budget:    budgetTracker,
    }
    metricsHandler.RegisterRoutes(r)

    // 注入到 RouteDeps
    RegisterRoutes(r, &RouteDeps{
        // ... 现有 deps ...
        Metrics:  metricsCollector,
        Budget:   budgetTracker,
    })

    return &Server{
        // ... 现有字段 ...
        Metrics:  metricsCollector,
        Budget:   budgetTracker,
    }
}
```

---

## 7. 与现有设计的集成点

### 7.1 与 EventStore 的集成

指标事件的持久化复用 EventStore（design-eventstore-memory.md）：

```go
// Run 完成时将指标数据作为 event payload 写入 EventStore
func (e *Executor) onRunComplete(run *RunSession) {
    // 1. 收集指标
    snap := e.metrics.Runs.Snapshot()
    costBreakdown := observability.CalculateCost(run.Model, run.Usage)

    // 2. 写入 EventStore（可用于后续 FTS5 搜索和 Dashboard）
    e.eventStore.Append(EventRunMetrics, RunMetricsPayload{
        RunID:         run.ID,
        DurationMs:    run.DurationMs,
        CostUSD:       costBreakdown.TotalCostUSD,
        InputTokens:   run.Usage.InputTokens,
        OutputTokens:  run.Usage.OutputTokens,
        Model:         run.Model,
        Status:        run.Status,
        FailureReason: run.FailureReason,
    })
}
```

### 7.2 与 Sync 协议的集成

Edge 定期向 Hub 推送聚合指标（复用 design-protocol.md 的 `EdgeEvent`）：

```go
// edge/internal/sync_client/metrics_syncer.go

// PushMetrics 将 Edge 级别的聚合指标通过 sync 协议推送到 Hub
func (s *MetricsSyncer) PushMetrics(ctx context.Context) error {
    snap := s.collector.Snapshot()

    evt := protocol.EdgeEvent{
        EdgeID: s.edgeID,
        Seq:    s.seqGen.Next(),
        Type:   "metrics.snapshot",
        Payload: map[string]any{
            "runs":      snap.Runs,
            "system":    snap.System,
            "cost_yday": s.budgetTracker.GetYesterdayCost(scope),
        },
    }
    return s.hubClient.SendEvent(ctx, evt)
}
```

### 7.3 与 Checkpoint 的集成

Checkpoint 创建时附带成本快照：

```go
// runner/internal/checkpoint/manager.go

func (cm *CheckpointManager) Create(ctx context.Context, spec checkpointcore.CreateSpec) (*checkpointcore.Checkpoint, error) {
    // ... 现有 checkpoint 创建逻辑 ...

    // 附加成本快照到 checkpoint metadata
    costSnap := cm.metrics.Models.Snapshot()
    cp.Metadata["cost_at_checkpoint"] = costSnap
    cp.Metadata["tokens_at_checkpoint"] = cm.metrics.Models.TotalTokens()
}
```

---

## 8. 决策汇总

| 决策 | 选择 | 依据 |
|------|------|------|
| 日志库 | Go 1.24 slog | design-go-services.md 决策，零依赖 |
| 日志格式 | JSON（生产）/ Text（本地） | 业界标准 |
| 指标库 | 自建轻量 MetricsCollector | 不引入 Prometheus client 重依赖，P2+ 可桥接 |
| Histogram | 蓄水池采样 DDSketch | 内存受限环境（Edge 本地），10K 样本 |
| 成本定价来源 | claude-code-viewer.md 定价表 | 已验证，7 种模型 |
| 预算预警 | 80% warning + 100% block | 参考 LibreChat reserveRatio 思想 |
| 健康检查 | /healthz + /readyz | K8s 兼容，渐进式依赖检查 |
| 心跳间隔 | Runner→Edge 10s, Edge→Hub 30s | 平衡实时性与网络开销 |
| 离线判定 | Runner 60s, Edge 90s | 容忍临时网络抖动 |
| PII 脱敏 | 参考 opcode 9 个 sanitizer | 久经检验 |
| 埋点事件 | 参考 opcode 50+ 事件类型 | 分类成熟，按需裁剪 |
| 指标聚合 | 并行拉取 + 30s TTL 缓存 | 降低协调开销 |

---

## 9. 实施路线

### Phase 1: 日志 (P0)
1. 实现 `packages/observability/logger.go` — slog 初始化 + 子 logger
2. 三个 cmd/入口集成 logger（替换裸 `slog.Info/Error`）
3. 实现 `packages/observability/sanitize.go` — 敏感信息 + PII 脱敏
4. 为关键路径添加结构化日志字段

### Phase 2: 健康检查 (P0)
1. 实现 `packages/observability/health.go` — `/healthz` + `/readyz` 检查函数
2. 各 Server 集成健康检查路由
3. 实现 Runner→Edge 心跳 + Edge→Hub 心跳
4. 实现离线判定 + 自动标记

### Phase 3: 指标收集 + 成本追踪 (P1)
1. 实现 `packages/observability/metrics.go` — MetricsCollector + 采样循环
2. 实现 `packages/observability/histogram.go`
3. 实现 `packages/observability/pricing.go` — 定价表 + CalculateCost
4. 实现 `packages/observability/budget.go` — BudgetTracker
5. 集成到 Run 生命周期：onStart / onComplete / onFailure
6. 实现 `/api/metrics` 系列端点

### Phase 4: Telemetry + Dashboard 后端 (P2)
1. 实现 `packages/observability/telemetry.go` — TelemetryEvent 埋点
2. 在 Edge Sync 协议中增加 metrics snapshot 推送
3. 前端 Dashboard：Run 统计 / 成本趋势 / 模型用量（复刻 opcode UsageDashboard 五 Tab）

---

## 附录：环境变量参考

```bash
# 日志
LOG_FORMAT=json             # "json" | "text"
LOG_LEVEL=info              # "debug" | "info" | "warn" | "error"

# 健康检查
HEALTH_CHECK_INTERVAL=10s   # 心跳间隔
HEALTH_UNHEALTHY_AFTER=30s  # 标记 unhealthy 的阈值
HEALTH_OFFLINE_AFTER=60s    # 标记 offline 的阈值 (Runner)
HEALTH_EDGE_OFFLINE_AFTER=90s # 标记 offline 的阈值 (Edge)

# 预算
AGENTHUB_BUDGET_PROJECT_xxx="500:monthly:0.8"  # 项目 xxx 月预算 $500，80% 预警
AGENTHUB_BUDGET_USER_xxx="1000:total:0.9"       # 用户 xxx 总预算 $1000

# 指标
METRICS_MAX_EVENTS=10000     # 内存中保留的最大事件数
METRICS_SAMPLING_INTERVAL=15 # 系统指标采样间隔（秒）
METRICS_AGGREGATION_TTL=30   # 聚合缓存 TTL（秒）
```
