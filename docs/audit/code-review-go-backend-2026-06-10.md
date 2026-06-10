# Code Review: AgentHub Go Backend

**Date:** 2026-06-10
**Reviewer:** Claude Code (automated deep review)
**Scope:** hub-server (handler/service/repository/middleware), edge-server (adapters/lifecycle/store/cmd)
**Codebase size:** ~170 Go source files across hub-server, edge-server, and shared pkg

---

## Executive Summary

**Overall Code Quality Score: B+**

The AgentHub Go backend demonstrates mature, production-quality engineering. The codebase shows strong Go idioms, clean layered architecture (handler -> service -> repository), consistent error handling via a unified errcode system, good concurrency hygiene, and thorough test coverage. The main areas for improvement are repetitive error-handling boilerplate in handlers, a few concurrency edge cases, and some resource-management concerns in the edge-server process executor.

---

## Findings

### CRITICAL

_None found._

### HIGH

#### H-01: Fire-and-forget goroutines in ProcessExecutor may leak if context is cancelled mid-lifecycle

**File:** `edge-server/internal/lifecycle/process_executor.go:312-316, 335-341, 1367-1373`
**Description:** The `Cancel()` method spawns a goroutine for graceful process shutdown that uses `time.Sleep` with no context awareness. If the executor is shut down (e.g. server restart), these goroutines will continue to run until their sleep timers expire, potentially attempting to signal processes that have already been reaped. Similarly, `fireHubStream` spawns one goroutine per text chunk with no concurrency limit or cancellation propagation, which can produce unbounded goroutine fan-out during large output runs.
**Fix:** Use `time.NewTimer` + `select` on a context done channel in the graceful shutdown goroutine. For `fireHubStream`, batch chunks or use a semaphore/worker pool to bound concurrent callbacks.

#### H-02: Race condition in WS readLoop — auth timeout context not cancelled on early return

**File:** `hub-server/internal/handler/ws.go:86-99`
**Description:** The `readLoop` creates a 5-second timeout context with `context.WithTimeout` and defers `cancel()`. However, after the auth frame is validated, the method enters an infinite read loop at line 131 using `context.Background()`. If the auth frame is invalid and the method returns at lines 97-116, the `time.Sleep(100ms)` before `conn.Close()` runs while the deferred cancel fires concurrently. This is benign in practice but the real concern is that the writeLoop goroutine (started at line 62) has no guarantee that `conn.Send` is drained before the readLoop closes the connection, creating a potential write-after-close race on the channel.
**Fix:** Ensure `writeLoop` is started after `readLoop` returns (not concurrently), or use a `sync.WaitGroup` to coordinate shutdown. Remove the `time.Sleep(100ms)` hacks and rely on proper connection close ordering.

#### H-03: SQLite full-database rewrite on every persist

**File:** `edge-server/internal/store/sqlite_store.go:324-359`
**Description:** `syncPersist` calls `replaceSQLiteRows` which does `DELETE FROM agenthub_store_rows` followed by re-inserting every row. This is an O(n) rewrite on every single write operation (create run, update status, create item, etc.). Under load with many runs and items, this becomes a significant performance bottleneck and creates a window where a crash during persist loses the entire row table.
**Fix:** Implement incremental upsert (insert new rows, update changed rows, delete removed rows) instead of full-table replacement. Alternatively, batch persists with a debounce timer rather than persisting on every mutation.

### MEDIUM

#### M-01: Repetitive error-handling boilerplate across all handlers

**Files:** `hub-server/internal/handler/*.go` (every handler method)
**Description:** Every handler method repeats the identical pattern:
```go
if e, ok := err.(*errcode.Error); ok {
    Fail(c, e)
    return
}
Fail(c, errcode.ErrInternal)
```
This pattern appears ~40+ times across handler files. While correct, it is error-prone (a developer could forget the fallback) and adds significant LOC with no value.
**Fix:** Create a helper:
```go
func handleServiceError(c *gin.Context, err error) {
    if e, ok := err.(*errcode.Error); ok {
        Fail(c, e)
        return
    }
    Fail(c, errcode.ErrInternal)
}
```
This would reduce each handler's error block to a single `handleServiceError(c, err)` call.

#### M-02: Agent handler type-asserts service interface for projection methods

**File:** `hub-server/internal/handler/agent.go:250-254, 276-280, 299-303`
**Description:** `TaskApprovals`, `DecideTaskApproval`, and `TaskArtifacts` use `h.service.(agentTaskProjectionService)` to access team-related methods. This runtime type assertion will fail with `ErrInternal` if the concrete service doesn't implement the extended interface, which is a design smell. The handler depends on the service being a *specific* concrete type rather than an interface.
**Fix:** Either include the projection methods in the `AgentService` interface (with stub implementations that return `ErrNotImplemented`), or inject the projection service as a separate dependency in the handler constructor.

#### M-03: EventBus `NewBus` panics on pool creation failure

**File:** `hub-server/internal/service/eventbus.go:41`
**Description:** `NewBus()` calls `ants.NewPool(...)` and panics if it fails. This can happen under memory pressure or when system limits are hit. A panic in a library constructor is an unrecoverable crash for the entire server.
**Fix:** Return `(*Bus, error)` from `NewBus` and propagate the error to the caller.

#### M-04: JWKS cache uses a package-level global with no way to configure TTL per-instance

**File:** `hub-server/internal/jwtutil/tokendance.go:34`
**Description:** `defaultJWKSCache` is a package-level singleton with a hardcoded 1-hour TTL. If tests need different TTL or if the server needs to support multiple TokenDance ID providers, this singleton pattern is a blocker.
**Fix:** Make the JWKS cache a struct field on a `TokenDanceValidator` instance, created via a constructor that accepts the JWKS URI and TTL as parameters.

#### M-05: Timeout middleware goroutine runs handler without recovering panics

**File:** `hub-server/internal/middleware/timeout.go:146`
**Description:** The handler goroutine in `Timeout` does not have a `recover()` in its defer chain. If the handler panics (e.g. nil pointer from an unexpected state), the goroutine crashes silently without the `done` channel being closed, which would cause the `select` to wait on `ctx.Done()` instead of `done`. This is partially mitigated by Gin's own recovery middleware, but if the panic occurs in middleware or before Gin's recovery, it would leak.
**Fix:** Add a `defer func() { close(done); recover() }()` or similar panic recovery in the handler goroutine.

#### M-06: Rate limiter increments count before checking the limit

**File:** `hub-server/internal/middleware/rate_limit.go:35-47`
**Description:** The pipeline adds the current request's sorted-set entry (`ZAdd`) in the same pipeline as the count check (`ZCard`). This means the count includes the current request, so the actual allowed rate is `limit - 1` (not `limit`). When `countCmd.Val() >= limit` is checked after adding the entry, the first `limit` requests pass through, but the count was already incremented for the `limit+1`th request before it's rejected. This is functionally correct (it limits to `limit` requests per window) but the off-by-one is confusing and the rejected request still has its entry in the sorted set, slowly inflating it.
**Fix:** Move the `ZAdd` after the limit check (use a second pipeline or check-before-write pattern). Alternatively, document that the current request is always counted.

#### M-07: Missing input validation for message search `from`/`to` date parameters

**File:** `hub-server/internal/handler/message.go:387-389`
**Description:** `SearchMessages` and `SearchSessionMessages` accept `from` and `to` query parameters as raw strings and pass them directly to the repository layer without parsing or validation. The repository uses them as `created_at >= ?` and `created_at <= ?` arguments. While GORM parameterizes these (no SQL injection), garbage values would silently return zero results with no error.
**Fix:** Parse and validate the date strings as RFC3339 or a recognized date format. Return `ErrBadRequest` if the format is invalid.

#### M-08: Admin user list is cached once and never refreshed

**File:** `hub-server/internal/middleware/auth.go:197-217`
**Description:** `getAdminUsers()` uses `sync.Once` to read `AGENTHUB_ADMIN_USERS` from the environment. Once loaded, the list is frozen for the lifetime of the process. Adding or removing admin users requires a server restart.
**Fix:** Use a time-based cache (e.g. reload every 5 minutes) or a SIGHUP-based reload mechanism. This is acceptable for the current scale but worth noting.

#### M-09: DecisionLoop pendingApprovals map can grow unboundedly

**File:** `edge-server/internal/lifecycle/decision_loop.go:106-107`
**Description:** `pendingApprovals` is a `map[string]chan bool` that is populated by `AwaitApproval` and cleaned up by `ApproveTool`/`DenyTool`. If a tool call never receives an approval decision (e.g. the run is cancelled or times out), the channel and map entry remain forever. For long-running agents with many tool calls, this is a slow memory leak.
**Fix:** Add a cleanup method that is called when the loop terminates (or when the run is cancelled/fails) to close and remove all pending approval channels.

#### M-10: Hub callback client retries with fixed goroutines, no backoff pressure

**File:** `edge-server/internal/hub/callback.go:134-188`
**Description:** The `callback` method retries up to 3 times with exponential backoff per attempt. This is correct for a single callback. However, `fireHubStream` calls `callback` in a separate goroutine for *every text chunk*. With the default `hubCallbackChunkMaxBytes` of 16KB, a 1MB run output produces ~64 concurrent goroutines, each potentially retrying 3 times. Under Hub server degradation, this amplifies load.
**Fix:** Use a bounded worker pool or channel-based queue for hub callbacks, so that retry pressure is throttled.

### LOW

#### L-01: Error codes file has inconsistent indentation

**File:** `hub-server/internal/errcode/codes.go:88`
**Description:** `ErrUnauthorized` is indented with a tab while other vars use consistent alignment. Minor style issue.
**Fix:** Align with surrounding entries.

#### L-02: TransferOwnerReq has extra whitespace in struct field alignment

**File:** `hub-server/internal/handler/session.go:150-151`
**Description:** `NewOwnerID` and `NewOwnerUserID` have inconsistent tag alignment:
```go
NewOwnerID       string `json:"new_owner_id"`
NewOwnerUserID   string `json:"new_owner_user_id"`
```
**Fix:** Remove extra whitespace between field name and type.

#### L-03: shared errcode `EnvelopeForGin` omits traceId

**File:** `pkg/errcode/error.go:135-142`
**Description:** `EnvelopeForGin` does not include the `traceId` field, while `EnvelopeForGinWithTrace` does. The `EnvelopeForGin` function is unused in production code (all call sites use `EnvelopeForGinWithTrace`), but it remains exported and could be accidentally used.
**Fix:** Either deprecate/remove `EnvelopeForGin` or make it include `traceId` when present.

#### L-04: `isProductionEnv()` and `isProductionEnvironment()` duplicate logic

**Files:** `hub-server/internal/handler/ws.go:236-243`, `hub-server/internal/middleware/cors.go:63-70`
**Description:** Both check `AGENTHUB_ENV` and `GIN_MODE` for production detection with slightly different logic (ws.go also checks "prod", cors.go checks "prod" via `isProductionEnvironment`). Having two separate functions is a maintenance risk.
**Fix:** Consolidate into a single utility function in a shared package.

#### L-05: `resolveSDKAPIKey` in main.go logs API key value when it is passed directly

**File:** `edge-server/cmd/agenthub-edge/main.go:537-542`
**Description:** When the flag value is neither empty nor "env", the raw value is used as the API key. The `slog.Info` on line 457 logs `"available", a.Available()` which is fine, but the flag value itself could accidentally appear in debug-level logs if the build adapter logging is expanded.
**Fix:** Add a comment or explicitly avoid logging the resolved API key. Consider redacting in any future debug output.

#### L-06: Store `filterIDs` modifies slice in-place

**File:** `edge-server/internal/store/store.go:815-823`
**Description:** `filterIDs` uses `ids[:0]` to filter in-place, which modifies the backing array of the original slice. Callers assign the result back to the same field, so this is functionally correct, but it can be surprising and cause subtle bugs if the original slice is ever shared.
**Fix:** This is a common Go pattern and is fine here, but worth adding a comment for future maintainers.

#### L-07: TraceID counter is non-deterministic

**File:** `pkg/errcode/error.go:74-79`
**Description:** `NewTraceID()` uses `atomic.Uint64` to generate trace IDs like `trace_000001`. This is predictable and sequential, which makes it easier to guess valid trace IDs. For a trace ID (not a security token), this is acceptable, but if trace IDs are ever used for access control or correlation across trust boundaries, they should be randomized.
**Fix:** Acceptable as-is. No action needed unless trace IDs become security-sensitive.

#### L-08: Missing `context.Context` in DeviceService.Register and ListDevices

**File:** `hub-server/internal/handler/device.go:15-16`
**Description:** The `DeviceService` interface methods `Register` and `ListDevices` do not accept `context.Context`, unlike every other service interface. This prevents cancellation propagation and timeout enforcement.
**Fix:** Add `ctx context.Context` as the first parameter to both methods and propagate through the implementation.

#### L-09: `normalizeOIDCDeviceType` allows leading/trailing whitespace

**File:** `hub-server/internal/handler/oidc.go:174-181`
**Description:** The function calls `strings.TrimSpace` inside the switch, but this means `" desktop"` and `"desktop"` both match. This is intentional leniency, but it should be documented since the returned value is the trimmed version, not the original.
**Fix:** Add a brief comment documenting the intentional leniency.

#### L-10: WebSocket manager `StartHeartbeat` goroutine has no shutdown mechanism

**File:** `hub-server/internal/ws/manager.go:302-309`
**Description:** `StartHeartbeat` launches a goroutine with a `time.Ticker` that runs forever. The `Shutdown` method clears the connection maps but does not stop the heartbeat goroutine. If the ticker fires after `Shutdown`, it will iterate an empty map (harmless), but the goroutine itself leaks.
**Fix:** Return a `context.CancelFunc` or `stop()` function from `StartHeartbeat` and call it in `Shutdown`.

---

## Quick Wins (Easy Fixes, Big Impact)

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| 1 | **M-01: Extract `handleServiceError` helper** | 30 min | Removes ~200 lines of boilerplate, reduces bug surface |
| 2 | **M-03: Return error from `NewBus`** | 10 min | Prevents unrecoverable panics |
| 3 | **L-04: Consolidate `isProductionEnv`** | 15 min | Eliminates drift risk |
| 4 | **L-08: Add `context.Context` to DeviceService** | 20 min | Consistency with all other service interfaces |
| 5 | **M-09: Clean up pendingApprovals on loop exit** | 20 min | Prevents slow memory leak in decision loop |
| 6 | **L-10: Stop heartbeat goroutine in Shutdown** | 15 min | Clean server shutdown, no goroutine leak |
| 7 | **L-01: Fix errcode indentation** | 2 min | Code hygiene |

---

## Architecture Observations

### Strengths

1. **Clean layered architecture** — Handler -> Service -> Repository with interface-based dependency injection at each layer. Handlers define minimal service interfaces (e.g. `AuthService`, `MessageService`) enabling easy mocking and testability.

2. **Unified error system** — Shared `pkg/errcode` package with typed error codes, HTTP status mapping, trace IDs, and a consistent JSON envelope `{"error": {"code": "...", "message": "...", "traceId": "..."}}` across both Hub and Edge servers.

3. **Security posture** — Multiple defense layers:
   - JWT validation with issuer/audience checks
   - TokenDance ID RS256 with JWKS rotation
   - `RequireHubSession` middleware to prevent TokenDance bearer-only tokens from accessing product APIs
   - Admin list fail-closed
   - CORS loopback rejection in production
   - `bypassPermissions` rejection at executor level
   - Dangerous shell pattern detection via regex in SecurityHook

4. **Cache fallback** — `cache_fallback.go` uses reflection-based nil interface detection to transparently replace nil cache clients with NoOp implementations, preventing nil pointer panics in tests.

5. **WebSocket management** — The `ws.Manager` is well-designed with proper mutex usage, atomic closed flags, buffered channels with overflow detection, heartbeat with stale connection eviction, and clean `Shutdown` that unblocks both read and write loops.

6. **Event bus with goroutine pool** — Uses `ants` pool with panic recovery to prevent one bad handler from crashing the server.

7. **Test coverage** — Nearly every handler, service, middleware, and store has corresponding test files with visible test coverage.

### Areas for Improvement

1. **Handler error handling** — The 6-line boilerplate pattern is the single biggest DRY violation. A single helper function would eliminate it.

2. **Edge-server SQLite persistence** — The full-table rewrite approach does not scale. As the store accumulates runs, items, and artifacts, each mutation triggers an increasingly expensive persist.

3. **Goroutine lifecycle management** — Several fire-and-forget goroutines in the process executor and hub callback client lack cancellation propagation and bounding.

4. **Interface segregation** — `AgentHandler` uses runtime type assertion (`h.service.(agentTaskProjectionService)`) to access team-related methods, which violates the interface-segregation principle used everywhere else.
