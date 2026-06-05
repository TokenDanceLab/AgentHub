# Hub Server Code Audit Report

**Date**: 2026-05-24 | **Reviewer**: Automated deep code review | **Branch**: `dev/delicious233`
**Scope**: `D:\Code\AgentHub\hub-server\` — Full-stack IM backend (Gin/GORM/Redis/PostgreSQL)

---

## Summary

The Hub Server is a well-structured Go backend with clean handler-service-repository separation. The code is mostly idiomatic Go, with good use of GORM, Redis caching patterns, and WebSocket management. However, there are significant issues in dependency injection consistency, error handling, missing production-hardening features, and divergence between the documented spec and actual implementation. Two parallel server architectures exist, and the V1 API is entirely stubbed out.

**Overall Grade**: B+ (Production-capable with targeted fixes; not hardened)

---

## Severity Legend

| Level | Meaning |
|-------|---------|
| P0    | Production blocker — broken security, data loss risk, crash risk |
| P1    | High severity — major bug, missing critical feature, architectural problem |
| P2    | Medium severity — code smell, missing hardening, doc mismatch |
| P3    | Low severity — cosmetic, future improvement, nitpick |

---

## Architecture Diagram: Actual vs Documented

### Documented Architecture (from `docs/Server-Hub 架构设计.md`)

```
cmd/server-hub/main.go (entry)
    |
    v
internal/config/   (viper + YAML + env override)
internal/log/      (zap + zapslog)
    |
    v
internal/router/   (Gin route registration)
    |
    v
internal/middleware/ (auth, device_type_check, access_log, metrics, cors, rate-limit)
    |
    v
internal/handler/  (HTTP handlers — param validation)
    |
    v
internal/service/  (business logic + transactions)
    |
    v
internal/repository/ (GORM data access)
internal/ws/        (WebSocket connection manager)
internal/cache/     (Redis: route, seq, GetOrLoad cache-through)
internal/eventbus/  (in-process ants goroutine pool)
```

### Actual Architecture (from code)

```
cmd/server-hub/main.go (monolith: all wiring, event subscribers, goroutines)
    |                          ^---- pprof admin server
    |                          ^---- metrics goroutine
    |                          ^---- timeout scanner goroutine
    |                          ^---- legacy seq sync goroutine
    v
internal/config/   (viper) — uses global `Cfg` singleton
internal/log/      (zap + zapslog)
    |
    v
internal/router/router.go (Gin route registration — takes 11 handler params)
    |
    v
internal/middleware/
  ├── auth.go       (Gin auth middleware — reads config.Cfg.JWT.Secret global)
  ├── device_type.go (checks device_type from Gin context)
  ├── access_log.go  (structured access log)
  └── metrics.go     (Prometheus middleware)
  (MISSING: cors, rate-limit — documented but NOT implemented)
    |
    v
internal/handler/  (11 handlers)
  ├── DeviceHandler — uses raw *gorm.DB (pattern A)
  ├── All others — use *service.XxxService (pattern B)
    |
    v
internal/service/  (8 services)
  ├── AuthService      — uses raw *gorm.DB, config.Cfg global
  ├── MessageService   — uses *gorm.DB + *Bus
  ├── ContactService   — uses *gorm.DB + *Bus
  ├── SessionService   — uses *gorm.DB
  ├── AgentService     — uses *gorm.DB + *Bus + *ws.Manager
  ├── NotificationService — uses *gorm.DB + *ws.Manager
  ├── AttachmentService — uses *gorm.DB
  └── Bus (eventbus.go) — ants pool, map[string][]EventHandler
    |
    v
internal/repository/ (all functions take *gorm.DB as first param)
    |
    v
Global singletons: repository.DB, cache.RDB, config.Cfg
```

### Key Divergences

1. **Docs describe `cors` and `rate-limit` middleware** — these do NOT exist in the code.
2. **Docs describe `message_reads` table** and batch read receipt endpoints (`POST /client/messages/{id}/read`, `GET /client/messages/{id}/reads`) — the endpoints exist only for session-level mark-read (`POST /client/sessions/:id/read`), per-message read receipts documented do not match the actual implementation which uses `last_read_seq` on `session_members` table only.
3. **Docs say msg recall timeout is 2 minutes** — actual code uses 5 minutes (`time.Since(msg.CreatedAt) > 5*time.Minute`).
4. **Docs claim `swaggo/swag`** for OpenAPI generation — no `swaggo` imports, no `api/swagger.yaml`, no `@Summary` annotations in code.
5. **Docs list `GET /web/desktop-status` and `GET /edge/agent-tasks/pending`** endpoints — not implemented.
6. **Docs say private sessions use `(min_user_id, max_user_id)` unique constraint** — actual code uses the `FindPrivateSessionBetween` SQL query approach, not a DB constraint.
7. **Two parallel server architectures exist**:
   - `internal/router/` + Gin handlers (operational, full-featured)
   - `internal/httpserver/` + `internal/api/` + `internal/auth/` (V1 API, all stubs returning 501, separate HTTP mux with its own auth middleware, NOT wired to main.go)

---

## Findings

### P0 — Production Blockers

#### P0-1: JWT secret is in plaintext config files — no production secret management

- **File**: `configs/config.yaml:20`, `configs/config.docker.yaml:20`
- **Line**: `jwt.secret: dev-secret-change-in-production`
- **What's wrong**: JWT signing secret is hardcoded in YAML config files that are committed to the repository. If this ever makes it to production with a real secret in config, anyone with repo access can forge tokens.
- **Suggested fix**: Load JWT secret from environment variable with NO default, or from a secret manager (Vault, AWS Secrets Manager). Add validation at startup: if `jwt.secret` equals "dev-secret-change-in-production", refuse to start unless `AGENTHUB_ENV=development`.

#### P0-2: Admin pprof port 6060 exposes profiling endpoints WITHOUT authentication

- **File**: `cmd/server-hub/main.go:294-300`
- **Lines**:
  ```go
  adminMux.HandleFunc("/debug/pprof/", pprof.Index)
  adminMux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
  adminMux.HandleFunc("/debug/pprof/profile", pprof.Profile)
  adminMux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
  adminMux.HandleFunc("/debug/pprof/trace", pprof.Trace)
  adminMux.Handle("/metrics", promhttp.Handler())
  ```
- **What's wrong**: pprof endpoints allow heap dumps, CPU profiling, and goroutine traces. In production, exposed pprof is an information disclosure and potential DoS vector. The `/metrics` endpoint exposes internal Prometheus metrics to anyone who can reach port 6060.
- **Suggested fix**: Bind admin server to `127.0.0.1` only (not `0.0.0.0`), or add a separate auth middleware to the admin mux. The docs already note this: "production should configure firewall to only allow internal network access" — but code should enforce this, not docs.

#### P0-3: EventBus recovers panics silently — data loss on panic

- **File**: `internal/service/eventbus.go:58-64`
- **Lines**:
  ```go
  err := b.pool.Submit(func() {
      defer func() {
          recover()    // <-- panics are swallowed, no logging
          b.pending.Add(-1)
      }()
      h(ctx, event)
  })
  ```
- **What's wrong**: The `recover()` call silently swallows panics. If an event handler panics (nil pointer, slice out of bounds), the panic is completely lost. No log, no metric, no alert. The event is silently dropped. This is especially dangerous for `message.new` events — if the handler panics, messages won't be pushed via WebSocket and users will not know.
- **Suggested fix**: Log the panic with stack trace and increment a Prometheus counter `eventbus_panics_total`.

---

### P1 — High Severity

#### P1-1: Inconsistent dependency injection — DeviceHandler bypasses service layer

- **File**: `internal/handler/device.go:15-17`, `cmd/server-hub/main.go:123`
- **Lines**:
  ```go
  type DeviceHandler struct {
      db *gorm.DB    // <-- takes raw DB directly, not a service
  }
  ```
  vs all other handlers:
  ```go
  type AuthHandler struct {
      service *service.AuthService   // <-- takes a service
  }
  ```
- **What's wrong**: `DeviceHandler` directly uses `repository.DB` and calls `repository.UpsertDevice` directly. There is no `DeviceService`. This breaks the handler-service-repository layering contract. The handler directly creates `model.Device` structs and interacts with the repository.
- **Suggested fix**: Create a `DeviceService` wrapping `repository.UpsertDevice` with authorization checks (ensure user can only register their own devices). Move business logic from handler to service.

#### P1-2: Global config singleton (`config.Cfg`) creates tight coupling and test isolation problems

- **File**: `internal/config/config.go:63`
- **Line**: `var Cfg *Config`
- **What's wrong**: The global `Cfg` variable is accessed directly in:
  - `internal/middleware/auth.go:31` — `config.Cfg.JWT.Secret`
  - `internal/service/auth.go:87-88` — `config.Cfg.JWT.Secret`, `config.Cfg.JWT.AccessTTL`
  - `internal/service/attachment.go:65` — `config.Cfg.Upload.MaxSize`
  - `internal/router/router.go:31,40,etc` — `config.Cfg.JWT.Secret`
- This makes unit testing difficult (tests must set the global), prevents running multiple server instances with different configs, and is a concurrency hazard if config is ever reloaded.
- **Suggested fix**: Pass config through constructor injection or a context value. The pattern used by `internal/auth/middleware.go` (take secret as constructor param) is correct. Apply this pattern everywhere.

#### P1-3: Global DB handle (`repository.DB`) — same tight coupling issue

- **File**: `internal/repository/db.go:14`
- **Line**: `var DB *gorm.DB`
- **What's wrong**: All handler/service constructors that take `db *gorm.DB` receive `repository.DB` from `main.go`. But repository functions can also access `DB` directly. Several service constructors (AuthService, SessionService, etc.) accept `*gorm.DB` as a param, which is better, but the global still exists as a backdoor.
- **Suggested fix**: Remove the global `DB` variable. Pass `*gorm.DB` through all constructors. The `repository.RunMigrations` function can accept `*config.DBConfig` independently.

#### P1-4: No rate limiting on login endpoint

- **File**: `cmd/server-hub/main.go:331`, `internal/router/router.go:25-28`
- **What's wrong**: The `/client/auth/login` and `/client/auth/register` endpoints have no rate limiting. An attacker can brute-force passwords or spam registrations. The architecture docs describe `rate-limit` middleware — it does not exist in the codebase.
- **Suggested fix**: Implement token-bucket or sliding-window rate limiting middleware using Redis. Apply at minimum to login (5 req/min per IP) and register (3 req/min per IP). Use `golang.org/x/time/rate` or Redis-based rate limiter.

#### P1-5: Content injection vulnerability in text messages via naive JSON construction

- **File**: `internal/service/message.go:94-95`
- **Lines**:
  ```go
  if req.ContentType == "text" {
      content = `{"text":"` + strings.ReplaceAll(req.Content, `"`, `\"`) + `"}`
  }
  ```
- **What's wrong**: Manual JSON construction is fragile. The `strings.ReplaceAll` escapes double quotes, but does not escape backslashes (`\`), newlines, or other control characters that could break JSON. If a user sends `hello\"world`, it becomes `{"text":"hello\\"world"}` which is invalid JSON.
- **Suggested fix**: Use `json.Marshal`:
  ```go
  textPayload := map[string]string{"text": req.Content}
  jsonBytes, _ := json.Marshal(textPayload)
  content = string(jsonBytes)
  ```

#### P1-6: No request timeout middleware on Gin routes

- **File**: `cmd/server-hub/main.go:331-332`, `internal/router/router.go:11`
- **What's wrong**: Individual route handlers have no timeout. A slow database query or a deadlocked Redis call will block the goroutine indefinitely (until the HTTP server timeout of 30s ReadTimeout / 60s WriteTimeout). There is no per-request context deadline.
- **Suggested fix**: Add Gin middleware that wraps `c.Request.Context()` with a timeout (e.g., 15s for most routes, 30s for uploads).

---

### P2 — Medium Severity

#### P2-1: N+1 query in ListContacts — one DB query per friend

- **File**: `internal/service/contact.go:217-240`
- **Lines**:
  ```go
  for _, f := range friends {
      friend, err := repository.GetUserByID(s.db, f.FriendID)  // N+1
      ...
  }
  ```
- **What's wrong**: For N friends, this makes N+1 database queries. With 200 friends, that's 201 separate queries.
- **Suggested fix**: Collect all friend IDs, do a single `WHERE id IN (?)` query, then build a map. Pattern already used correctly in `message.go:toMessageResponses`.

#### P2-2: N+1 query in ListFriendRequests — one DB query per request

- **File**: `internal/service/contact.go:149-172`
- **Lines**:
  ```go
  for _, r := range requests {
      sender, err := repository.GetUserByID(s.db, r.UserID)  // N+1
      ...
  }
  ```
- **Same issue as P2-1.** Collect sender IDs and batch-query.

#### P2-3: SystemPrompt, ToolWhitelist, ModelParams fields use `jsonb` but stored as Go `string`

- **File**: `internal/model/custom_agent.go:17-20`
- **Lines**:
  ```go
  SystemPrompt   string `gorm:"type:text;not null"`
  CapabilityTags string `gorm:"type:jsonb;default:'[]'"`
  ToolWhitelist  string `gorm:"type:jsonb;default:'[]'"`
  ModelParams    string `gorm:"type:jsonb;default:'[]'"`
  ```
- **What's wrong**: `CapabilityTags`, `ToolWhitelist`, and `ModelParams` are declared as `string` but stored as `jsonb`. If the input is not valid JSON, PostgreSQL will reject it with an opaque error. There's no validation. This applies to the `handler/custom_agent.go` which receives these as raw `string` from JSON input.
- **Suggested fix**: Use `json.RawMessage` type, or unmarshal into `[]string`/`map[string]interface{}` and marshal back for storage. Add validation in the handler.

#### P2-4: `FailWithMessage` panics on nil error's HTTPStatus

- **File**: `internal/handler/response.go:34-39`
- **Lines**:
  ```go
  func FailWithMessage(c *gin.Context, e *errcode.Error, message string) {
      c.JSON(e.HTTPStatus, Response{...})  // e.HTTPStatus could be 0 → 200 status
  }
  ```
- **What's wrong**: `Fail` checks `if status == 0 { status = http.StatusInternalServerError }` but `FailWithMessage` does not. If called with `errcode.OK` (HTTPStatus=0) by mistake, it returns HTTP 200 with an error code in the body.
- **Suggested fix**: Add the same guard: `if e.HTTPStatus == 0 { e = errcode.ErrInternal }`

#### P2-5: CancelTask uses `task.AgentInstanceID` as `session_id` in cancel event

- **File**: `internal/service/agent.go:269-274`
- **Lines**:
  ```go
  s.bus.Publish(ctx, Event{Type: "agent.cancel", Payload: map[string]string{
      "task_id":            taskID,
      "agent_instance_id":  task.AgentInstanceID,
      "session_id":         task.AgentInstanceID,  // <-- BUG: should be resolved from agent instance
      "triggered_by":       task.TriggeredByUserID,
  }})
  ```
- **What's wrong**: `session_id` is set to `task.AgentInstanceID` instead of the actual session ID. The comment says "will be resolved from agent instance" but it never is. The event subscriber in `main.go:237-245` pushes to `payload["session_id"]` which is the wrong value.
- **Suggested fix**: Look up the `AgentInstance` to get `ai.SessionID`, same as `HandleTaskFail` does at line 412-415.

#### P2-6: WebSocket writeLoop doesn't recover from panics

- **File**: `internal/handler/ws.go:47-57`
- **Lines**:
  ```go
  func (h *WebSocketHandler) writeLoop(conn *ws.Conn) {
      ctx := context.Background()
      for data := range conn.Send {
          err := conn.W.Write(ctx, websocket.MessageText, data)
          if err != nil {
              slog.Warn("ws write error", "conn_id", conn.ID, "err", err)
              return        // returns without closing conn.W properly
          }
      }
      conn.W.Close(websocket.StatusNormalClosure, "")
  }
  ```
- **What's wrong**: If `conn.W.Write` panics (rare but possible with WebSocket), the goroutine crashes. Also, when a write error occurs, the function returns without closing the connection — the read loop's `defer h.manager.Unregister(conn.ID)` will handle cleanup, but the connection's `W` is left dangling.
- **Suggested fix**: Add `defer conn.W.Close(...)` at the top. Add panic recovery.

#### P2-7: `HandleTaskStream` uses `repository.AllocateSeqID` (DB direct) instead of cache fallback

- **File**: `internal/service/agent.go:326-333`
- **Lines**:
  ```go
  err = s.db.Transaction(func(tx *gorm.DB) error {
      seq, err := repository.AllocateSeqID(tx, ai.SessionID)
      ...
  })
  ```
- **What's wrong**: Unlike `MessageService.SendMessage` which uses the graceful `allocateSeq` method (Redis INCR with DB fallback), `HandleTaskStream` and `HandleTaskDone` directly use `repository.AllocateSeqID` which always goes through the DB. This bypasses the Redis cache, causing unnecessary DB load for agent streaming messages, which are likely the highest message volume.
- **Suggested fix**: Use `s.allocateSeq` (or extract `MessageService.allocateSeq` into a shared method).

#### P2-8: `HandleTaskDone` and `HandleTaskStream` don't generate `client_msg_id`

- **File**: `internal/service/agent.go:312-318`, `internal/service/agent.go:364-370`
- **What's wrong**: Agent messages created by `HandleTaskStream` and `HandleTaskDone` have an empty `ClientMsgID` field. The `Message` model has `ClientMsgID string gorm:"type:uuid;not null"` — if the DB column is `NOT NULL`, this would cause a constraint violation. The GORM model doesn't enforce it at the Go level (no `binding:"required"`), but the DB migration (`0006_messages.up.sql`) does: `client_msg_id uuid NOT NULL`.
- **Suggested fix**: Generate a `ClientMsgID` for agent messages (e.g., `uuidv7.Must()`). This is critical — without it, these INSERTs would fail at the DB level if the non-null constraint is enforced.

#### P2-9: `UpsertDevice` ON CONFLICT targets `id` but unique index is on `(user_id, device_type)`

- **File**: `internal/repository/device.go:10-14` vs `internal/model/device.go:7-8`
- **Lines (repo)**:
  ```go
  Columns: []clause.Column{{Name: "id"}},
  ```
- **Lines (model)**:
  ```go
  DeviceType string `gorm:"type:varchar(16);not null;index:idx_devices_user_type,unique"`
  ```
- **What's wrong**: The GORM tag defines a composite unique index on `(user_id, device_type)`, but `UpsertDevice` uses `ON CONFLICT (id)` for upsert. This means if a device with the same `user_id` + `device_type` but a DIFFERENT `id` is inserted, it will fail with a unique constraint violation. Conversely, if the same `id` but different `user_id`/`device_type` is re-inserted, it will silently update.
- **Suggested fix**: Change ON CONFLICT to target `(user_id, device_type)` columns, not `id`.

#### P2-10: `sendFrame` drops messages silently when channel is full

- **File**: `internal/handler/ws.go:143-147`, `internal/ws/manager.go:164-167`
- **Lines**:
  ```go
  select {
  case conn.Send <- data:
  default:    // channel full — message silently dropped
  }
  ```
- **What's wrong**: Both `wsHandler.sendFrame` and `manager.PushToConn` use non-blocking channel sends. If the 64-buffer channel is full (slow client), messages are silently dropped. This means a slow/overloaded client will miss WebSocket events with NO log, NO metric, and NO error.
- **Suggested fix**: Log a warning when the send channel is full. Increment a `ws_dropped_frames_total` counter. Consider increasing buffer size or implementing a ring buffer for the most recent N frames.

#### P2-11: `listFriendRequests` silently skips errors in User lookup without logging

- **File**: `internal/service/contact.go:156-170`
- **Lines**:
  ```go
  sender, err := repository.GetUserByID(s.db, r.UserID)
  if err != nil {
      continue    // silently skips, no log
  }
  ```
- **What's wrong**: If a user lookup fails (not just RecordNotFound), the friend request is silently removed from the response. The user sees fewer requests than actually exist with no indication of why.
- **Suggested fix**: Log the error and include a placeholder ("Unknown User") rather than silently dropping. Only skip for `gorm.ErrRecordNotFound`.

---

### P3 — Low Severity

#### P3-1: Inconsistent parameter names in routes

- **File**: `internal/router/router.go`
- Some routes use `:user_id` (contacts), others use `:id` (sessions, messages, agents). This is confusing for API consumers.
- **Suggested fix**: Use `:user_id` for user identifiers consistently.

#### P3-2: Hardcoded magic numbers

- **File**: multiple files
- `limit := 50` (default pagination) in `handler/message.go:59`, `handler/notification.go:25`
- `maxPinsPerSession = 50` in `service/message.go:20`
- `24 * time.Hour` task expiry in `service/agent.go:200`
- `5 * time.Minute` recall window in `service/message.go:303`
- `1024` eventbus pool size in `service/eventbus.go:27`
- `64` WebSocket send buffer in `ws/manager.go:63`
- **Suggested fix**: Move to named constants in a centralized `internal/constants` package or use config values.

#### P3-3: `go.mod` declares `go 1.25.6` which doesn't exist as of 2026-05

- **File**: `go.mod:3`
- **Line**: `go 1.25.6`
- **What's wrong**: Go 1.25 is not a released version. Go 1.24 is the latest stable. This suggests the project was scaffolded with a future Go version or a custom toolchain.
- **Suggested fix**: Set to a real Go version: `go 1.24.0` or `go 1.23.0`.

#### P3-4: Missing `Workspace` model despite migrations creating `workspaces` table

- **File**: `migrations/0009_workspaces.up.sql` exists, but no `internal/model/workspace.go`
- **What's wrong**: Migration 0009 creates the workspaces table, but there is no corresponding GORM model. The architecture docs describe the `workspaces` table (section 5.11), but no code model exists.
- **Suggested fix**: Create `internal/model/workspace.go` or remove the migration if unused.

#### P3-5: Indentation inconsistency in `agent.go`

- **File**: `internal/service/agent.go:77`
- **Lines**:
  ```go
  ca.OwnerUserID = ownerID
  if ca.CapabilityTags == "" {       // inconsistent indentation
      ca.CapabilityTags = existing.CapabilityTags }
  ```
- **Suggested fix**: Run `gofmt` / `goimports`.

#### P3-6: `cmd/agenthub-hub/main.go` — secondary entry point with unclear purpose

- **File**: `cmd/agenthub-hub/main.go`
- **What's wrong**: There are two cmd entry points (`cmd/server-hub/main.go` and `cmd/agenthub-hub/main.go`). The `agenthub-hub` one is a shorter file. There are also two server architectures (Gin-based and net/http-based via `internal/httpserver`). This duplication creates confusion.
- **Suggested fix**: Consolidate into one entry point or document clearly why two exist.

#### P3-7: `log.Sync()` errors are ignored

- **File**: `internal/log/log.go:55-58`
- **Lines**:
  ```go
  func Sync() {
      if logger != nil {
          _ = logger.Sync()  // ignored error
      }
  }
  ```
- **Suggested fix**: Log the sync error at WARN level instead of ignoring.

#### P3-8: Test fixtures hardcoded in `tests/uploads/`

- **File**: `tests/uploads/b9/4d/...` and `tests/uploads/f4/35/...`
- **What's wrong**: Binary test fixture files are committed. It is unclear what they contain or how they were generated.
- **Suggested fix**: Generate test fixtures in `TestMain` setup, or document their provenance.

#### P3-9: README.md not reviewed

The `README.md` at the root of `hub-server/` was not read in this review. Its accuracy vs actual code is unknown.

---

## Top 5 Most Impactful Fixes

### 1. Fix P0-1 (JWT secret management) + P0-2 (pprof auth)
**Effort**: 2 hours | **Risk**: Data breach / token forgery
Move JWT secret to environment-only, bind admin server to localhost, add auth middleware to `/metrics`.

### 2. Fix P1-5 (JSON injection) + P2-8 (agent messages missing client_msg_id)
**Effort**: 30 minutes | **Risk**: Data corruption / message delivery failures
Use `json.Marshal` for text message content. Generate `client_msg_id` for agent-created messages. This is a correctness bug that could cause agent messages to fail silently at the DB level.

### 3. Fix P2-5 (CancelTask wrong session_id)
**Effort**: 15 minutes | **Risk**: Cancel events routed to wrong session
Resolve session_id from AgentInstance before publishing the cancel event. This is a clear bug where the `agent.cancel` WebSocket frame goes to the wrong push target (agent instance ID instead of session ID).

### 4. Implement rate limiting (P1-4) + request timeout middleware (P1-6)
**Effort**: 4 hours | **Risk**: Brute-force attacks / goroutine leaks
Add rate limiting to auth endpoints using Redis. Add `context.WithTimeout` middleware to prevent slow handler goroutine accumulation.

### 5. Eliminate global singletons (P1-2 + P1-3) + create DeviceService (P1-1)
**Effort**: 6 hours | **Risk**: Testability / architectural debt
Pass `*config.Config` and `*gorm.DB` via constructor injection consistently. Create `DeviceService` to complete the handler-service-repository layering for the device module.

---

## Additional Observations

### Strengths
- Clean handler → service → repository separation is consistently followed (except DeviceHandler).
- Error handling with typed error codes (`errcode.Error`) is excellent — consistent, grep-able, with proper HTTP status mapping.
- `GetOrLoad[T]` generic cache-through with `singleflight` deduplication is excellent design — prevents cache stampede and thundering herd.
- WebSocket manager with per-user/per-device routing and heartbeat is solid.
- EventBus with `ants` goroutine pool is a good choice for async event processing without unbounded goroutine creation.
- `client_msg_id` idempotency for messages with duplicate-detection fallback is well-implemented.
- UUIDv7 for time-ordered primary keys is the right choice for B-tree index friendliness.
- Redis `INCR` + DB fallback for sequence generation is a well-designed dual-write pattern.
- Test coverage is good — integration tests cover auth, contacts, sessions, messages, pins, forwards, search, attachments, group management, agent tasks, and edge cases.
- The architecture docs are comprehensive and well-organized — they genuinely describe the system accurately (minor nits aside).

### Architecture Judgments
- The monolith wiring in `cmd/server-hub/main.go` (300+ lines of event subscribers, goroutines, wiring) should be refactored into a `internal/app` or `internal/server` package for testability.
- The two parallel server architectures (Gin vs net/http + stub V1 API) need resolution — either finish the V1 migration or remove the stub code.
- Using `*gorm.DB` as the first parameter for all repository functions is idiomatic but prevents repository interface abstraction for unit testing. Consider defining repository interfaces for services that need them mocked.
- The `Bus` event system is synchronous within the pool (no event ordering guarantees across goroutines). For `message.new` events, this means a fast consumer could receive an `agent.done` event before the final `message.new` for the same session.

### Concurrency Safety Notes
- `ws.Manager` correctly uses `sync.RWMutex` for connection registry access.
- `EventBus` correctly uses `sync.RWMutex` for handler registry with `RLock` during publish.
- `cache.GetOrLoad` correctly uses `singleflight.Group` to prevent thundering herd.
- `metrics.Register` correctly uses `sync.Once`.
- The read loop in `ws.go` reads `conn.UserID` without holding `conn.mu` — but this field is only written once during `SetAuth` and never changed afterward, so this is safe (write-once-read-many pattern).

---

## Document Accuracy Matrix

| Doc Claim | Match? | Detail |
|-----------|--------|--------|
| RESTful API with Gin | YES | `/client/*`, `/web/*`, `/edge/*` groups |
| Unified response format `{code, message, data}` | YES | `Response` struct in `handler/response.go` |
| Auth middleware (JWT Bearer) | YES | `internal/middleware/auth.go` |
| Device type check middleware | YES | `internal/middleware/device_type.go` |
| Access log middleware (structured) | YES | `internal/middleware/access_log.go` using `slog` |
| CORS middleware | NO | Not implemented — documented but missing |
| Rate limit middleware | NO | Not implemented — documented but missing |
| Swagger/OpenAPI generation | NO | `swaggo/swag` not imported, no annotations, no `api/` output |
| Message recall: 2 min window | NO | Actual: 5 min (`5*time.Minute`) |
| `message_reads` table for per-message receipts | NO | Table exists in migrations, but code uses `last_read_seq` on `session_members` |
| `GET /web/desktop-status` endpoint | NO | Not implemented |
| `GET /edge/agent-tasks/pending` endpoint | NO | Not implemented |
| `GET /edge/workspaces` / `DELETE /edge/workspaces` | NO | Not implemented |
| `POST /client/messages/{id}/read` (per-message) | NO | Not implemented (only session-level mark-read) |
| `GET /client/messages/{id}/reads` (read receipts list) | NO | Not implemented |
| `GET /client/sessions/{id}` (session detail) | NO | Not implemented |
| `PUT /client/sessions/{id}/pin`, `/archive`, `/mute` | PARTIAL | Consolidated into `PUT /settings` with body params |
| `GET /client/sessions/{id}/members` | NO | Not implemented |
| `POST /client/sessions/{id}/transfer` (path name) | PARTIAL | Actual: `POST /transfer-owner` |
| Docker Compose Redis port 6379 | NO | Config uses 6379 in docker, but 6380 in default config |
| `(min_user_id, max_user_id)` private session constraint | NO | Not used |
| Agent dispatch payload includes custom_agent_id | YES | `dispatchPayload` struct matches docs |
| Redis `HEXISTS` for online check | PARTIAL | Uses `HLEN > 0` for `IsOnline`, not `HEXISTS` |
| WS: 30s heartbeat | YES | `StartHeartbeat` uses 30s ticker |
| WS: 5s auth timeout | YES | First read has 5s context timeout |
| WS: `device_id` in auth frame | NO | Docs show `device_id` in payload, but code extracts it from JWT claims, not the frame payload |
