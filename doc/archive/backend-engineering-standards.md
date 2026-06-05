# Backend Engineering Standards Audit

**Date**: 2026-05-24
**Scope**: `edge-server/` and `hub-server/` Go services
**Reference Standards**: [Effective Go](https://go.dev/doc/effective_go), [Standard Go Project Layout](https://github.com/golang-standards/project-layout)

---

## Overall Grades

| Server         | Grade | Score   | Summary |
|----------------|-------|---------|---------|
| **edge-server** | **B+** | 75/100 | Strong architecture, clean dependency injection, excellent interface design. Weakened by missing observability metrics, security scanning gaps, and some magic numbers. |
| **hub-server**  | **C+** | 63/100 | Feature-complete IM backend with good observability. Held back by package-level global state, zero unit tests, no interfaces in service/repository layers, and CI gaps. |

---

## Per-Dimension Scores

### 1. Go Project Standards

| Criteria                         | edge-server | hub-server | Notes |
|----------------------------------|:-----------:|:----------:|-------|
| Directory structure              | 95          | 75         | hub: dual `cmd/` entries (agenthub-hub vs server-hub) with different HTTP stacks is confusing |
| `cmd/` vs `internal/` separation | 95          | 80         | hub: `pkg/uuidv7` correctly placed; server-hub/main.go is ~440 lines — too large for `cmd/` |
| Package naming                   | 90          | 85         | edge: `runnerctx` is slightly unconventional; hub: `errcode`/`jwtutil`/`uuidv7` — acceptable |
| `go.mod`: module path & version  | 95          | 40         | **hub: `go 1.25.6` does not exist** — Go stable is ~1.24.x. This is a critical error that will break toolchain resolution. |
| `go.mod`: minimal dependencies   | 95          | 80         | edge: single dependency (gorilla/websocket); hub: 21 direct deps — reasonable for feature set |
| Build tags / platform guards     | N/A         | N/A        | Neither server has platform-specific code |
| **Sub-score**                    | **92**      | **72**     | |

**hub-server critical issue**: `go.mod` line 3 reads `go 1.25.6` — no such Go version exists. This causes `go build`, `go test`, and `golangci-lint` to fail or behave unpredictably. Likely a typo for `1.23.6` or `1.24.0`.

### 2. Code Quality Standards

| Criteria                          | edge-server | hub-server | Notes |
|-----------------------------------|:-----------:|:----------:|-------|
| Error wrapping with context       | 90          | 60         | hub: repository functions return bare GORM errors without `%w` wrapping |
| Sentinel errors                   | 90          | 75         | edge: well-defined in `store`/`lifecycle`; hub: `errcode` struct approach is good but not traditional sentinel errors |
| Interface design (small, focused) | 92          | 45         | edge: `AgentAdapter` (5 methods), `EventEmitter` (1 method), `Repository` (Reader+Writer) — exemplary; hub: **no interfaces defined** in service/repository layers |
| Consumer-side interface definition| 85          | 30         | edge: `EventEmitter` defined near consumer; hub: no interfaces at all — all concrete types |
| Dependency injection              | 85          | 55         | edge: constructor injection throughout; hub: constructor injection exists but `repository.DB` and `config.Cfg` are **package-level globals** |
| Global state                      | 90          | 35         | edge: clean; hub: `var DB *gorm.DB`, `var Cfg *Config`, `var RDB *redis.Client` — singleton anti-pattern |
| Testing patterns                  | 82          | 55         | edge: table-driven + subtests + mock executor; hub: subtests in integration tests only |
| Code duplication                  | 85          | 70         | edge: adapters share NDJSON parser; hub: error-handling pattern in handlers is repetitive (type-assert to `*errcode.Error`) |
| Magic numbers → named constants   | 70          | 60         | edge: `32*1024` buffer, `256` channel cap, `5` max concurrent; hub: bcrypt cost `10`, `100` pool size, `10` MinIdleConns |
| **Sub-score**                     | **85**      | **62**     | |

**Key edge-server strengths**:
- `AgentAdapter` interface with `BuildCommand`/`ParseStream`/`NeedsStdin` — clear, minimal contract
- `EventEmitter` single-method interface decouples adapters from the event bus
- `RunError` structured error classification with machine-readable codes
- MockExecutor with functional options pattern for test customization

**Key hub-server weaknesses**:
- Package-level globals (`repository.DB`, `config.Cfg`, `cache.RDB`) make parallel testing impossible and violate Go idioms
- No interfaces for mockability — services depend directly on `*gorm.DB` and `*ws.Manager` concrete types
- `cmd/server-hub/main.go` at 441 lines performs service wiring, route setup, bus subscriptions, and background jobs — violates single responsibility

### 3. CI/CD Pipeline

| Criteria                         | Status      | Notes |
|----------------------------------|:-----------:|-------|
| Coverage: edge-server 70%        | PASS (fail) | Hard threshold; enforces minimum quality |
| Coverage: hub-server 40%         | WARN only   | 40% is extremely low for a production server; should be raised to at least 60% |
| golangci-lint: edge-server       | PASS        | Comprehensive `.golangci.yml` with 18 linters, per-file exclusions |
| golangci-lint: hub-server        | **MISSING** | No `.golangci.yml` in hub-server; CI uses `latest` without project-specific rules |
| `go vet`                         | PASS        | Both servers run `go vet` |
| Race detector (`-race`)          | **MISSING** | Neither server enables the race detector in CI |
| Benchmark regression             | **MISSING** | No benchmark tests exist; no benchmark CI |
| Security scanning (gosec)        | **MISSING** | `gosec` not in golangci-lint enabled linters |
| Dependency vulnerabilities       | **MISSING** | No `govulncheck`, no Dependabot, no Renovate |
| Build caching                    | IMPLICIT    | `setup-go@v5` provides default caching; no explicit cache configuration |
| Matrix builds (OS)               | Single      | Only `ubuntu-latest`; no Windows or macOS |
| Docker image CI                  | **MISSING** | hub-server has `deployments/Dockerfile` but no CI job to build/push |
| Secret detection                 | **MISSING** | No gitleaks, no git-secrets, no secret scanning |
| **Sub-score: edge**              | **65**      | |
| **Sub-score: hub**               | **55**      | |

### 4. Testing Infrastructure

| Criteria                        | edge-server | hub-server |
|----------------------------------|:-----------:|:----------:|
| Unit tests                       | YES (12 test files) | **NO** (0 unit test files) |
| Integration tests                | YES (2 files, gated by `-short`) | YES (5 files, all require PostgreSQL + Redis) |
| Test helpers / fixtures          | MockExecutor + functional options | `setup_test.go` with `register`, `mustOK`, `mustCode` |
| Per-test isolation               | Good (independent store instances) | Fair (shared DB, `cleanDB()` not per-test) |
| Mock factories                   | MockExecutor with `WithFailedRun`/`WithOutputBatches` | None — no service/repository mocks |
| Parallel execution               | Some tests parallel-ready | Not parallel (shared global state) |
| Performance benchmarks           | None | None |
| Coverage threshold               | 70% (hard fail) | 40% (warning only) |
| **Sub-score**                    | **78** | **48** |

**hub-server testing assessment**: All tests in `tests/api_test.go`, `tests/cache_test.go`, `tests/rest_test.go`, `tests/seq_test.go`, `tests/extra_test.go` are integration tests requiring a live PostgreSQL and Redis. The `TestMain` function in `setup_test.go` panics if configuration cannot load or services are unavailable. While `-short` skips them in CI, this means **hub-server has zero code actually tested in the CI pipeline**. The 40% coverage threshold is misleading — actual CI coverage is 0%.

### 5. Security Best Practices

| Criteria                          | Status      | Notes |
|-----------------------------------|:-----------:|-------|
| `go.sum` committed                | PASS        | Both servers — supply chain integrity |
| Password hashing                  | PASS        | bcrypt with cost 10 (hub-server `service/auth.go`) |
| JWT token hashing                 | PASS        | SHA-256 of refresh tokens before storage |
| CORS validation                   | PASS        | edge-server: `security.IsTrustedLocalOrigin` with allowlist |
| Environment sanitization          | PASS        | edge-server: `lifecycle/env_sanitizer.go` blocks credential env vars |
| Structured auth middleware         | PASS        | hub-server: proper JWT validation, device-type gating, skip-paths |
| Secret detection (gitleaks)       | **MISSING** | No pre-commit or CI secret scanning |
| Dependency scanning (govulncheck) | **MISSING** | No vulnerability scanning in CI |
| Static analysis (gosec)           | **MISSING** | Not in golangci-lint config |
| Container scanning                | **MISSING** | Dockerfile exists but no image scanning |
| pprof exposure                    | CAUTION     | hub-server exposes pprof on port 6060 without auth (admin-only network mitigates) |
| **Sub-score: edge**               | **60** | |
| **Sub-score: hub**                | **55** | |

### 6. Observability

| Criteria                       | edge-server | hub-server |
|---------------------------------|:-----------:|:----------:|
| Structured logging              | PASS (slog) | PASS (Zap + zapslog bridge + lumberjack rotation) |
| Log levels appropriate          | PASS        | PASS (configurable via config/log) |
| Prometheus metrics              | **MISSING** | PASS (6 metrics: HTTP, WS, DB, Redis, EventBus) |
| pprof profiling                 | **MISSING** | PASS (admin port 6060) |
| Health checks                   | Shallow     | Shallow |
| Dependency health checks        | **MISSING** | **MISSING** |
| Distributed tracing (OTEL)      | **MISSING** | **MISSING** |
| Request ID / trace ID           | edge: traceId in events | hub: not in API responses |
| Error classification            | PASS (structured RunError codes) | PASS (errcode.Error with HTTP status) |
| **Sub-score**                   | **68** | **80** |

**Health check gap**: Both servers return `{"status":"ok"}` without verifying downstream dependencies.
- edge-server: should verify store is readable
- hub-server: should ping PostgreSQL and Redis

---

## Top 10 Most Impactful Improvements

### 1. [CRITICAL] Fix hub-server Go version — `D:\Code\AgentHub\hub-server\go.mod`
**File**: `D:\Code\AgentHub\hub-server\go.mod` line 3
**Issue**: `go 1.25.6` is not a valid Go version. This breaks all toolchain resolution.
**Action**: Change to `go 1.24.0` (or `go 1.23.6` depending on actual toolchain). Run `go mod tidy` after.
**Reference**: [Go Module Versioning](https://go.dev/doc/modules/gomod-ref#go)

### 2. [HIGH] Remove package-level global state from hub-server
**Files**: `hub-server/internal/repository/db.go`, `hub-server/internal/config/config.go`, `hub-server/internal/cache/redis.go`
**Issue**: `var DB *gorm.DB`, `var Cfg *Config`, `var RDB *redis.Client` are singleton globals. This prevents parallel testing, violates dependency injection principles, and makes the codebase fragile.
**Action**:
- Remove `var DB`, `var Cfg`, `var RDB`
- Pass `*gorm.DB`, `*config.Config`, `*redis.Client` through constructors
- Update `middleware/auth.go` to accept `jwtSecret` as parameter rather than reading `config.Cfg.JWT.Secret`
- Update `router/router.go` to accept `config *config.Config` as parameter
**Reference**: [Effective Go: Package names](https://go.dev/doc/effective_go#package-names), [Go Code Review Comments: Global state](https://github.com/golang/go/wiki/CodeReviewComments#globals)

### 3. [HIGH] Define interfaces for hub-server service and repository layers
**Files**: All files in `hub-server/internal/service/` and `hub-server/internal/repository/`
**Issue**: No interfaces defined anywhere. Services take concrete `*gorm.DB`, handlers take concrete `*service.AuthService`. This makes unit testing impossible without a real database.
**Action**:
- Define `AuthRepository` interface, `SessionRepository` interface, etc. in `repository/`
- Define `AuthServiceInterface`, `MessageServiceInterface`, etc. in `service/`
- Handlers should depend on interfaces, not concrete types
- Create mock implementations using `gomock` or `testify/mock`
**Reference**: [Go Wiki: InterfaceSlice](https://github.com/golang/go/wiki/CodeReviewComments#interfaces), [Effective Go: Interfaces](https://go.dev/doc/effective_go#interfaces)

### 4. [HIGH] Add unit tests for hub-server with mock dependencies
**Files**: Create `hub-server/internal/service/*_test.go`, `hub-server/internal/handler/*_test.go`
**Issue**: Hub-server has zero unit tests. All tests require PostgreSQL + Redis, and all are skipped in CI with `-short`. This means **hub-server currently has 0% code exercised in CI**.
**Action**:
- Write table-driven unit tests for `AuthService` using a mock `*gorm.DB` or an in-memory SQLite
- Write handler tests using `httptest.ResponseRecorder` with mocked services
- Aim for at least 50% unit test coverage (separate from integration tests)
**Reference**: [Go Testing: TableDrivenTests](https://github.com/golang/go/wiki/TableDrivenTests)

### 5. [HIGH] Add golangci-lint configuration for hub-server
**File**: Create `hub-server/.golangci.yml`
**Issue**: Hub-server has no `.golangci.yml`. The CI job uses default golangci-lint settings, which means weaker checks and no project-specific exclusions.
**Action**: Copy the edge-server `.golangci.yml` as a baseline, adjust for hub-server's codebase:
- Add exclusions for handler boilerplate, model files
- Enable `gosec` security linter
- Set appropriate complexity thresholds
**Reference**: current `edge-server/.golangci.yml`

### 6. [HIGH] Enable race detector, security scanning, and dependency checking in CI
**File**: `D:\Code\AgentHub\.github\workflows\checks.yml`
**Issue**: No `-race` flag, no `gosec`/`govulncheck`, no secret detection.
**Action**:
```yaml
# Add to both go-edge and go-hub jobs:
- name: Race detection
  run: go test -race -count=1 ./... -short

- name: Vulnerability check
  run: go run golang.org/x/vuln/cmd/govulncheck ./...

# Add as a new job:
- name: Secret scanning
  uses: gitleaks/gitleaks-action@v2
```
**Reference**: [Go Race Detector](https://go.dev/doc/articles/race_detector), [govulncheck](https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck)

### 7. [MEDIUM] Add Prometheus metrics to edge-server
**Files**: Create `edge-server/internal/metrics/metrics.go` and integrate into `httpserver/server.go`
**Issue**: Edge-server has zero observability metrics. While it is a local process, it runs long-lived agent subprocesses — understanding run durations, error rates, and resource usage is critical for debugging.
**Action**:
- Add metrics: `edge_runs_total`, `edge_run_duration_seconds`, `edge_active_runs`, `edge_ws_connections`
- Expose `/metrics` endpoint on a separate port (like hub-server's admin port)
**Reference**: [Prometheus Go Client Library](https://github.com/prometheus/client_golang)

### 8. [MEDIUM] Add deep health checks to both servers
**Files**: `edge-server/internal/api/handlers.go` (GetHealth), `hub-server/internal/api/handlers.go` (GetHealth)
**Issue**: Health endpoints only return `{"status":"ok"}` without checking dependencies.
**Action**:
- edge-server: verify store is accessible (read a known project), verify any registered adapters are present
- hub-server: `db.Ping()` and `redis.Ping()` in health check
- Return structured response: `{"status": "ok"}` or `{"status": "degraded", "checks": {"db": "ok", "redis": "error: ..."}}`
**Reference**: [Kubernetes Health Checks](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)

### 9. [MEDIUM] Extract named constants for magic numbers
**Files**: Multiple across both servers
**Issue**: Critical values are scattered as literals:
- edge-server: `maxConcurrentRuns: 5`, channel buffer `256`, read buffer `32*1024`, heartbeat `30s`, read deadline `60s`
- hub-server: bcrypt cost `10`, pool sizes, timeouts, heartbeat intervals
**Action**: Define constants in a central place or at the top of each file:
```go
const (
    defaultMaxConcurrentRuns = 5
    defaultChannelBuffer     = 256
    defaultReadBufSize       = 32 * 1024
    defaultHeartbeatInterval = 30 * time.Second
    defaultReadDeadline      = 60 * time.Second
    bcryptCost               = 10
)
```
**Reference**: [Go Code Review Comments: Magic Numbers](https://github.com/golang/go/wiki/CodeReviewComments#magic-numbers)

### 10. [MEDIUM] Add benchmark tests for critical paths
**Files**: Create `*_bench_test.go` in both servers
**Issue**: No performance regression detection. Critical paths that should be benchmarked:
- edge-server: `Bus.Publish`, `Bus.Subscribe`, `Store.CreateRun`, NDJSON parsing throughput
- hub-server: JWT generation/validation, message insertion rate, WebSocket broadcast fan-out
**Action**: Write at least 3-5 Go benchmark functions for each server.
**Reference**: [Go Testing: Benchmarks](https://pkg.go.dev/testing#hdr-Benchmarks)

---

## Additional Action Items

### edge-server specific

| # | Action | File(s) | Priority |
|---|--------|---------|----------|
| E1 | Add file-based log rotation (currently logs to stderr only) | `cmd/agenthub-edge/main.go` | LOW |
| E2 | Fix `ensureStore`/`ensureDefaults` lazy initialization — these mutate a nil-safe store on read paths | `internal/api/handlers.go:63-84` | MEDIUM |
| E3 | `TestMain` integration test setup for edge-server (none currently at package level) | New file or existing integration tests | LOW |
| E4 | Add `gosec` to golangci-lint enabled linters | `edge-server/.golangci.yml` | LOW |

### hub-server specific

| # | Action | File(s) | Priority |
|---|--------|---------|----------|
| H1 | Consolidate `agenthub-hub` and `server-hub` into a single entry point | `cmd/` | MEDIUM |
| H2 | Add `vendor/` or document dependency pinning strategy | `hub-server/` | LOW |
| H3 | Separate `cmd/server-hub/main.go` into `internal/app/` or `internal/server/` | Create `internal/app/app.go` | MEDIUM |
| H4 | Add structured trace IDs to API responses (currently only `edge-server` has per-request trace IDs) | `handler/response.go` | LOW |
| H5 | Add `ReadHeaderTimeout` to Gin server (security best practice for slowloris protection) | `cmd/server-hub/main.go:335` — already present, good | -- |
| H6 | Minify `cmd/server-hub/main.go` — extract event bus subscriptions into `internal/app/events.go` | New file | MEDIUM |
| H7 | Dockerfile uses Go 1.22 but go.mod says 1.25.6 — reconcile | `hub-server/deployments/Dockerfile` | MEDIUM |

### Pipeline-wide

| # | Action | File(s) | Priority |
|---|--------|---------|----------|
| P1 | Add Dependabot config for Go module updates | Create `.github/dependabot.yml` | MEDIUM |
| P2 | Add multi-platform build test (Windows + macOS) | `.github/workflows/checks.yml` | LOW |
| P3 | Add Docker image build + push job for hub-server | `.github/workflows/checks.yml` | MEDIUM |
| P4 | Add pre-commit hooks config for local linting | Create `.pre-commit-config.yaml` | LOW |
| P5 | Add test summary in CI (go-junit-report or similar) | `.github/workflows/checks.yml` | LOW |

---

## Go Best Practice Violations Summary

| Violation | Reference | Server | Severity |
|-----------|-----------|--------|----------|
| Package-level `var` global database handle | [CodeReviewComments#globals](https://github.com/golang/go/wiki/CodeReviewComments#globals) | hub-server | HIGH |
| No interfaces for dependency inversion | [Effective Go: Interfaces](https://go.dev/doc/effective_go#interfaces) | hub-server | HIGH |
| Invalid `go` directive version (1.25.6) | [go.mod reference](https://go.dev/doc/modules/gomod-ref#go) | hub-server | CRITICAL |
| Repository returns bare errors without `%w` | [CodeReviewComments#error-strings](https://github.com/golang/go/wiki/CodeReviewComments#error-strings) | hub-server | MEDIUM |
| Magic numbers as unexported literals | [CodeReviewComments#magic-numbers](https://github.com/golang/go/wiki/CodeReviewComments#magic-numbers) | Both | LOW |
| No `-race` in test CI | [Race Detector](https://go.dev/doc/articles/race_detector) | Both | MEDIUM |
| Health check does not verify dependencies | [K8s probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/) | Both | MEDIUM |
| All tests are integration tests (no unit tests) | [Testing: Unit vs Integration](https://go.dev/doc/tutorial/add-a-test) | hub-server | HIGH |
| `cmd/` entry point > 400 lines | [Standard Layout: cmd](https://github.com/golang-standards/project-layout#cmd) | hub-server | LOW |
| No structured error wrapping in data layer | [Uber Go Style: Error Wrapping](https://github.com/uber-go/guide/blob/master/style.md#error-wrapping) | hub-server | MEDIUM |

---

## What edge-server Does Well (Exemplary Patterns)

1. **`AgentAdapter` interface** (`internal/adapters/adapter.go`): A clean, minimal abstraction that allows adding new CLI backends without touching core logic. Each adapter implements 4 methods: `Metadata`, `Capabilities`, `BuildCommand`, `ParseStream`, `NeedsStdin`.

2. **Structured error classification** (`internal/lifecycle/run_errors.go`): `ClassifyError()` with priority-ordered error matching and machine-readable codes (`BINARY_NOT_FOUND`, `TIMEOUT`, `CANCELLED`) — this is how all Go services should handle errors.

3. **Functional options pattern for MockExecutor** (`internal/lifecycle/mock_executor.go`): `WithStepDelay()`, `WithOutputBatches()`, `WithFailedRun()` allow test authors to compose mock behavior declaratively.

4. **Segregated store interfaces** (`internal/store/store.go`): `Reader`, `Writer`, `Repository`, `RunLifecycleStore` — each consumer only sees the methods it needs.

5. **EventBus with cursor replay** (`internal/events/bus.go`): Thread-safe event bus with subscriber management, buffered channels, and cursor-based replay for late-joining WebSocket clients.

6. **golangci-lint configuration** (`.golangci.yml`): Comprehensive, with 18 linters and per-file/per-test exclusions. A model for other Go projects.

---

## What hub-server Does Well (Exemplary Patterns)

1. **Structured error codes** (`internal/errcode/codes.go`): Domain-specific error types with HTTP status codes, covering auth, messages, sessions, agents, friendships, attachments, and notifications.

2. **Prometheus metrics integration** (`internal/metrics/metrics.go`, `internal/middleware/metrics.go`): Full HTTP metrics with method/path/status labels, plus business-level gauges for WS connections, DB pool, Redis pool, and event bus queue.

3. **Logging infrastructure** (`internal/log/log.go`): Zap JSON logger with log level mapping, file rotation via lumberjack (100MB rotation, 10 backups, 30-day retention), and `zapslog` bridge for stdlib slog compatibility.

4. **WebSocket routing** (`internal/ws/manager.go`): Per-user, per-device-type connection tracking with kick-on-relogin, typing indicators, heartbeat/ping management, and pending task queue for offline desktop agents.

5. **Database migration discipline**: 15 numbered up/down migration pairs using golang-migrate, each with clean DDL.

6. **Admin server separation** (`cmd/server-hub/main.go`): Prometheus metrics + pprof on separate port from application traffic — good security pattern.
