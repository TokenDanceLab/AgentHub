# Edge Server Engineering Audit

**Date**: 2026-05-24
**Auditor**: Automated code review
**Branch**: `dev/delicious233`
**Scope**: `D:\Code\AgentHub\edge-server` (all Go source)

---

## Executive Summary

The Edge Server is a well-structured Go codebase with thoughtful interface design and solid fundamentals. The adapter pattern is cleanly implemented, the event bus is well-tested, and error classification is excellent. However, the codebase has material issues in three areas: **(A) observability** (no metrics, minimal health checks), **(B) concurrency safety** (a race condition in `ProcessExecutor.Start`), and **(C) test coverage** (17.3% in `runnerctx`, 0% for control protocol functions). The overall code quality is strong but the observability gap in particular is concerning for a server that runs agent subprocesses.

---

## Architecture Diagram (ASCII)

```
                         Desktop UI / Web Client
                                |
            +-------------------+-------------------+
            |                                       |
     HTTP REST (v1)                           WebSocket
     /v1/health, /v1/runs,                /v1/events
     /v1/projects, /v1/threads,
     /v1/agents, /v1/permissions
            |                                       |
            v                                       v
    +------------------+                    +------------------+
    |   api.Handler    | ---------------->  |   events.Bus     |
    |  (route mux)     |    publishes       |  (in-memory pub) |
    +--------+---------+                    +--------+---------+
             |                                        |
             | Start/Cancel                            | subscribe
             v                                        v
    +------------------+                    +------------------+
    | lifecycle.       |                    | WebSocket        |
    | RunExecutor      |                    | event fan-out     |
    | (ProcessExecutor |                    +------------------+
    |  MockExecutor)   |
    +--------+---------+
             |
             | BuildCommand / ParseStream
             v
    +------------------+         +-------------------+
    | adapters.        |         | lifecycle.        |
    | AgentAdapter     |<------->| env_sanitizer     |
    | - Claude Code    |         | (whitelist env)   |
    | - Codex          |         +-------------------+
    | - OpenCode       |
    | - Orchestrator   |
    +--------+---------+
             |
             | reads/writes
             v
    +------------------+
    | store.           |
    | Repository       |
    |  + FileStore     |
    |  (JSON snapshot) |
    +------------------+
```

```
                    Internal Package Graph
                    (---> = depends on)

     cmd/agenthub-edge ---> internal/httpserver
                                 |
         +----------+------------+----------+----------+
         |          |            |          |          |
         v          v            v          v          v
     internal/  internal/   internal/  internal/  internal/
      api        events      lifecycle  runners    security
       |          |            |   |
       |          |            |   +---> internal/runnerctx
       |          |            |
       v          |            +-------> internal/store
  internal/       |            |
  adapters +------+            +-------> internal/adapters
     |                                        |
     +---> internal/runnerctx                 +---> internal/runnerctx
     +---> internal/store                     +---> internal/store
```

---

## Coverage Summary

| Package | Coverage | Verdict |
|---|---|---|
| `events` | 100.0% | PASS |
| `runners` | 100.0% | PASS |
| `security` | 100.0% | PASS |
| `httpserver` | 94.3% | PASS |
| `store` | 81.7% | PASS (borderline) |
| `lifecycle` | 79.2% | PASS (borderline) |
| `cmd/agenthub-edge` | 78.7% | PASS (borderline) |
| `adapters` | 76.0% | PASS (borderline) |
| `api` | 73.6% | PASS (borderline) |
| **`runnerctx`** | **17.3%** | **FAIL** |
| **Total** | **77.1%** | **PASS (threshold met)** |

---

## Detailed Findings

### S1 -- CRITICAL: Race condition in ProcessExecutor.Start

**File**: `internal/lifecycle/process_executor.go:86-119`
**Severity**: HIGH
**Category**: Concurrency

The `Start` method inserts a `nil` placeholder into the `running` map before the context cancel function is available. Between the unlock at line 109 and the lock at line 112, a concurrent `Cancel` call can retrieve the `nil` cancel function and silently do nothing, leaving the run unstoppable.

```go
// Line 108: placeholder inserted while Lock is held
e.running[run.ID] = nil // placeholder, updated after context creation
e.mu.Unlock()

// Line 111: context is created OUTSIDE the lock
ctx, cancel := context.WithTimeout(context.Background(), defaultRunTimeout)

// Line 112-114: cancel is stored -- but a Cancel() between 109-112
// would find running[run.ID] == nil and return "not_running"
e.mu.Lock()
e.running[run.ID] = cancel
e.mu.Unlock()
```

**Fix**: Create the context first, then insert atomically:
```go
ctx, cancel := context.WithTimeout(context.Background(), defaultRunTimeout)
e.mu.Lock()
e.running[run.ID] = cancel
e.mu.Unlock()
```
Remove the placeholder pattern entirely.

---

### S2 -- CRITICAL: No metrics / observability beyond slog

**File**: `internal/httpserver/server.go`, entire codebase
**Severity**: HIGH
**Category**: Observability

The server has zero instrumentation. There is:
- No Prometheus metrics endpoint
- No OpenTelemetry tracing
- No request/response latency tracking
- No goroutine count monitoring
- No event bus queue depth gauge
- No run success/failure counters
- `GET /v1/health` returns only `{"status":"ok"}` with no dependency checks

For a server that manages agent subprocess lifecycles running up to 30 minutes each, complete lack of observability is a production blocker.

**Fix**: Add at minimum:
1. `expvar` or `prometheus/client_golang` for run counters, event bus depth, active connections
2. Health check that verifies store is accessible, executors are online
3. Request-level metrics (duration, status code) on all REST endpoints

---

### S3 -- HIGH: runnerctx package at 17.3% coverage

**File**: `internal/runnerctx/context_budget_test.go`, `internal/runnerctx/run_output.go`
**Severity**: HIGH
**Category**: Testing

The package with the lowest coverage contains context budget tracking (critical for preventing token exhaustion) and run output persistence (critical for debugging failed runs). Specifically:

- `ContextBudget.ShouldCompact()`: 0% coverage -- this is the core threshold check
- `ContextBudget.UsagePercent()`: 0% coverage
- `RunOutputStore` all methods: 0% coverage (Write, ReadAll, Close, Path)
- `EstimateTokens()`: 0% coverage

**Fix**: Write table-driven tests for `ContextBudget` threshold behaviors and `RunOutputStore` I/O lifecycle. These are pure in-memory/fs functions and easy to test.

---

### S4 -- HIGH: 0% coverage on control protocol

**File**: `internal/adapters/control_protocol.go`
**Severity**: HIGH
**Category**: Testing

All 5 `Write*` functions and the `HandleControlRequest` / `handleCanUseTool` methods have zero test coverage. These functions write JSON to stdin of the Claude Code subprocess -- if they produce malformed JSON, the agent subprocess will silently fail or hang.

```go
// Line 155: json.Marshal error silently discarded
inner, _ := json.Marshal(ControlRequestInner{Subtype: "interrupt"})
```

Additionally, the `json.Marshal` error is discarded with `_` on line 155 (and similarly at 172, 189, 207). While `json.Marshal` of a struct literal rarely fails, the pattern is dangerous in security-sensitive control messaging.

**Fix**: Write tests that verify the JSON output of each `Write*` function. Return the Marshal error instead of discarding it.

---

### S5 -- HIGH: OrchestratorAdapter NeedsStdin returns false (documented but incorrect)

**File**: `internal/adapters/orchestrator.go:67-68`
**Severity**: HIGH (correctness)
**Category**: Interface Design

```go
func (a *OrchestratorAdapter) NeedsStdin() bool { return false }
```

The comment at line 66-67 acknowledges that the inner Claude Code needs stdin, but the orchestrator adapter returns false. This means the `ProcessExecutor` will never open stdin for orchestrator runs, and the Claude Code subprocess's control protocol (permission requests, interrupts) will hang waiting for stdin that never opens.

This contradicts the `ClaudeCodeAdapter` which correctly returns `true`.

**Fix**: Return `true` or ensure the orchestrator inner adapter never needs stdin (e.g., by setting `bypassPermissions` permanently).

---

### S6 -- MEDIUM: nextEvent helper duplicated across test files

**File**: `internal/lifecycle/mock_executor_test.go:259` and `internal/lifecycle/process_executor_test.go` (imports mock_executor_test.go's version)
**Severity**: MEDIUM
**Category**: Testing

The `nextEvent` helper is defined in `mock_executor_test.go` and used by `process_executor_test.go` because Go allows cross-file access within the same test package. This works but creates a hidden dependency: `process_executor_test.go` cannot be understood in isolation. The `nextEventWithin` helper in `process_executor_test.go` partly duplicates the pattern.

**Fix**: Create `internal/lifecycle/testutil_test.go` that holds all shared test helpers, making the dependency explicit.

---

### S7 -- MEDIUM: No environment variable configuration support

**File**: `cmd/agenthub-edge/main.go:91-134`
**Severity**: MEDIUM
**Category**: Configuration

All configuration is exclusively via CLI flags. For containerized/cloud deployment, environment variables are the standard. There is no `AGENTHUB_ADDR`, `AGENTHUB_STORE_FILE`, etc. Every value requires a command-line argument.

**Fix**: Add environment variable fallback for every flag, or adopt a library like `envconfig` to read from env vars automatically.

---

### S8 -- MEDIUM: busEventEmitter and budgetAwareEmitter in wrong package

**File**: `internal/lifecycle/process_executor.go:414-449`
**Severity**: LOW
**Category**: Project Structure

The `busEventEmitter` and `budgetAwareEmitter` types logically belong in the `adapters` package since they implement `adapters.EventEmitter`. Their current location in `lifecycle` creates an awkward dependency direction.

**Fix**: Move to `internal/adapters/event_emitter.go` or keep a simple wrapper in `lifecycle` that delegates to adapters.

---

### S9 -- MEDIUM: Orchestrator system prompt has no template validation

**File**: `internal/adapters/orchestrator.go:72-95`
**Severity**: LOW
**Category**: Interface Design

The `DefaultOrchestratorPrompt` builds a prompt via string concatenation with `formatAgentList`. If agent names contain special characters, they could be interpreted as prompt injection. While low risk (agent IDs are controlled), adding escaping would be defensive.

---

### S10 -- MEDIUM: FileStore persist races during concurrent writes

**File**: `internal/store/file_store.go:162-169`
**Severity**: MEDIUM
**Category**: Concurrency

`persist()` acquires `persistMu` but does not acquire `store.mu`. This means:
1. Goroutine A calls `CreateRun` -> `store.mu.Lock()` -> stores run -> `store.mu.Unlock()`
2. Goroutine B calls `CreateItem` -> `store.mu.Lock()` -> stores item -> `store.mu.Unlock()`
3. Both call `persist()`, which races on which snapshot gets written last

The `persistMu` only prevents concurrent writes to the file, but the snapshots themselves are stale by the time `persistMu` is acquired. One snapshot may be missing the other goroutine's changes.

**Fix**: Either: (a) acquire `store.mu` inside `persist()` to ensure the snapshot is consistent, or (b) use a write-ahead log pattern, or (c) document that FileStore snapshots are eventually consistent and accept data loss on crash.

---

### S11 -- LOW: Inconsistent error wrapping in store

**File**: `internal/store/store.go`
**Severity**: LOW
**Category**: Error Handling

The `CreateProject` function returns silently when the project already exists (returns `existing` with no error). This is a deliberate "idempotent create" pattern, but callers have no way to distinguish "already existed" from "just created." Consider returning a boolean or a dedicated `ErrAlreadyExists` sentinel.

---

### S12 -- LOW: Empty `internal/edgeserver/` directory

**File**: `internal/edgeserver/` (empty)
**Severity**: LOW
**Category**: Project Structure

An empty directory exists at `internal/edgeserver/`. This may be leftover scaffolding. Ensure it is either populated or removed to avoid confusion.

---

### S13 -- LOW: No `docs/` directory in edge-server

**File**: `README.md:36-38`
**Severity**: LOW
**Category**: Documentation

The README references `docs/system-architecture.md` and `docs/implementation-guide.md`, but no `docs/` directory exists under `edge-server/`. These appear to live at the monorepo root level instead. Clarify paths or add a local docs symlink.

---

## Top 5 Most Impactful Improvements

1. **Add observability (S2)**: Prometheus metrics + meaningful health check. This is the single most impactful improvement. Without it, you cannot monitor production deployments at all. Estimated effort: 2-3 days.

2. **Fix the ProcessExecutor race condition (S1)**: A one-line structural fix that eliminates the possibility of an unstoppable zombie process. Risk: data loss / orphaned processes in production. Estimated effort: 1 hour.

3. **Test runnerctx package (S3)**: Write tests for ContextBudget threshold logic and RunOutputStore I/O. These are foundational types used by the entire execution pipeline. Estimated effort: 2-4 hours.

4. **Test control protocol (S4)**: Add test coverage + fix error suppression on json.Marshal. The control protocol is the critical path for permission gating and interrupts. Estimated effort: 3-5 hours.

5. **Fix OrchestratorAdapter NeedsStdin (S5)**: Change return value to `true` or restructure so the inner adapter handles stdin independently. Without this, orchestrator runs may hang on permission requests. Estimated effort: 1 hour.

---

## Comparison Against Go Best Practices

| Practice | Status | Notes |
|---|---|---|
| Standard project layout (`cmd/`, `internal/`) | PASS | Clean separation |
| Interface segregation (small interfaces) | PASS | `RunExecutor` (2 methods), `EventEmitter` (1 method) |
| Sentinel errors | PASS | `ErrNotFound`, `ErrProcessBusRequired`, etc. |
| Error wrapping with `%w` | MOSTLY PASS | Some inconsistencies in adapter code |
| Context propagation | PASS | `exec.CommandContext`, parser context with budget |
| Table-driven tests | PASS | Extensively used |
| `testing.Short()` for integration tests | PASS | In 2 integration test files |
| goroutine lifecycle management | NEEDS WORK | See S1 |
| `defer` for cleanup | PASS | Mutex unlocks, file closes |
| Structured logging (`log/slog`) | PASS | Consistent use |
| No global state | PASS | Dependencies injected via constructors |
| Compile-time interface checks | PASS | `var _ AgentHook = (*SecurityHook)(nil)` |
| Mutex by value | AVOIDED | Mutexes in structs are not copied |
| gRPC-style health checking | MISSING | See S2 |
| Graceful shutdown | PASS | Signal handling with timeout |

---

## `.golangci.yml` Assessment

The linter configuration is solid (20 linters enabled) with reasonable per-file exclusion rules for high-complexity event dispatchers. Two observations:

- `errcheck` is globally excluded from test files (`_test\.go`) -- consider removing this exclusion to catch `_ = err` patterns in tests too.
- Complexity thresholds (cyclo: 20, cogn: 30) are on the high side. Consider gradually lowering them as the dispatch functions are refactored into smaller handlers.

---

*End of audit.*
