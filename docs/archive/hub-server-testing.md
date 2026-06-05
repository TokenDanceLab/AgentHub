# Hub Server Test Coverage, Quality & Stability Review

**Date:** 2026-05-24  
**Branch:** `dev/delicious233`  
**Reviewed by:** Automated analysis via `go test ./... -cover -short -count=1`

---

## 1. Coverage Breakdown Per Package

### Test Results (short mode, no external services)

| Package | Coverage | Status | Notes |
|---|---|---|---|
| `internal/auth` | **89.1%** | PASS | Only package with unit tests. Good. |
| `tests` | (ran) | PASS | 26 integration tests, all pass. Requires PostgreSQL + Redis. |
| `internal/api` | 0.0% | No tests | Stub-only package (all endpoints return "not_implemented"). |
| `internal/cache` | 0.0% | No tests | Critical: Redis ops, GetOrLoad, Invalidate, seq, routes. |
| `internal/config` | 0.0% | No tests | Config loading with Viper. |
| `internal/errcode` | 0.0% | No tests | Error constants only — trivial but testable. |
| `internal/handler` | 0.0% | No tests | 10 HTTP handlers. Tested only indirectly via integration tests. |
| `internal/httpserver` | 0.0% | No tests | Simple HTTP server wrapper. |
| `internal/jwtutil` | 0.0% | No tests | JWT generation, parsing, refresh token crypto. |
| `internal/log` | 0.0% | No tests | Logger setup with Zap/lumberjack. |
| `internal/metrics` | 0.0% | No tests | Prometheus metric registration. |
| `internal/middleware` | 0.0% | No tests | Auth, access log, Prometheus, device type middleware. |
| `internal/model` | 0.0% | No tests | GORM model definitions (no logic to test). |
| `internal/repository` | 0.0% | No tests | 10+ files of DB queries. Tested only via integration tests. |
| `internal/router` | 0.0% | No tests | Route wiring — tested implicitly via integration tests. |
| `internal/service` | 0.0% | No tests | **Critical gap**: Auth, Session, Message, Agent, Contact, EventBus. All business logic. |
| `internal/ws` | 0.0% | No tests | WebSocket Manager, Frame marshal/unmarshal. |
| `cmd/server-hub` | 0.0% | No tests | Main entry point. |
| `cmd/agenthub-hub` | 0.0% | No tests | Stub entry point (not active). |
| `pkg/uuidv7` | 0.0% | No tests | UUID generation utility. |

**Summary:** 1 of 19 packages has unit tests. The `tests` package provides broad integration coverage but all internal packages lack isolated unit tests.

---

## 2. Test Quality Assessment

### 2.1 `internal/auth/middleware_test.go` — EXCELLENT (89.1% coverage)

**Test cases covered (10 tests):**
- No auth header (401)
- Invalid token (401)
- Expired token (401)
- Valid token pass-through (200)
- Health check skip auth
- Path prefix wildcard skip
- Claims injected into context
- Missing sub claim (401)
- Wrong signing method (401)
- UserFromContext with nil context

**Quality:** This is the gold standard for this project. Tests behavior, covers edge cases, tests error paths, uses clean test helpers (`createToken`, `createExpiredToken`). One test (`TestWrongSigningMethod`) actually tests wrong secret, not wrong signing method — minor semantics issue.

### 2.2 `tests/api_test.go` — GOOD (integration)

Covers 8 test groups:
- `TestAuth`: Register, Login+Me, WrongPassword, NoToken, RefreshToken, ChangePassword, UpdateProfile, Logout
- `TestContacts`: Search, Send/Accept request, Contact list, Remark, Block/Unblock
- `TestSessions`: CreatePrivate, DuplicatePrivate, CreateGroup, SessionList, UpdateSettings, DeleteSession
- `TestMessages`: SendMessage, Idempotent, History, Sync, Recall, MarkRead
- `TestAttachmentsAndNotifications`: Probe, List, ReadAll
- `TestCustomAgent`: Full CRUD
- `TestEdgeDevice`: Register device

**Quality assessment:**
- Tests behavior (real HTTP calls via httptest.Server), not implementation
- Covers all major happy paths for auth, contacts, sessions, messages
- Covers error paths: wrong password, no token, duplicate friend request, self-block, wrong password change
- Uses real PostgreSQL and Redis (true integration test)
- Test helpers (`register`, `mustOK`, `mustCode`, `parse`, `extract`) are clean and reusable

**Weaknesses:**
- No invalid input on SendMessage (missing fields, empty content, too-long content)
- No concurrency/race condition tests (eventually consistent behavior)
- No tests for session member count verification after kick/add
- Tests are sequential within each function but could run sub-tests in parallel

### 2.3 `tests/cache_test.go` — GOOD

Detailed cache behavior tests:
- `TestCacheWarmsOnRead`: Verifies cache population on session list read
- `TestCacheInvalidateOnSessionChange`: Tests cache invalidation after member kick
- `TestProfileUpdateInvalidatesCache`: Verifies /me returns updated nickname after profile change
- `TestBlockAddsToCorrectList`: Tests block/unblock idempotency
- `TestRecallByOwnerNonSender`: Group owner can recall non-sender message
- `TestRecallTimeout`: Verifies recall works within 5-minute window
- `TestPinLimit`: Tests pin count enforcement (2 pins, both succeed)
- `TestSearchSessions`: Tests session search with positive and negative cases
- `TestSearchNonExistentUser`: Tests search for non-existent user and self-search (both error paths)

**Quality:** These test real cache semantics (not mock Redis). Good coverage of invalidation, warming, and cache read-through patterns. The pin limit test pins only 2 messages against a limit of 50 — could verify the actual limit boundary.

### 2.4 `tests/rest_test.go` — EXCELLENT edge case coverage

**Session lifecycle (3 tests):**
- `TestLeaveAndRejoinGroup`: Leave, double-leave rejected, re-add
- `TestLeaveAsLastOwner`: Owner can't leave with remaining members
- `TestDissolveByNonOwner`: Non-owner dissolve rejected

**Contact edge cases (4 tests):**
- `TestCreatePrivateWithSelf`: Private session with self rejected
- `TestCreateGroupWithoutFriends`: Group creation with non-friend rejected
- `TestDuplicateFriendRequest`: Duplicate request rejected (FRIEND_ALREADY)
- `TestAcceptNonPendingRequest`: Accept invalid UUID, request to existing friend

**Message edge cases (2 tests):**
- `TestInvalidContentType`: Invalid content_type rejected
- `TestGetMessagesWithoutMembership`: Non-member can't fetch messages

**Auth edge cases (3 tests):**
- `TestChangePasswordWithWrongOldPassword`: Wrong old password rejected
- `TestRegisterWithShortPassword`: Short password (< 8 chars) rejected
- `TestLoginWithInvalidDeviceType`: Empty device_type/missing device_id rejected

**Additional operations tested:**
- `TestRemainingREST`: Reject friend request, remove contact, add members, kick member, update group info, add agent to session, mark single notification read
- `TestWebSocketUpgrade`: Verifies 101 switching protocols
- `TestAgentTaskCallbacks`: Task ack/stream/done/fail/cancel via edge endpoints

**Quality:** This file is the best for error-path testing. It covers boundary conditions, authorization checks, and negative test cases systematically. The only gap is race condition testing on concurrent group operations.

### 2.5 `tests/seq_test.go` — GOOD (concurrency + safety)

- `TestSeqContinuity`: 10 sequential messages => seq 1..10, no gaps
- `TestConcurrentSendNoDuplicateSeq`: 50 concurrent sends, no duplicate seq, no gaps
- `TestForwardToMultipleSessions`: Forward to 3 groups concurrently
- `TestSeqAfterRedisRestart`: Skipped (requires Redis restart)
- `TestSendMessageRejectNonMember`: Non-member send => SESSION_NOT_MEMBER
- `TestSendMessageToDissolvedSession`: Send to dissolved session => SESSION_DISSOLVED
- `TestRecallNotOwnByNonSender`: Non-sender/non-owner recall => SESSION_NOT_MEMBER

**Quality:** Strong concurrency testing. The 50-goroutine concurrent send test with gap-free verification is excellent. Test helpers (`friendPair`, `privateSession`, `sendMsg`, `fetchMessages`) improve readability significantly.

### 2.6 `tests/extra_test.go` — GOOD

- `TestPinAndForward`: Pin, unpin (toggle), forward, search messages
- `TestGroupManagement`: Transfer owner, owner can't leave, dissolve
- `TestBlockedMessage`: Blocked user message => MSG_BLOCKED_BY_RECEIVER
- `TestFileUpload`: Multipart upload with hash, download verification
- `TestRemainingREST`: Broad misc REST coverage
- `TestWebSocketUpgrade`: WS upgrade test
- `TestAgentTaskCallbacks`: Full agent lifecycle (ack/stream/done/fail/cancel)

### 2.7 `tests/setup_test.go` — Test infrastructure

**Patterns used:**
- `httptest.Server` with real Gin router
- `repository.InitDB` + `repository.RunMigrationsFrom` for real DB connection
- `cache.InitRedis` for real Redis connection
- `cleanDB()` deletes from all tables before each test run
- Helpers: `post`, `get`, `put`, `del`, `postAuth`, `parse`, `extract`, `register`, `mustOK`, `mustCode`
- `testing.Short()` guard: skips all integration tests with `-short` flag

**Issues:**
- `cleanDB()` is called once in `TestMain`, not per test. Tests can interfere with each other.
- No `t.Cleanup` pattern — any test that fails mid-way leaves dirty state.
- The `register` helper handles "username taken" by falling through to login — this masks real errors when two tests register the same user (the second test inherits state from the first).
- No test isolation: all tests share one DB. Tests are ordered-dependent.

---

## 3. Top 10 Missing Tests (Ranked by Risk)

| # | Test | Risk | Why | Affected Code |
|---|---|---|---|---|
| 1 | **JWT token generation/parsing** | HIGH | Auth is the security boundary. Bugs in token generation or parsing would break all authentication. No unit tests for `GenerateAccessToken`, `ParseToken`, `GenerateRefreshToken`, `HashRefreshToken`. | `internal/jwtutil/jwt.go:20-60` |
| 2 | **SendMessage with SQL injection / XSS content** | HIGH | Message sending is the most trafficked endpoint. No tests for malicious content, oversized payloads, missing required fields, or boundary conditions. | `internal/service/message.go:88-185` |
| 3 | **EventBus panic recovery and backpressure** | HIGH | The event bus uses `ants.Pool.Submit` with per-job `recover()`. If the recover mechanism fails, a panic in an event handler could crash the server. No tests for event handler panic recovery, pool exhaustion, or bus shutdown ordering. | `internal/service/eventbus.go:48-69` |
| 4 | **WebSocket auth timeout / disconnect / reconnect** | HIGH | WebSocket is the real-time backbone. The auth timeout (5s deadline on first read), reconnection (old conn kicked), and stalled connection detection (ping/pong) have no dedicated tests. Only a basic HTTP upgrade test exists. | `internal/handler/ws.go:59-135`, `internal/ws/manager.go:221-245` |
| 5 | **Session creation with invalid member IDs** | MEDIUM | `CreateGroupSession` accepts `member_ids` but if any ID doesn't exist in the DB, the behavior depends on FK constraints. No test for non-existent user IDs mixed with valid ones. | `internal/service/session.go:90-136` |
| 6 | **Redis fallback on seq allocation** | MEDIUM | `allocateSeq` falls back to DB when Redis is unavailable. This fallback path is never tested. If the DB fallback also fails, the message send error handling may be incomplete. | `internal/service/message.go:31-44` |
| 7 | **Rate limiting** | MEDIUM | There is NO rate limiting in the codebase. No middleware, no per-user/per-IP throttling. A single client can flood login, send messages, or create sessions. This is a DDoS vector. | (not implemented) |
| 8 | **Config loading with missing/invalid YAML** | MEDIUM | `config.Load` has no tests for missing config file, invalid YAML syntax, missing required fields, or environment variable overrides via Viper's `AutomaticEnv`. | `internal/config/config.go:65-83` |
| 9 | **Cache data consistency (GetOrLoad)** | MEDIUM | `cache.GetOrLoad` uses singleflight and TTL jitter, but the error paths (Redis down, unmarshal failure, marshal failure) are untested. The singleflight deduplication behavior under concurrency is also untested. | `internal/cache/data.go:21-65` |
| 10 | **Message recall by owner of group (expired + non-expired)** | LOW | Partially tested in integration tests, but no unit test for the exact time boundary (exactly 5 minutes + 1 second) or the case where `msg.CreatedAt` is in the future (clock skew). | `internal/service/message.go:285-314` |

---

## 4. Stability Findings

### 4.1 Panic Recovery — ADEQUATE

- `gin.Recovery()` middleware is used in both `main.go:332` and `setup_test.go:84`.
- The EventBus uses `ants.WithPanicHandler` to log panics instead of crashing (`eventbus.go:29-31`).
- Each event handler job has a `recover()` wrapper (`eventbus.go:59-61`).
- **Gap:** The `gin.Recovery()` middleware logs to stderr by default, not to the structured logger (zap/slog). Panics in handlers produce unstructured output that won't appear in structured log files.
- **Gap:** No custom recovery middleware that returns proper JSON error responses. Gin's default recovery returns a 500 text/plain body.

### 4.2 Graceful Shutdown — GOOD

- SIGINT/SIGTERM handling in `main.go:353-367`: traps signal, shuts down main server and admin server with 10s timeout.
- HTTPS shutdown with `context.WithTimeout(10s)`.
- `bus.Close()` deferred after creating event bus (`main.go:126`).
- `log.Sync()` deferred after log init (`main.go:47`).
- **Gap:** No drain of active WebSocket connections during shutdown. Connected clients get disconnected abruptly.
- **Gap:** No shutdown of Redis connection pool. `cache.RDB` is never `Close()`d.

### 4.3 Connection Pooling — GOOD

**Database (GORM/PostgreSQL):**
- `SetMaxIdleConns(10)` and `SetMaxOpenConns(100)` at `repository/db.go:41-42`
- `SetConnMaxLifetime(1 hour)` at line 43
- `SkipDefaultTransaction: true` and `PrepareStmt: true` are good performance defaults
- Slow query threshold: 200ms with Warn-level logging

**Redis:**
- Configurable pool size (default 100) and min idle conns (default 10) at `cache/redis.go:16-23`
- Max retries: 3 with 2s dial timeout and 4s pool timeout
- Connection max idle time: 10 minutes
- Read/write timeouts: 1s each

**EventBus (ants goroutine pool):**
- Pool size: 1024 at `service/eventbus.go:27`
- Non-blocking mode off (callers block when pool is full)

### 4.4 Memory Leaks — NO MAJOR ISSUES FOUND

- `ws.Manager` maintains `conns` and `byUser` maps with proper cleanup on `Unregister`.
- EventBus uses `ants.Pool` which recycles goroutines.
- Singleflight group (`cache/data.go`) caches in-flight calls — these are short-lived and auto-clean.
- `StartHeartbeat` goroutine runs once per process (not per connection).
- `timeout scanner` goroutine runs once per process (1-minute ticker).
- **Minor concern:** The `broadcastOnlineStatus` goroutine at `main.go:416-417` is launched per route set/del. If route changes happen rapidly, goroutines could accumulate briefly. Each goroutine does a DB query and pushes to WebSocket connections, so it's bounded by I/O time.

### 4.5 Context Propagation — ADEQUATE

- Handlers pass `c.Request.Context()` to service methods consistently.
- `cache.GetOrLoad` and `cache.Invalidate` accept `context.Context`.
- `jwtutil.ParseToken` checks `token.Valid` (which validates expiry).
- **Gap:** `ws.writeLoop` uses `context.Background()` instead of a context derived from the connection. If the server is shutting down, write operations won't be cancelled.
- **Gap:** `ws.readLoop` uses `context.Background()` for the main read loop (after the initial auth read with 5s timeout). A hung client could keep the read loop alive indefinitely.

---

## 5. Test Infrastructure Assessment

### 5.1 Local Test Execution

**Difficulty:** MEDIUM  
**Dependencies:** PostgreSQL + Redis required (Docker Compose available at `docker-compose.yml`)  

```bash
# Start dependencies
docker compose up -d postgres redis

# Run all tests (integration)
go test ./tests -v -count=1

# Run all tests (unit only, fast feedback)
go test ./... -short -count=1

# Run specific integration test
go test ./tests -run TestAuth -v -count=1
```

The `-short` flag gates all integration tests. This is a good pattern, but there are no intermediate levels (e.g., "run unit tests for internal packages" vs "run integration tests").

### 5.2 Docker Compose

File: `docker-compose.yml`

Services:
- PostgreSQL 16-alpine (port 5432, DB: `agenthub`, user: `agenthub`, password: `dev_password`)
- Redis 7-alpine (port 6380, AOF persistence)
- server-hub (build from `deployments/Dockerfile`, port 8080)

Good health checks on both postgres and redis. The compose file is well-structured for both dev and CI.

### 5.3 Test Fixtures / Helpers

- `tests/setup_test.go` provides: `post`, `get`, `put`, `del`, `postAuth`, `parse`, `extract`, `register`, `loginAndGetUser`, `mustOK`, `mustCode`
- `tests/seq_test.go` provides: `friendPair`, `privateSession`, `sendMsg`, `fetchMessages`
- **Gap:** No factory functions for creating sessions with messages, groups with members, or any pre-populated test scenarios. Each test manually builds up state.
- **Gap:** `cleanDB()` is called once in `TestMain`. There is no per-test cleanup, so tests can leak state to subsequent tests.

### 5.4 CI Pipeline

- Recent commit `1bbe365` added "增强检查流水线 + 添加质量治理规则（覆盖率/分支策略/提交规范）" — CI pipeline with coverage/branch strategy/commit standards
- The `-short` flag allows CI to run unit tests without PostgreSQL/Redis

---

## 6. Concrete Test Improvement Plan

### Phase 1: Critical Unit Tests (Week 1)

**Goal:** Reach >80% coverage on `internal/jwtutil`, `internal/middleware`, `internal/cache`

```
1. internal/jwtutil/jwt_test.go
   - TestGenerateAccessToken: valid, expired, empty userID
   - TestParseToken: valid, expired, wrong secret, tampered, missing claims
   - TestGenerateRefreshToken: 32 bytes, uniqueness
   - TestHashRefreshToken: deterministic, different inputs produce different hashes
   Files: internal/jwtutil/jwt.go:20-60

2. internal/middleware/auth_test.go
   - TestAuthMiddleware: no header, invalid Bearer, valid token, expired token
   - TestDeviceTypeCheck: allowed type, disallowed type, empty type
   - TestAccessLog: calls next, logs correct fields
   - TestPrometheusMiddleware: counter increments, histogram observes
   Files: internal/middleware/auth.go:12-32, device_type.go:11-21

3. internal/cache/data_test.go
   - TestGetOrLoad: cache hit, cache miss, Redis down fallback, unmarshal failure
   - TestGetOrLoadSingleflight: concurrent calls deduplicated
   - TestInvalidate: single key, multiple keys, empty key list
   - TestAllocateSeq: sequential increments, across sessions
   Files: internal/cache/data.go:21-65, seq.go:8-25

4. internal/service/eventbus_test.go
   - TestEventBusSubscribe: handler registered for type
   - TestEventBusPublish: handler called, wildcard '*' handler
   - TestEventBusPanicRecovery: handler panics, pool continues
   Files: internal/service/eventbus.go:26-74
```

### Phase 2: Service Layer Unit Tests with Mocks (Week 2)

**Goal:** Reach >70% coverage on `internal/service`

```
5. internal/service/auth_test.go
   - Mock repository.DB with go-sqlmock or testcontainers
   - TestRegister: valid, username too short, password too short, duplicate username
   - TestLogin: valid credentials, wrong password, user not found, device upsert
   - TestRefreshToken: valid, revoked, expired
   - TestChangePassword: valid, wrong old password, new password too short
   Files: internal/service/auth.go:33-196

6. internal/service/session_test.go
   - TestCreatePrivateSession: new, duplicate (returns existing)
   - TestCreateGroupSession: valid, no members, non-friend members
   - TestLeaveGroup: member leaves, owner with other members (rejected), owner alone (allowed)
   - TestDissolveGroup: owner dissolves, non-owner (rejected)
   Files: internal/service/session.go:47-366

7. internal/service/message_test.go
   - TestSendMessage: valid, invalid content_type, non-member, dissolved session, blocked, idempotent
   - TestRecallMessage: sender recalls (within 5 min), sender recalls (expired), owner recalls, non-sender/non-owner (rejected)
   - TestPinMessage: valid, duplicate, limit exceeded
   Files: internal/service/message.go:88-185, 285-314, 316-348
```

### Phase 3: Integration Test Hardening (Week 3)

**Goal:** Add concurrent and edge case integration tests

```
8. tests/race_test.go (new file)
   - TestConcurrentFriendAccept: two users accept same request simultaneously
   - TestConcurrentGroupCreate: same name collision
   - TestConcurrentSessionDelete: user deletes session while another sends message
   - TestLoginRace: same device login twice, old token invalidated

9. tests/stress_test.go (new file)
   - TestManyMessagesInSession: 1000 messages, verify all persisted
   - TestManyConcurrentSessions: 100 users create private sessions
   - TestLargeGroupOperations: add/remove 50 members
```

### Phase 4: Stability Hardening (Week 4)

```
10. internal/middleware/recovery_test.go (new file)
    - gin.Recovery() with structured logging
    - JSON error response on panic (not text/plain)
    Register custom middleware that catches panics and writes JSON errors
    Files: internal/middleware/ (new file), cmd/server-hub/main.go:332

11. Write structured recovery middleware for panics
    - Captures stack trace into structured log field
    - Returns { "code": "INTERNAL_ERROR", "message": "internal server error" } as JSON
    - Reproduces gin.Recovery() behavior but with structured logging
    Affects: cmd/server-hub/main.go:332 (replace gin.Recovery() usage)
```

### Phase 5: Missing Feature (Medium Risk)

```
12. Rate limiting middleware (not implemented)
    - Per-user rate limiting (token bucket via Redis)
    - Per-IP rate limiting for unauthenticated endpoints (register, login)
    - Configurable limits per endpoint group
    - 429 Too Many Requests with Retry-After header
    New: internal/middleware/rate_limit.go, config rate_limit section
```

---

## 7. Summary Scorecard

| Dimension | Rating | Notes |
|---|---|---|
| **Unit test coverage** | POOR (1/19 packages) | Only `internal/auth` has unit tests. All other packages rely on integration tests or are untested. |
| **Integration test coverage** | GOOD | 26 tests covering all major API surfaces (auth, contacts, sessions, messages, agents). Error paths well covered in `rest_test.go`. |
| **Test quality (unit)** | EXCELLENT (for tests that exist) | `middleware_test.go` is a model of good unit testing. |
| **Test quality (integration)** | GOOD | Real DB/Redis, helper patterns, strong error case coverage. Weak on test isolation (shared DB). |
| **Test isolation** | POOR | `cleanDB()` runs once in `TestMain`. No per-test cleanup. Tests are order-dependent. |
| **Panic recovery** | ADEQUATE | Gin's recovery + EventBus panic handler. Gap: unstructured stderr logging for HTTP panics. |
| **Graceful shutdown** | GOOD | Proper SIGTERM handling with timeout. Gap: no WS drain, no Redis close. |
| **Connection pooling** | GOOD | DB: 100 max open, 10 idle. Redis: 100 pool, 10 idle. Both well-configured. |
| **Rate limiting** | MISSING | No rate limiting anywhere. High risk for production. |
| **Test infrastructure** | GOOD | Docker Compose, `-short` flag, clean helpers. Easy to run locally. |

---

## 8. Key Recommendations

1. **IMMEDIATE**: Add `internal/jwtutil/jwt_test.go` with 100% coverage. Auth is the most critical security boundary.
2. **IMMEDIATE**: Add per-test cleanup using `t.Cleanup` in `setup_test.go` to prevent test state leakage.
3. **HIGH**: Add unit tests for `internal/middleware/auth.go`, `device_type.go`, `access_log.go`. These are the gateway to all endpoints.
4. **HIGH**: Implement rate limiting middleware before production deployment.
5. **MEDIUM**: Add structured panic recovery middleware replacing gin.Recovery() for JSON error responses.
6. **MEDIUM**: Add `internal/cache/data_test.go` with Redis mock for GetOrLoad cache behavior.
7. **LOW**: Close Redis connection pool in graceful shutdown (`main.go:364` area).
8. **LOW**: Add WebSocket drain in graceful shutdown sequence.
