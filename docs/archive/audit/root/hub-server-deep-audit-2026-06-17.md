# Hub Server Deep Audit Report

**Worktree**: `<worktree>`
**Branch**: `feat/chatview-tokendance-migration`
**Date**: 2026-06-17
**Scope**: `hub-server/` -- handler, middleware, infrastructure, JWT, error codes, config, metrics, cache
**Auditor**: Claude Code subagent (Opus Max Effort)
**Status**: FINAL
**历史清理标记**: 已对文档中出现的个人工作路径做脱敏处理（2026-06-19）。已修复项已在对应发现处标注。

---

## Executive Summary

The Hub Server is the central control plane for AgentHub -- it handles auth (both Hub-local JWT and TokenDance ID OIDC), IM sessions/messages, agent task orchestration, user profiles, device management, WebSocket push, file attachments, document CRUD, skill/agent-profile markets, MCP server registry, audit events, provider bindings, and public stats. This audit covers all 28 handler source files, 15 middleware files, all infrastructure packages (jwtutil, cache, metrics, config, errcode, log), and the main entry point.

### Key Findings by Count

| Category | Critical | High | Medium | Low | Total |
|----------|----------|------|--------|-----|-------|
| Handler Bugs | 2 | 3 | 4 | 5 | 14 |
| Infrastructure | 1 | 2 | 3 | 2 | 8 |
| Security | 2 | 3 | 2 | 3 | 10 |
| Performance | 0 | 2 | 3 | 3 | 8 |
| **TOTAL** | **5** | **10** | **12** | **13** | **40** |

---

## 1. Endpoint Catalog Summary

The Hub Server exposes approximately 120+ implemented REST endpoints across 6 route groups, plus WebSocket. All handler code lives in `hub-server/internal/handler/` with per-file handler + interface pattern.

### 1.1 Route Groups and Handler Files

| Route Prefix | Handler File | Purpose | Endpoints (approx) |
|---|---|---|---|
| `/health`, `/live`, `/ready` | `health.go` | LB probes + readiness | 3 |
| `/api/public/stats` | `public.go` | Unauthenticated website stats | 1 |
| `/client/auth/*` | `auth.go`, `oidc.go` | Login, refresh, profile, OIDC PKCE | 5 |
| `/client/contacts/*` | `contact.go` | Friend management, block/remark | 10 |
| `/client/sessions/*` | `session.go` | Session CRUD, groups, member mgmt | 12 |
| `/client/sessions/:id/messages/*` | `message.go` | Send/recall/edit/pin/search/reactions | 14 |
| `/client/sessions/:id/agents` | `agent.go` | Add agent to session, trigger task | 3 |
| `/client/ws` | `ws.go` | WebSocket upgrade + typed events | 1 |
| `/client/attachments/*` | `attachment.go` | Probe/upload/download | 3 |
| `/client/notifications/*` | `notification.go` | List/mark-read/all-read | 3 |
| `/client/devices/*` | `device.go` | Device register/list | 2 |
| `/client/documents/*` | `document.go` | Cloud document CRUD | 5 |
| `/client/settings` | `user_settings.go` | User settings get/patch | 2 |
| `/web/agent-tasks/*` | `agent.go` | Task trigger/cancel/regenerate/events/summary | 7 |
| `/edge/agent-tasks/*` | `agent.go` | Edge-side task ack/stream/done/fail | 4 |
| `/web/market/*` | `market.go` | Agent profile marketplace | 4 |
| `/web/profiles/*` | `agent_profile.go` | Agent profile CRUD + publish | 9 |
| `/web/agent-teams/*` | `agent_team.go` | Team CRUD, runs, approvals | 16 |
| `/web/custom-agents/*` | `custom_agent.go` | Custom agent CRUD | 4 |
| `/web/targets/*` | `execution_target.go` | Execution target CRUD + ping | 6 |
| `/web/skills/*` | `skill.go` | Skill CRUD + publish/market | 8 |
| `/web/mcp-servers/*` | `mcp_server.go` | MCP server CRUD + publish | 8 |
| `/web/workspaces/*` | `workspace.go` | Workspace + threads | 8 |
| `/web/provider-bindings/*` | `provider_binding.go` | Provider bindings CRUD | 4 |
| `/web/relay/*` | `relay.go` | Hub-Edge relay commands | 3 |
| `/web/audit/*` | `audit.go` | Audit event listing (admin) | 1 |
| `/cloud/edge/*` | `device.go` | Cloud Edge registration + JWT | 1 |

**Total**: approximately 142 implemented endpoints.

### 1.2 Handler Pattern Consistency

All handlers follow a consistent pattern:
1. Define a `Service` interface at the top of the handler file with only the methods needed.
2. Create `*Handler` struct with constructor `New*Handler(s Service)`.
3. Each method: bind JSON/params, validate, call service, map errors, return `OK()` or `Fail()`.
4. Shared utilities in `response.go` (OK, Fail, FailWithMessage), `validation.go` (normalizeUUID).

**Grade**: A -- the handler layer is highly consistent, well-structured, and easy to audit.

---

## 2. Handler Audit Findings

### 2.1 Critical (P0) -- Handler Bugs

#### C-1: `user_settings.go` leaks internal error messages to clients

> **已修复 (2026-06-19)**: `user_settings.go` 不再使用 `FailWithMessage(c, errcode.ErrInternal, err.Error())`，已改为标准 `Fail(c, errcode.ErrInternal)` 模式，原始错误仅通过 `slog.Error` 记录在服务端日志中。

**File**: `hub-server/internal/handler/user_settings.go:34-36`
**Severity**: Critical (P0)
**Category**: Error Handling / Information Disclosure

```go
func (h *UserSettingsHandler) GetSettings(c *gin.Context) {
    // ...
    settings, err := h.settingsService.GetSettings(userID)
    if err != nil {
        FailWithMessage(c, errcode.ErrInternal, err.Error())  // <-- LEAKS
        return
    }
```

Both `GetSettings` (line 35) and `PatchSettings` (line 65) call `FailWithMessage(c, errcode.ErrInternal, err.Error())` which passes the raw Go error string into the HTTP response body. This can leak database errors, SQL fragments, table/column names, and internal stack information to API consumers.

**Impact**: Information disclosure -- database schema, internal error paths, potential SQL fragments exposed in public API responses.

**Fix**: Change to `Fail(c, errcode.ErrInternal)` (without message) and log the actual error server-side via `slog.Error`.

**Severity rationale**: This is the ONLY handler that leaks raw errors. All other handlers correctly use `Fail(c, errcode.ErrInternal)` or wrap domain-specific errors. Marked Critical because (a) it is a direct information disclosure path and (b) it's inconsistent with the rest of the codebase, suggesting it was an oversight during implementation.

---

#### C-2: WebSocket `auth.ok` sent via `sendFrame` bypasses buffer capacity check

> **已修复 (2026-06-19)**: `go h.writeLoop(conn)` 现在在 `h.sendFrame(conn, ws.NewFrame(ws.TypeAuthOK, nil))` 之前启动，避免了 auth.ok 帧因发送缓冲区未就绪而被静默丢弃的竞态条件。

**File**: `hub-server/internal/handler/ws.go:73`
**Severity**: Critical (P0)
**Category**: Protocol Integrity / Race Condition

```go
// #82: If middleware already authenticated the upgrade request,
// use the Gin context values directly and skip in-protocol auth frame.
if userID := c.GetString("user_id"); userID != "" {
    h.manager.SetAuth(conn.ID, userID, c.GetString("device_type"), c.GetString("device_id"))
    h.userLimiter.Acquire(userID, conn.ID)
    h.sendFrame(conn, ws.NewFrame(ws.TypeAuthOK, nil))  // <-- before writeLoop/readLoop start
```

The `auth.ok` frame is sent via `sendFrame` BEFORE `writeLoop` is started (line 74). `sendFrame` uses a non-blocking select on `conn.Send`:

```go
func (h *WebSocketHandler) sendFrame(conn *ws.Conn, frame ws.Frame) {
    data, err := frame.Marshal()
    if err != nil {
        return  // <-- SILENT DROP on marshal error
    }
    select {
    case conn.Send <- data:
    default:
        metrics.WSDroppedFrames.Inc()
        slog.Warn("ws frame dropped: send buffer full", ...)
    }
}
```

The `writeLoop` goroutine starts at line 74: `go h.writeLoop(conn)`. There is a race: if the goroutine hasn't started consuming `conn.Send` by the time `sendFrame` sends, the auth.ok frame can be silently dropped. The caller has no way to detect this. The unchecked `frame.Marshal()` error also silently drops the frame.

**Impact**: WebSocket clients connected via middleware-authenticated upgrades (query-param `access_token`) may never receive `auth.ok`, causing the client to time out waiting for auth confirmation despite being successfully authenticated.

**Fix**: Either (a) start `writeLoop` before sending `auth.ok`, or (b) use a blocking send with a short timeout, or (c) return the marshal error to caller. Option (a) is simplest: move `go h.writeLoop(conn)` before `h.sendFrame(conn, ws.NewFrame(ws.TypeAuthOK, nil))`.

---

### 2.2 High (P1) -- Handler Bugs

#### H-1: `session.go` `RemoveMember` accepts duplicate path params without validation

**File**: `hub-server/internal/handler/session.go:172-185`
**Severity**: High (P1)
**Category**: Input Validation / Authorization Bypass Risk

```go
func (h *SessionHandler) RemoveMember(c *gin.Context) {
    userID := c.GetString("user_id")
    sessionID := c.Param("id")
    targetID := c.Param("user_id")  // <-- different param name, but extract same as auth user_id
```

The Gin `c.GetString("user_id")` pulls from middleware context (authenticated user), while `c.Param("user_id")` pulls from the URL path (`/client/sessions/:id/members/:user_id`). The variable naming is confusing: `userID` (auth user, from context) vs `targetID` (path param, the member to remove). The code correctly passes them to the service, but the ambiguity creates audit risk. A future refactor could accidentally use `userID` where `targetID` is needed.

**Impact**: Low immediate risk (current code is correct), but high future refactoring risk. The identical naming could lead to an authorization bypass where the authenticated user removes themselves (or a wrong member) instead of the intended target.

**Fix**: Rename `c.Param("user_id")` binding to a distinct local, e.g. `targetUserID := c.Param("user_id")`, to disambiguate from the auth context `userID`.

---

#### H-2: `oidc.go` `GetOIDCCallback` returns HTTP 200 with success HTML even if `state` is stale

**File**: `hub-server/internal/handler/oidc.go:89-113`
**Severity**: High (P1)
**Category**: Auth UX / Protocol Integrity

```go
func (h *OIDCHandler) GetOIDCCallback(c *gin.Context) {
    code := c.Query("code")
    state := c.Query("state")
    // ...
    if code == "" || state == "" {
        // return error HTML
        return
    }
    // ALWAYS returns success HTML page -- no actual token exchange happens here
```

This is the GET callback endpoint for browser redirect -- it renders a success HTML page and does NOT perform the actual code-for-token exchange. That's handled by `POST /client/auth/oidc/callback`. However, the success page is rendered even if the `state` is totally invalid or stale, since no state validation happens in this handler. This means a browser user will see "Login Successful" with a green checkmark even for replay attacks or expired states.

**Impact**: Confusing UX -- users may believe they've logged in when the actual token exchange (POST callback) will fail. Potential for successful phishing redirects.

**Fix**: Either (a) document clearly in the HTML that "the login flow will continue in the desktop app" or (b) validate the state parameter before showing the success page, or (c) both.

---

#### H-3: `attachment.go` `Upload` does not validate `header.Size` against a server-enforced limit before creating temp file

**File**: `hub-server/internal/handler/attachment.go:76-167`
**Severity**: High (P1)
**Category**: Resource Exhaustion / DoS

```go
if header.Size > h.service.MaxUploadSize() {
    Fail(c, errcode.AttachTooLarge)
    return
}

tmpFile, err := os.CreateTemp("", "."+hash+".*.tmp")
```

The check happens BEFORE the temp file creation, which is correct. But the `Content-Length` header (reflected in `header.Size`) is client-controlled and may not match the actual body size. The `http.MaxBytesReader` from `BodyLimit` middleware is the actual defense. However, the upload endpoint requires ALL body bytes to be read (for SHA-256 verification), which means the memory/disk cost is proportional to the `BodyLimit` cap, not the `MaxUploadSize` cap. These could be different values.

**Impact**: If `BodyLimit` (default 10 MB, `config.DefaultRequestBodyLimit`) is configured smaller than `MaxUploadSize` (default 50 MB, `config.DefaultMaxUploadSize`), legitimate large uploads are rejected. If `BodyLimit` is larger, attackers can send large bodies that pass `header.Size` inspection but consume server memory.

**Fix**: Assert `BodyLimit <= MaxUploadSize` at config validation time, or apply `MaxUploadSize`-scoped `io.LimitReader` when reading the body.

---

### 2.3 Medium (P2) -- Handler Bugs

#### M-1: `session.go` `Create` and `CreatePrivate` are redundant endpoints

**File**: `hub-server/internal/handler/session.go:40-109`
**Severity**: Medium (P2)
**Category**: API Surface / Maintenance Burden

Three endpoints exist for session creation: `POST /client/sessions/private`, `POST /client/sessions/group`, and `POST /client/sessions` (with `type` field). The `Create` method dispatches to the same service methods as the dedicated endpoints. This creates a maintenance burden: bug fixes must be applied in three places, and API consumers face ambiguity about which endpoint to use.

**Impact**: Medium-term maintenance cost; no runtime bug.

**Fix**: Deprecate `CreatePrivate` and `CreateGroup` in favor of `Create`, or vice versa. Add deprecation notice to OpenAPI spec.

---

#### M-2: `agent.go` `TaskAck` silently accepts missing body

**File**: `hub-server/internal/handler/agent.go:141-168`
**Severity**: Medium (P2)
**Category**: Protocol Robustness

```go
func (h *AgentHandler) TaskAck(c *gin.Context) {
    var req taskAckReq
    if c.Request.Body != nil {
        body, err := io.ReadAll(c.Request.Body)
        // ...
        if len(bytes.TrimSpace(body)) > 0 {
            if err := json.Unmarshal(body, &req); err != nil {
                // fail
            }
        }
    }
    // Calls normalizedRunID() which returns "" if req is zero-value
```

If the body is missing or empty, `req` is zero-valued and `normalizedRunID()` returns `""`. The service layer receives an empty `edgeRunID`. This may be intentional (allowing empty run IDs for compatibility), but no log documents this case. Silent acceptance of missing body makes debugging edge-protocol mismatches difficult.

**Impact**: Debuggability. If an Edge client forgets to send a body, the task silently advances with an empty run ID.

**Fix**: Log a warning when `normalizedRunID()` returns empty string from TaskAck, or require `edge_run_id` in the body.

---

#### M-3: `execution_target.go` `normalizeTargetJSONField` has code duplication with `agent_profile.go`

**File**: `hub-server/internal/handler/execution_target.go:125-162` and `agent_profile.go:208-243`
**Severity**: Medium (P2)
**Category**: Code Quality / DRY

Both files contain near-identical functions `normalizeTargetJSONField` and `normalizeAgentProfileJSONField` that validate and normalize JSON fields (object vs array). The logic is duplicated verbatim except for error message formatting (one uses `field + " must be..."`, the other uses `fmt.Sprintf("%s must be...", field)`).

**Impact**: Bug fixes to one copy won't propagate to the other. The error messages are slightly inconsistent.

**Fix**: Extract a shared `normalizeJSONField(field string, value any, wantObject bool) (string, error)` into `validation.go`.

---

#### M-4: `agent_team.go` handler reads `CreateTeam` requires `binding:"required"` on `Name` but missing `Description` validation

**File**: `hub-server/internal/handler/agent_team.go:50-53`
**Severity**: Medium (P2)
**Category**: Input Validation

```go
type createTeamReq struct {
    Name        string `json:"name" binding:"required"`
    Description string `json:"description,omitempty"`
}
```

No length limit on `Name` or `Description`. The service layer may enforce limits, but the handler does not validate. Compare with `custom_agent.go` which calls `ca.Validate()` explicitly, and `config.MaxGroupNameLength = 64` which applies to group sessions but not agent teams.

**Impact**: Overly long names could cause display issues or (if the DB column has a limit) cryptic DB errors.

**Fix**: Add length validation to the handler or document that validation is deferred to the service layer.

---

### 2.4 Low (P3) -- Handler Bugs

#### L-1 through L-5: Minor concerns

1. **`response.go:17-23`** -- `OK()` uses `errCode.OK` (`Code: "OK"`) internally. If the shared `errcode` package changes the OK code format, this coupling breaks silently. Low risk, low impact.

2. **`oidc.go:185-191`** -- `detectLang` only checks `strings.HasPrefix(al, "zh")`, which doesn't cover `zh-CN`, `zh-TW`, `zh-HK`. The `Accept-Language` header can have weighted values like `zh-CN,zh;q=0.9`. The function should parse quality values.

3. **`health.go:78-133`** -- `readinessReport` calls `repository.VerifyMigrations` on every readiness probe, which may cause repeated DB queries. Noted for observability; not a bug.

4. **`device.go:52-87`** -- `Register` handler sets `req.DeviceID = deviceID` after normalizing, which mutates the request struct. While Go passes structs by value after JSON binding, this pattern is fragile if the code is refactored to pass pointers.

5. **`market.go:34`** -- `rateReq.Score` has no range validation (e.g. 1-5). The service layer should enforce this, but defense-in-depth validation in the handler would improve robustness.

---

## 3. Infrastructure Audit Findings

### 3.1 Critical (P0) -- Infrastructure

#### IC-1: Global rate limiter fails closed on Redis error, causing complete API unavailability

**File**: `hub-server/internal/middleware/global_rate_limit.go:16-34`
**Severity**: Critical (P0)
**Category**: Operational Reliability / DoS Self-Inflicted

```go
func GlobalRateLimit(cacheClient *cache.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        ip := c.ClientIP()
        _, exceeded, err := cacheClient.CheckRateLimit(c.Request.Context(), "global:"+ip, config.GlobalRateLimitPerMinute)
        if err != nil {
            // Fail closed: reject request when Redis is unavailable.
            fail(c, errcode.New("RATE_LIMIT_UNAVAILABLE", "rate limit service unavailable", http.StatusServiceUnavailable))
            c.Abort()
            return
        }
```

The global rate limiter **rejects all requests** if Redis is unavailable. This means a Redis outage takes down the entire API, not just rate limiting. The comment says "Fail closed" but this is a dangerous default for a middleware applied globally.

Compare with the per-endpoint `RateLimit` middleware (`rate_limit.go`) which has the same fail-closed behavior. Together, they create a single point of failure: Redis.

**Impact**: A Redis network blip, OOM restart, or connection pool exhaustion will return HTTP 503 for ALL API requests until Redis recovers. This is a self-inflicted DoS.

**Fix**: Add a configurable fail-open mode for rate limiters. When Redis is unavailable, log a warning and allow requests through rather than blocking everything. Make fail-closed the default for auth/login paths but fail-open for general API paths.

---

### 3.2 High (P1) -- Infrastructure

#### IH-1: No TLS termination configuration in Hub Server binary

**File**: `docker-compose.yml`, `hub-server/cmd/server-hub/main.go`
**Severity**: High (P1)
**Category**: Security / Production Readiness

The Hub Server binary has no native TLS support. The Docker Compose configuration binds port 8080 and 6060 (admin/metrics) directly without TLS. Production deployments are expected to use a reverse proxy (nginx). However, the `.env.example` does not document this requirement, and the `CORS()` middleware uses `AllowCredentials: true` which is only safe with HTTPS origins.

**Impact**: If deployed without a reverse proxy, all traffic (JWT tokens, passwords, session data, OIDC codes) is transmitted in cleartext. The admin port 6060 exposes Prometheus metrics and pprof endpoints without TLS.

**Fix**: Document the reverse-proxy requirement prominently in README and `.env.example`. Add an environment variable `AGENTHUB_TLS_CERT_FILE` / `AGENTHUB_TLS_KEY_FILE` for direct TLS support. Add a startup warning if `GIN_MODE=release` and TLS is not configured.

---

#### IH-2: WebSocket `InsecureSkipVerify` enabled in non-production env allows any Origin

**File**: `hub-server/internal/handler/ws.go:50-53`
**Severity**: High (P1)
**Category**: Security / CSWSH (Cross-Site WebSocket Hijacking)

```go
func (h *WebSocketHandler) ServeWS(c *gin.Context) {
    opts := &websocket.AcceptOptions{}
    if !isProductionEnv() {
        // Dev: allow any loopback origin (localhost / 127.0.0.1 on any port)
        opts.InsecureSkipVerify = true
    }
```

`InsecureSkipVerify = true` disables **all** Origin checks in the `coder/websocket` library, not just loopback origins. This means any website can open a WebSocket to the Hub in dev mode. Combined with `AllowCredentials: true` in CORS, this creates a CSWSH vulnerability in development/staging environments where browsers may have active Hub sessions.

**Impact**: CSWSH attack possible in non-production environments. A malicious website could open a WebSocket to a developer's Hub Server and receive real-time message events if the developer's browser has an active session.

**Fix**: Instead of `InsecureSkipVerify`, configure explicit allowed origins for WebSocket upgrades in dev mode, or use the `OriginPatterns` option with loopback patterns.

---

#### IH-3: `RateLimit` middleware uses Redis pipeline but `countCmd.Val()` returns stale value

**File**: `hub-server/internal/middleware/rate_limit.go:32-47`
**Severity**: High (P1)
**Category**: Correctness / Rate Limiting Accuracy

```go
// Add current request.
member := fmt.Sprintf("%d-%d", now, time.Now().UnixNano())
pipe.ZAdd(ctx, key, redis.Z{Score: float64(now), Member: member})
// ...
if _, err := pipe.Exec(ctx); err != nil { ... }

if countCmd.Val() >= int64(limit) {
```

`countCmd` captures `ZCard` result BEFORE `ZAdd`. The pipeline executes atomically, so `countCmd.Val()` reflects the count BEFORE the current request is added. This means the limit is effectively one higher than configured -- a client can make `limit` requests and the `limit+1`th request is also counted as "under limit" because `countCmd.Val()` returns `limit` (the count before adding the current one), not `limit+1`.

However, the Redis pipeline uses `ZCard` before `ZAdd` and executes in order, so `countCmd.Val()` is the count of members in the sorted set AFTER `ZRemRangeByScore` removes expired entries but BEFORE the current request's timestamp is added. This is a subtle off-by-one.

**Impact**: Rate limits are effectively `config_limit + 1`. The sliding-window cleanup behavior partially mitigates this in practice since expired entries are removed first.

**Fix**: Check `countCmd.Val() > int64(limit)` (strict greater-than) instead of `>=`. Or restructure: add the current request first, then check.

---

### 3.3 Medium (P2) -- Infrastructure

#### IM-1: Redis `ReadTimeout` and `WriteTimeout` set to 1s may cause spurious failures under load

**File**: `hub-server/internal/cache/redis.go:31-32`
**Severity**: Medium (P2)
**Category**: Reliability

```go
ReadTimeout:     1 * time.Second,
WriteTimeout:    1 * time.Second,
```

A 1-second read/write timeout is aggressive for Redis operations. Large pipeline executions (like the rate limiter pipeline with ZRemRangeByScore + ZCard + ZAdd + Expire) or high-throughput scenarios could exceed this. The timeout is per-operation, not cumulative, but under Redis CPU pressure or network congestion, 1s may not be enough.

**Impact**: Sporadic Redis timeout errors under load, manifesting as rate limit failures or cache misses.

**Fix**: Increase to 2-3 seconds, or make configurable.

---

#### IM-2: `DefaultServerWriteTimeout` of 60s is generous but no separate WebSocket write timeout

**File**: `hub-server/internal/config/constants.go:27`
**Severity**: Medium (P2)
**Category**: Resource Management

```go
const DefaultServerWriteTimeout = 60 * time.Second
```

The standard HTTP server has a 60s write timeout, but WebSocket connections bypass this (they're long-lived). The WebSocket heartbeat is configured (`WSHeartbeatInterval = 30s`, `WSPingTimeout = 5s`, `WSMaxMissedPongs = 2`) but is handled at the application layer (ws package), not the HTTP server level. If the ws heartbeat goroutine dies, a stale WebSocket could hold a connection open indefinitely without server-side detection.

**Impact**: Potential for orphaned WebSocket connections consuming goroutines and memory. Mitigated by the heartbeat mechanism, but no fallback TCP-level timeout.

**Fix**: Set `SetReadDeadline` / `SetWriteDeadline` on the underlying net.Conn for WebSocket connections as a safety net.

---

#### IM-3: Prometheus metrics use `prometheus.MustRegister` which panics on double-registration

**File**: `hub-server/internal/metrics/metrics.go:100-113`
**Severity**: Medium (P2)
**Category**: Startup Reliability

```go
prometheus.MustRegister(HTTPRequestsTotal)
// ... 10 MustRegister calls
prometheus.Register(collectors.NewGoCollector())   // <-- ignores error
prometheus.Register(collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))  // <-- ignores error
```

`prometheus.MustRegister` panics if the metric collector is already registered. The `sync.Once` guards against this for the first 10 metrics, but `prometheus.Register` (used for built-in collectors) returns an error that is silently ignored. If these collectors are already registered (e.g., by a monitoring library), the error is swallowed.

**Impact**: If the binary initializes metrics twice (e.g., during tests or in a hot-reload scenario), the panic from `MustRegister` would crash the process. The `sync.Once` prevents this under normal operation, but the ignored errors from `prometheus.Register` hide double-registration issues with Go/Process collectors.

**Fix**: Log the error from `prometheus.Register` at warn level, or use `prometheus.MustRegister` consistently for all collectors.

---

### 3.4 Low (P3) -- Infrastructure

1. **`log/log.go`** -- Internal log package wraps slog; no structured log sampling or rate-limiting for high-frequency log lines.

2. **`config/constants.go`** -- `DefaultShutdownTimeout = 5s` may be too short for in-flight WebSocket connections or long-running uploads to drain gracefully.

---

## 4. Security Assessment

### 4.1 Authentication Architecture

The Hub Server supports two authentication sources:

1. **Hub-local JWT** (`HS256`): Issued by Hub after OIDC PKCE exchange or refresh. Contains `user_id`, `device_type`, `device_id`. Validated by `AuthMiddleware`.
2. **TokenDance ID Bearer** (`RS256`): Issued by TokenDance ID OIDC provider. Validated via JWKS fetch. Used for Edge device registration. Identified by `auth_source = "tokendance_id"`.

**Assessment**: The dual-auth architecture is sound, with clear separation. The `AuthMiddleware` attempts Hub-local JWT first, falling back to TokenDance ID validation. The `RequireHubSession()` middleware correctly blocks TokenDance ID bearers from session-scoped endpoints.

**Token TTL**: Access tokens default 15 minutes, refresh tokens 30 days. Refresh token rotation is implemented (old token invalidated on refresh).

### 4.2 Critical (P0) -- Security

#### S-1: JWT secret stored as plain environment variable, no key rotation mechanism

**File**: `hub-server/cmd/server-hub/main.go`, `docker-compose.yml`
**Severity**: Critical (P0)
**Category**: Secret Management

```yaml
# docker-compose.yml
AGENTHUB_JWT_SECRET: ${AGENTHUB_JWT_SECRET:-dev-secret-change-in-production-min-length-32}
```

The JWT signing secret is a single static string with no rotation mechanism. In production, token rotation involves: (1) deploying a new secret, (2) invalidating all existing tokens, (3) forcing all users to re-login. There is no key versioning in the JWT header or claims, and no secondary key for graceful rotation.

**Impact**: If the JWT secret is compromised, all tokens become forgeable. Rotation requires downtime (all sessions invalidated simultaneously). No audit trail to distinguish tokens signed with old vs new keys.

**Fix**: Add `kid` (key ID) to JWT headers, support multiple active signing keys, and implement a rotation endpoint that promotes a new key while keeping old keys valid for their remaining TTL.

---

#### S-2: OIDC `redirect_uri` from client request is used without strict validation against allowlist

**File**: `hub-server/internal/handler/oidc.go:37-63`
**Severity**: Critical (P0)
**Category**: OAuth/OIDC Security

```go
type oidcAuthorizeReq struct {
    CodeChallenge       string `json:"code_challenge" binding:"required"`
    CodeChallengeMethod string `json:"code_challenge_method"`
    DeviceType          string `json:"device_type" binding:"required"`
    DeviceID            string `json:"device_id" binding:"required"`
    RedirectURI         string `json:"redirect_uri"`  // <-- CLIENT-SUPPLIED
}
```

The `RedirectURI` is passed from the client and forwarded to the OIDC service as `strings.TrimSpace(req.RedirectURI)`. If the `redirect_uri` is not validated against a server-side allowlist, an attacker could register a malicious redirect URI that receives the authorization code, enabling an authorization code interception attack.

The OpenAPI spec mentions `AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS` in the Docker Compose env, and the comment in `oidc.go` describes `AllowedRedirectURIs` as config-driven. However, the handler does no client-side pre-validation -- it relies entirely on the OIDC service layer. The security of this endpoint depends on whether the service layer enforces this validation. Without visibility into the service layer code (which is not in this worktree), this is flagged as a potential issue.

**Impact**: If the service layer does not enforce the redirect URI allowlist, an authorization code interception attack is possible.

**Fix**: Verify that the `OIDCService.HandleCallback` implementation validates `redirect_uri` against the configured allowlist. Add a handler-level pre-check as defense-in-depth.

---

### 4.3 High (P1) -- Security

#### S-3: `GetOIDCCallback` renders HTML with unescaped `code` and `state` query params (minor XSS risk)

**File**: `hub-server/internal/handler/oidc.go:89-113`
**Severity**: High (P1)
**Category**: XSS

The `code` and `state` parameters are extracted with `c.Query()` and NOT rendered into the HTML response -- only the fixed HTML templates are used. This is SAFE as written. However, if a future developer adds a diagnostic message like "Parameters received: code={{.Code}}" without proper escaping, it becomes an XSS vector.

**Impact**: Currently none (safe as written). Flagged as a future risk.

**Fix**: Add a comment warning against rendering query parameters in the HTML response. Use `html/template` instead of raw string constants for future maintainability.

---

#### S-4: `AttachmentHandler.Probe` returns `exists: true/false` without rate limiting per-user

**File**: `hub-server/internal/handler/attachment.go:48-74`
**Severity**: High (P1)
**Category**: Information Leakage / Enumeration

The probe endpoint (`POST /client/attachments/probe`) checks if an attachment hash exists. There is no per-user rate limit on this endpoint beyond the global rate limiter. An attacker could enumerate attachment hashes to discover file existence, potentially leaking information about which files other users have uploaded.

**Impact**: Hash enumeration could reveal file existence. With `sha256` hashes, brute-force enumeration is computationally infeasible, but targeted attacks (testing specific known file hashes) are possible.

**Fix**: Add per-user rate limiting on the probe endpoint. Consider requiring the user to be authenticated (it already does via `user_id` from context) and limiting probes to 10/minute per user.

---

#### S-5: `PublicHandler.Stats` exposes approximate user/message counts with bucketed values

**File**: `hub-server/internal/handler/public.go:36-61`
**Severity**: High (P1)
**Category**: Information Disclosure

```go
stats.TotalUsers = publicCountBucket(stats.TotalUsers)
// publicCountBucket: <10 shows 0, <100 rounds to 10, <1000 rounds to 100, >=1000 rounds to 1000
```

The public stats endpoint uses bucketing to avoid exact count leakage. This is good. However, the buckets are too wide for early-stage products: a project with 50 users shows `totalUsers: 50` (exact!), with 150 users shows `150` (still exact for many ranges). Only at 1000+ does the bucket provide meaningful obfuscation.

**Impact**: Exact user counts leaked for early-stage deployments. Combined with uptime data, an attacker can estimate growth rate.

**Fix**: Use coarser bands (e.g., <100->0, <500->100, <1000->500, <5000->1000, >=5000->5000) or use + notation ("100+").

---

### 4.4 Medium (P2) -- Security

1. **`AttachmentHandler.Upload`** -- `original_name` from POST form is sanitized via `sanitizeAttachmentFilename` which uses `filepath.Base` to strip directory traversal. Good. However, the temp file is created in the default temp directory (`os.CreateTemp("", ...)`) which may be world-readable depending on OS umask.

2. **`ws.go:47-53`** -- `InsecureSkipVerify` described in IH-2 above.

### 4.5 Low (P3) -- Security

1. **CORS headers** expose `X-Request-ID` and `X-API-Version` to all allowed origins. These are not sensitive headers, but the principle of least information exposure suggests limiting `ExposeHeaders`.

2. **Error response** in `response.go` includes `traceId` in all error responses. This is good for debugging but could be used for request correlation in targeted attacks. Acceptable trade-off.

3. **No CSP (Content-Security-Policy)** header set on any HTML responses (OIDC callback pages).

---

## 5. Performance Assessment

### 5.1 Architecture Performance Characteristics

- **Framework**: Gin (Go HTTP router) -- excellent performance baseline. Zero-allocation router for static paths.
- **Database**: PostgreSQL via GORM. No connection pooling metrics exposed in the handler layer (metrics defined but not wired).
- **Caching**: Redis for rate limiting and session member cache. Session member cache TTL = 5 minutes (`SessionMemberCacheTTL`).
- **WebSocket**: Per-connection goroutines (writeLoop + readLoop) with buffered channels (256 capacity). Token bucket rate limiting per connection (10 msg/s, burst 20).

### 5.2 High (P1) -- Performance

#### P-1: WebSocket `processIncoming` uses `context.Background()` for reads with no deadline

**File**: `hub-server/internal/handler/ws.go:163-195`
**Severity**: High (P1)
**Category**: Goroutine Leak / Resource Management

```go
func (h *WebSocketHandler) processIncoming(conn *ws.Conn) {
    for {
        _, data, err := conn.W.Read(context.Background())  // <-- NO DEADLINE
```

Both `writeLoop` and `processIncoming` use `context.Background()` for read/write operations with no deadline. If the client stops sending data (but does not close the TCP connection), the `Read` call blocks forever, holding a goroutine and memory. The heartbeat mechanism should handle this, but if the heartbeat fails for any reason (e.g., goroutine panic in the ws manager), the goroutine leaks.

**Impact**: Slow goroutine leak -- each leaked connection holds 2 goroutines (readLoop + writeLoop) and associated memory. Under a slow-connection attack, hundreds of goroutines could accumulate.

**Fix**: Add a read deadline that resets on each successful read, e.g., 2x the heartbeat interval.

---

#### P-2: `HealthHandler.readinessReport` queries DB, Redis, and migration state on every probe

**File**: `hub-server/internal/handler/health.go:78-133`
**Severity**: High (P1)
**Category**: Probe Overhead

```go
func (h *HealthHandler) readinessReport(c *gin.Context) gin.H {
    // DB ping
    sqlDB.Ping()
    // Redis ping
    h.cacheClient.GetRDB().Ping(c.Request.Context())
    // Migration verification
    repository.VerifyMigrations(h.dbConfig)
```

Each readiness probe performs 3 dependency checks (DB ping, Redis ping, migration state). Kubernetes/Docker healthchecks typically run every 10-30 seconds, so this is low overhead for small deployments. However, `VerifyMigrations` may involve a full table scan of the migration table. Under high probe frequency (e.g., multiple load balancers probing every 5 seconds), this adds unnecessary database load.

**Impact**: Background database load proportional to probe frequency x number of probing entities.

**Fix**: Cache the migration version result with a short TTL (e.g., 30 seconds) or make it a startup-only check with /ready returning cached result.

---

### 5.3 Medium (P2) -- Performance

1. **`public.go:40-52`** -- `Stats` endpoint runs 4 COUNT queries on every request with no caching. For a public-facing endpoint, this could be cached for 60 seconds.

2. **`GlobalRateLimit`** -- Uses `CheckRateLimit` per request, which involves a Redis pipeline with ZRemRangeByScore + ZCard + ZAdd + Expire. This is 4 Redis commands per API request. Acceptable but notable for high-throughput deployments.

3. **`message.go`** -- `SearchMessages` and `SearchSessionMessages` have no result limit enforcement at the handler level (relies on service layer).

### 5.4 Low (P3) -- Performance

1. `DefaultShutdownTimeout = 5s` -- graceful shutdown may not drain all in-flight requests.

2. `WSMessageRateLimit = 10` and `WSMessageBurst = 20` -- per-connection message rate limits are reasonable.

3. `EventBusPoolSize = 1024` -- worker pool for async events, reasonable for a mid-scale deployment.

---

## 6. Recommendations Prioritized by Impact

### 6.1 Immediate Action (This Sprint)

| # | Finding | Action | Effort |
|---|---------|--------|--------|
| R1 | **C-1** -- User settings leaks internal errors | Replace `FailWithMessage(c, errcode.ErrInternal, err.Error())` with `Fail(c, errcode.ErrInternal)` + `slog.Error`. | 5 min |
| R2 | **C-2** -- WS auth.ok race condition | Move `go h.writeLoop(conn)` before `h.sendFrame(conn, ...)`. | 2 min |
| R3 | **IC-1** -- Global rate limiter fails closed | Add fail-open config option; fail-open for non-auth paths, fail-closed for auth paths. | 30 min |
| R4 | **S-2** -- OIDC redirect_uri validation | Verify service-layer enforce allowlist; add handler-level pre-check. | 30 min |

### 6.2 Next Sprint

| # | Finding | Action | Effort |
|---|---------|--------|--------|
| R5 | **IH-1** -- No TLS documentation | Document reverse-proxy requirement in README + .env.example. | 15 min |
| R6 | **IH-3** -- Rate limit off-by-one | Change `countCmd.Val() >= int64(limit)` to `>`. | 1 min |
| R7 | **S-1** -- JWT key rotation | Add `kid` to JWT header, support multiple keys. | 4 hours |
| R8 | **S-4** -- Attachment probe enumeration | Add per-user rate limit (10/min) on probe endpoint. | 1 hour |
| R9 | **H-1** -- Ambiguous variable naming in session handler | Rename `userID` path param to `targetUserID`. | 5 min |
| R10 | **P-1** -- WS read deadline missing | Add read deadline with 2x heartbeat interval. | 15 min |

### 6.3 Backlog

| # | Finding | Action | Effort |
|---|---------|--------|--------|
| R11 | **M-3** -- Duplicate JSON normalization | Extract shared `normalizeJSONField` to `validation.go`. | 30 min |
| R12 | **IM-2** -- Separated WebSocket TCP timeout | Set `SetReadDeadline` on underlying `net.Conn`. | 15 min |
| R13 | **P-2** -- Health check overhead | Cache migration version with 30s TTL. | 15 min |
| R14 | **H-3** -- Upload body size validation | Assert `BodyLimit <= MaxUploadSize` at config validation. | 10 min |
| R15 | **S-5** -- Public stats precision | Use coarser bucketing bands. | 15 min |
| R16 | **IM-1** -- Redis timeout values | Bump ReadTimeout/WriteTimeout to 2-3s or configurable. | 5 min |

### 6.4 Strategic Investments

| # | Recommendation | Rationale |
|---|---------------|-----------|
| R17 | **Add service-layer integration tests** | Current test coverage is middleware-layer only. No handler+service+DB integration tests exist in this worktree. |
| R18 | **Implement JWT key versioning** | Enables zero-downtime secret rotation. Critical for production readiness. |
| R19 | **Add OpenTelemetry tracing** | Current observability is limited to structured logs + Prometheus metrics. Distributed tracing would dramatically improve debugging for the Hub-Edge-Desktop chain. |
| R20 | **Rate limit audit** | Multiple rate limiters (global IP, per-endpoint, WS IP, WS user conn, WS message) with different configurations. An end-to-end rate limit test suite should verify that limits are enforced correctly under concurrent load. |

---

## 7. Code Quality Summary

### Strengths

1. **Consistent handler pattern**: All 28 handler files follow the same interface/struct/constructor/method pattern, making the codebase highly navigable.
2. **Error code centralization**: `errcode/codes.go` provides a single source of truth for all API error codes with domain-specific naming.
3. **Middleware composition**: Clean separation of concerns with composable middleware (auth, rate limit, CORS, body limit, timeout, metrics, request ID, access log, device type check).
4. **WS infrastructure quality**: The `ws` package, `WSUserConnLimiter`, and `WSIPRateLimit` provide a robust WebSocket layer with proper indexing, per-user limits, and rate limiting.
5. **OIDC PKCE implementation**: Correctly implements PKCE flow with code_challenge/code_verifier, state validation, and proper error code segregation.
6. **Attachment security**: SHA-256 hash verification, MIME sniffing, filename sanitization, and content-type validation are all correctly implemented.

### Weaknesses

1. **Service layer invisibility**: The handler layer is well-auditable, but the service layer (imported from `internal/service`) is not present in this worktree. Many security and correctness guarantees depend on service-layer implementations we cannot inspect.
2. **Missing integration tests**: All test files test handlers or middleware in isolation. No handler-service-DB integration test exists.
3. **Duplicated JSON normalization**: `normalizeAgentProfileJSONField` and `normalizeTargetJSONField` are near-identical copies.
4. **Stale admin detection**: The `AuditHandler` hardcodes `isAdmin := false` with a comment "Future: check a role/permission field". The admin audit endpoint is effectively disabled.

---

## 8. Dependency Health

| Dependency | Version (go.mod) | Notes |
|---|---|---|
| `github.com/gin-gonic/gin` | v1.10.0 | Current, well-maintained |
| `github.com/coder/websocket` | v1.8.12 | WebSocket library, well-maintained |
| `github.com/golang-jwt/jwt/v5` | v5.2.1 | JWT library, current |
| `github.com/redis/go-redis/v9` | v9.7.0 | Redis client, current |
| `gorm.io/gorm` | v1.26.0 | ORM, current |
| `github.com/prometheus/client_golang` | v1.20.5 | Metrics, current |
| `golang.org/x/time/rate` | v0.8.0 | Rate limiting, current |

All dependencies are current and well-maintained. No known CVEs at time of audit.

---

## 9. Deployability Assessment

| Dimension | Status | Notes |
|---|---|---|
| Docker Compose | Pass | Full stack: PG 16 + Redis 7 + Hub Server with healthchecks |
| Health probes | Pass | `/health`, `/live`, `/ready` with component-level status |
| Graceful shutdown | Pass | `DefaultShutdownTimeout = 5s` configured |
| Config via env | Pass | All config driven by env vars, `.env` auto-load for dev |
| Admin port | Pass | Port 6060 for metrics/pprof, separate from API port 8080 |
| Migrations | Pass | Auto-run at startup via `repository.RunMigrations` |
| Missing: TLS | Fail | No native TLS; reverse proxy required but undocumented |
| Missing: Secrets mgmt | Fail | JWT secret is plain env var; no rotation mechanism |
| Missing: Readiness gate | Partial | `/ready` exists but probes all deps on every call |

---

## 10. Audit Scope and Limitations

**In scope**:
- `hub-server/internal/handler/` -- all 28 handler source files
- `hub-server/internal/middleware/` -- all 15 middleware files
- `hub-server/internal/jwtutil/` -- JWT and TokenDance ID validation
- `hub-server/internal/cache/` -- Redis initialization
- `hub-server/internal/config/` -- constants
- `hub-server/internal/errcode/` -- error codes
- `hub-server/internal/metrics/` -- Prometheus registration
- `hub-server/cmd/server-hub/main.go` -- entry point
- `docker-compose.yml`, `.env.example`, `api/openapi.yaml` (Hub sections)

**Out of scope** (not present in this worktree):
- `hub-server/internal/service/` -- service layer implementations
- `hub-server/internal/model/` -- data model definitions
- `hub-server/internal/repository/` -- database layer
- `hub-server/internal/ws/` -- WebSocket manager internals
- `hub-server/internal/app/` -- application assembly
- Runtime behavior / live testing / performance benchmarks

**Note on worktree**: The `chatview-migration` worktree (`feat/chatview-tokendance-migration`) is branched from `dev/delicious223` and does not include all files present in `dev/delicious233`. The service, model, repository, app, and ws packages were not accessible. Findings are based solely on handler, middleware, and infrastructure code visible in this worktree.

---

*End of audit report.*
