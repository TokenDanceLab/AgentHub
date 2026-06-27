# Cross-Review: Edge Server SQLite Store & Process Lifecycle

**Date:** 2026-06-10
**Scope:** `edge-server/internal/{store,lifecycle,httpserver}` + `cmd/agenthub-edge`

---

## 1. Store Layer

### 1.1 Connection Management

| Setting | Value | Assessment |
|---|---|---|
| WAL mode | `PRAGMA journal_mode = WAL` | Correct. Enables concurrent reads during writes. |
| `busy_timeout` | 5000 ms | Reasonable for single-process desktop use. |
| `synchronous` | `NORMAL` | Acceptable with WAL; data is safe on commit, but uncommitted writes can be lost on power failure. Desktop trade-off is fine. |
| `foreign_keys` | `ON` | Correct. Enforced on the relational projection tables. |
| `MaxOpenConns` | 1 | Intentional. Single-writer constraint for SQLite. |
| Connection pool | Single `*sql.DB`, no external pool | Correct for single-process desktop. |

**Verdict:** Connection configuration is sound for the desktop use case.

### 1.2 Full Snapshot Write Pattern

**Finding confirmed: full-snapshot delete-and-reinsert is still the persist strategy.**

Every mutating operation (`CreateItem`, `SetRunStatus`, `UpsertArtifact`, etc.) calls `s.syncPersist()`, which:

1. Takes `persistMu` (a plain `sync.Mutex`, not `RWMutex`).
2. Calls `s.store.snapshot()` which acquires `Store.mu.RLock`, marshals the entire in-memory state to JSON, and releases.
3. Opens a transaction.
4. Writes the full JSON blob to `agenthub_store_snapshots`.
5. Calls `replaceSQLiteRows(tx, snapshot)` which does `DELETE FROM agenthub_store_rows` then re-inserts every row.
6. Calls `replaceSQLiteRelationalProjection(tx, snapshot)` which does `DELETE FROM edge_owners WHERE owner_id = ?` then re-inserts all relational projection rows.
7. Commits the transaction.

**Impact assessment:**

- The in-memory `Store` is the primary data source; SQLite is a durable projection. This is architecturally correct for a desktop app.
- The `DELETE + INSERT` pattern means every persist is O(N) in total entity count, not O(1) for the changed entity.
- For the typical desktop workload (tens of runs, hundreds of items), this is fine. The transaction is single-statement-batched within a single SQLite write, so there is no intermediate state visible to readers (WAL handles that).
- The `persistMu` mutex serializes all persists. Since every write method calls `syncPersist`, concurrent writes from different goroutines (e.g., two runs finishing simultaneously) will serialize correctly but one will block on the other's full persist.
- **Risk:** If the data volume grows significantly (thousands of runs with large diff content), the full-snapshot write will degrade. There is no incremental diff mechanism.

**Recommendation (low priority):** For production scaling, consider an incremental row-level persist that only writes changed rows. Current approach is acceptable for desktop scale.

### 1.3 Seed Data

**Idempotent: Yes.** `SeedIfEmpty` checks `len(repo.ListProjects()) > 0` before writing anything. A package-level `seedMu` mutex prevents concurrent seeding from racing.

Tests confirm:
- `TestSeedIfEmpty_SkipNonEmpty`: Pre-existing project prevents seeding.
- `TestSeedIfEmpty_Idempotent`: Double-seed produces no duplicates.
- `TestSeedIfEmpty_BuilderRunEvidence`: Verifies diffs, artifacts, previews are seeded correctly.
- `TestSeedIfEmpty_PerThreadEvidence`: Every thread with a run has at least one evidence item.

### 1.4 Schema & Migrations

**Migration system:** Version-numbered migrations with forward and rollback support.

4 migrations defined:
1. `snapshot_store` — Creates `agenthub_store_snapshots` table.
2. `relational_edge_lifecycle` — Creates `edge_owners`, `edge_workspaces`, `edge_runs`, `edge_artifacts`, `edge_diffs`, `edge_previews` with proper foreign keys, `ON DELETE CASCADE`, and indexes.
3. `artifact_content_source_readiness` — Adds content source columns to `edge_artifacts`.
4. `row_first_store_contract` — Creates `agenthub_store_rows` table for per-entity-row storage (primary data source alongside the JSON snapshot).

**Migration properties:**
- Applied within a transaction.
- Version/name mismatch detection (`validateSQLiteAppliedMigrations`).
- Rollback support via `RollbackSQLiteMigrations(path, targetVersion)`.
- `agenthub_store_rows` uses `PRIMARY KEY(row_kind, row_id)` composite key.

**Load strategy:** On startup, `load()` first tries to load from `agenthub_store_rows` (row-first). If no rows exist, falls back to the JSON snapshot in `agenthub_store_snapshots`. This provides backward compatibility with pre-migration-4 databases.

**Foreign keys on the in-memory Store:** The in-memory `Store` does not use foreign keys (it's a Go map). Referential integrity is enforced by the application logic (e.g., `CreateRun` checks that the project and thread exist).

### 1.5 Store Layer Summary

| Dimension | Status |
|---|---|
| WAL mode | Enabled |
| Connection safety | Single conn, busy timeout, foreign keys ON |
| Snapshot persist | Full delete+reinsert (O(N)), acceptable for desktop |
| Seed idempotency | Checked, mutex-guarded, tested |
| Migrations | Versioned, transactional, forward+rollback |
| Load path | Row-first, JSON snapshot fallback |
| In-memory locking | `sync.RWMutex` on Store, `sync.Mutex` on persist |

---

## 2. Process Executor Concurrency Audit

### 2.1 Mutex Usage

`ProcessExecutor` uses a single `sync.Mutex` (`mu`) protecting seven maps: `running`, `stdins`, `processes`, `runOutputs`, `runToAgent`, `hubTasks`, `hubOutputs`.

**Lock ordering analysis:**

| Method | Locks Acquired | Notes |
|---|---|---|
| `Start` | `e.mu` (in Start), then goroutine runs lockless | Cancel func is inserted atomically under lock before goroutine starts |
| `Cancel` | `e.mu` (partial, three separate lock/unlock), then `cancel()` | Three separate lock acquisitions: (1) stdin write, (2) cancel func read, (3) process read. No nested locks. |
| `run` | `e.mu` for stdin/process/runOutputs/hubTasks/hubOutputs | Multiple separate lock acquisitions within the goroutine, never holding mu across blocking operations |
| `finish` | `e.mu` | Called at end of `run` goroutine, after all work is done |
| `SpawnSubAgent` | `e.mu` for runToAgent | Separate acquisitions |
| `hubTaskID` | `e.mu` | Read-only |

**Deadlock risk: Low.** The executor never acquires `mu` while holding `Store.mu` or any other lock. The `run` goroutine releases `mu` before calling blocking operations (pipe reads, cmd.Wait).

**Potential issue in `Cancel`:** The method acquires `e.mu` three times sequentially (stdin write, cancel func lookup, process lookup). Between these acquisitions, another goroutine could call `finish` and delete the entries. However, the code checks for existence at each step and handles missing entries gracefully. This is not a bug, but it is a TOCTOU window.

### 2.2 Context Propagation

- `Start` creates a `context.WithTimeout(context.Background(), e.runTimeout)` with a 30-minute default.
- The context is passed to `exec.CommandContext`, which kills the process on cancellation.
- The context is also passed to the stream parser via `publishStructuredOutput`.
- Budget context (`CtxBudgetKey`) and workdir context (`CtxWorkDir`) are injected via `context.WithValue`.

**Verdict:** Context propagation is correct. The timeout ensures no run hangs forever.

### 2.3 Cleanup & Zombie Process Prevention

The cleanup chain on cancellation is:

1. `Cancel` writes a control-protocol interrupt via stdin.
2. `Cancel` calls `cancel()` on the context.
3. A goroutine waits `shutdownGracePeriod` (10s), sends `os.Interrupt` (SIGTERM on Unix), waits `shutdownForceTimeout` (5s), then calls `proc.Kill()`.
4. `exec.CommandContext` also kills the process when context expires.
5. `finish` (deferred from `run`) cleans up all maps.

**On Unix:** `setResourceLimits` sets `Setpgid: true` for process group isolation. SIGTERM is sent first, then SIGKILL after timeout.

**On Windows:** `setResourceLimits` sets `CREATE_NEW_PROCESS_GROUP`. After the grace period, `proc.Kill()` is called directly (no SIGTERM/SIGKILL distinction on Windows).

**Zombie risk:** Low. The `cmd.Wait()` call in `run` reaps the process. The cancellation goroutine also calls `proc.Wait()` after `proc.Kill()`. However, there is a subtle issue: the cancellation goroutine calls `proc.Kill()` + `proc.Wait()` in a separate goroutine, while the main `run` goroutine also calls `cmd.Wait()`. Calling `Wait()` twice on the same process is safe in Go (the second call returns the same error), but it is worth noting.

### 2.4 Stream Piping

- `stdout` and `stderr` are read via `io.Reader` from `cmd.StdoutPipe()` / `cmd.StderrPipe()`.
- A `sync.WaitGroup` ensures both pipes are fully drained before `cmd.Wait()` is called. This is correct: the Go docs warn that `Wait` will close the pipe descriptors, so readers must finish first.
- An output limiter (`runOutputLimiter`) caps stdout/stderr at 1MB with truncation logging.
- For structured output (adapter mode), stdout goes to `publishStructuredOutput` which calls `adapter.ParseStream`.

**Blocking risk:** The `publishOutput` loop reads from the pipe in a blocking `Read()` call. If the pipe is not closed (e.g., child process hangs), the goroutine blocks until the context cancellation kills the process, which closes the pipe. This is correct.

### 2.5 Security Hooks

**All three hooks are called:**

1. **PreToolUse:** `SecureEmitter.emitWithPreToolUse` intercepts `tool_call` events, runs `HookChain.RunPreToolUse`, which calls `SecurityHook.PreToolUse`. This classifies tool risk and blocks dangerous patterns.
2. **PostToolUse:** `SecureEmitter.emitWithPostToolUse` intercepts `tool_result` events, runs `HookChain.RunPostToolUse`, which calls `SecurityHook.PostToolUse`. Currently a pass-through.
3. **PermissionRequest:** `SecurityHook.PermissionRequest` is called by the adapter's permission flow. The `DecisionLoop` also tracks `permission_requested` events and enriches them with step metadata.

**The secure emitter is applied in `publishStructuredOutput`:**
```go
emitter = adapters.NewSecureEmitter(ctx, emitter, adapters.HookChain{adapters.NewSecurityHook()})
```

This wraps the emitter chain at the ProcessExecutor level, covering all adapters (Claude Code, Codex, OpenCode, SDK adapters).

**SEC-02 enforcement:** `bypassPermissions` is explicitly rejected at the executor level in the `run` method, falling back to `"default"` mode with a warning log.

### 2.6 Budget Enforcement

**Max-turns / max-steps:** Implemented via the `DecisionLoop`:
- Each `tool_call` event increments `currentStep`.
- When `currentStep >= maxSteps` (default 50), a force-finish interrupt is sent via stdin.
- Warning emitted 3 steps before limit.

**Max-budget (USD):** Not directly enforced by the ProcessExecutor. The `--max-budget-usd` flag is passed to the CLI adapter's command arguments but is not independently enforced by the executor itself. This relies on the CLI (e.g., Claude Code) to enforce the budget.

**Context budget (tokens):** Tracked via `runnerctx.ContextBudget` injected into the parser context. When usage exceeds the compaction threshold (85%), a `context_compaction` event is emitted. This is monitoring, not enforcement.

### 2.7 Process Executor Summary

| Dimension | Status | Risk |
|---|---|---|
| Mutex correctness | Single mutex, no nesting, correct granularity | Low |
| Deadlock | No lock ordering violations | None |
| Context propagation | Timeout context, proper cancellation | Correct |
| Zombie prevention | SIGTERM+SIGKILL escalation, Wait() called | Low |
| Stream piping | WaitGroup drain, output limiting | Correct |
| Security hooks | PreToolUse, PostToolUse, PermissionRequest all wired | Complete |
| Max-steps enforcement | DecisionLoop with force-finish | Implemented |
| Max-budget enforcement | CLI-side only, not executor-enforced | Gap (by design) |

---

## 3. HTTP Server Review

### 3.1 Route Registration

Routes are registered via `handler.RegisterRoutes(mux)` on a standard `http.ServeMux`. Additional endpoints:
- Debug endpoints (health, pprof, metrics, config, state) via `debugpkg.RegisterEndpoints`.
- MCP endpoint at `/mcp` via `mcp.NewServer`.

The `RegisterRoutes` method is defined on `api.Handler` (not shown in this review but the pattern is standard).

### 3.2 Middleware Stack

The middleware chain (outer to inner):
1. `corsMiddleware` — Origin validation for remote mode, CORS headers.
2. `restTimeoutMiddleware` — 30-second timeout for non-WebSocket requests; WebSocket connections bypass.
3. `localAuthMiddleware` — Bearer token or Hub JWT validation. Exempts OPTIONS and `/v1/health`.

**CORS:**
- In local mode, only loopback origins are trusted (checked by `security.IsAllowedOrigin`).
- In remote mode, only explicitly listed origins are allowed.
- Credentials forwarding is explicitly denied (`Access-Control-Allow-Credentials: false`).

**Auth:**
- Auto-generates a random 32-byte token (`aght_<hex>`) in non-dev mode when neither local auth nor Hub JWT is configured.
- Constant-time comparison for token validation.
- Hub JWT validation via HS256 with device ID scoping.
- TokenDance bearer tokens (`td_` prefix) are explicitly skipped to avoid confusion.

### 3.3 Graceful Shutdown

```go
signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
<-stop
srv.Shutdown(ctx) // 10-second timeout
handler.Bus.Close() // Flush event log
```

**Verdict:** Proper SIGINT/SIGTERM handling with a 10-second graceful shutdown window. The event bus is closed after the HTTP server shuts down, ensuring no events are lost.

### 3.4 HTTP Server Summary

| Dimension | Status |
|---|---|
| Route registration | Standard ServeMux, debug + MCP endpoints |
| CORS | Origin whitelist, credentials denied |
| Auth | Auto-generated token or Hub JWT, constant-time compare |
| Timeout | 30s REST, unlimited WebSocket |
| Graceful shutdown | SIGINT/SIGTERM, 10s drain, event bus flush |
| WebSocket | Origin check, long-lived connections |

---

## 4. Entry Point Completeness

### 4.1 Flag Coverage

| Flag | Env Variable | Default | Description |
|---|---|---|---|
| `--addr` | `AGENTHUB_ADDR` | `127.0.0.1:3210` | Listen address |
| `--store-file` | `AGENTHUB_STORE_FILE` | `""` | JSON snapshot file |
| `--store-backend` | `AGENTHUB_STORE_BACKEND` | `""` | memory, file, sqlite |
| `--store-db` | `AGENTHUB_STORE_DB` | `""` | SQLite database path |
| `--store-readiness` | - | `false` | Readiness check mode |
| `--runner-profile` | `AGENTHUB_RUNNER_PROFILE` | `""` | Preset: agenthub-runner-mock, claude-code, codex, opencode |
| `--runner-command` | `AGENTHUB_RUNNER_COMMAND` | `""` | Process executable |
| `--runner-arg` | - | repeatable | Arguments to runner command |
| `--runner-env` | - | repeatable | Environment for runner command |
| `--runner-workdir` | `AGENTHUB_RUNNER_WORKDIR` | `""` | Working directory |
| `--workspace-allowlist` | `AGENTHUB_WORKSPACE_ALLOWLIST` | `""` | Allowed workspace roots |
| `--local-auth-token` | `AGENTHUB_EDGE_AUTH_TOKEN` | `""` | Local bearer token |
| `--hub-jwt-secret` | `AGENTHUB_HUB_JWT_SECRET` | `""` | Hub JWT shared secret |
| `--edge-device-id` | `AGENTHUB_EDGE_DEVICE_ID` | `""` | Edge device ID |
| `--remote-mode` | `AGENTHUB_REMOTE_MODE` | `false` | Allow remote connections |
| `--allowed-origin` | `AGENTHUB_ALLOWED_ORIGINS` | repeatable | CORS origins |
| `--dev` | `AGENTHUB_DEV` | `false` | Disable auto-auth |
| `--tailscale` | `AGENTHUB_TAILSCALE` | `false` | Tailscale mode |
| `--tailscale-ip` | `AGENTHUB_TAILSCALE_IP` | `""` | Tailscale IP |
| `--agent-default` | `AGENTHUB_AGENT_DEFAULT` | `""` | Default adapter ID |
| `--claude-code-path` | `AGENTHUB_CLAUDE_CODE_PATH` | `claude` | Claude binary path |
| `--codex-path` | `AGENTHUB_CODEX_PATH` | `codex` | Codex binary path |
| `--opencode-path` | `AGENTHUB_OPENCODE_PATH` | `opencode` | OpenCode binary path |
| `--agent-model` | `AGENTHUB_AGENT_MODEL` | `""` | Model override |
| `--runtime-manifest` | `AGENTHUB_RUNTIME_MANIFESTS` | repeatable | Custom runtime manifests |
| `--anthropic-sdk-path` | `AGENTHUB_ANTHROPIC_SDK_PATH` | `""` | Anthropic SDK adapter |
| `--openai-sdk-path` | `AGENTHUB_OPENAI_SDK_PATH` | `""` | OpenAI SDK adapter |
| `--skills-dir` | `AGENTHUB_SKILLS_DIRS` | repeatable | SKILL.md search dirs |
| `--event-log-path` | `AGENTHUB_EVENT_LOG_PATH` | `""` | Event log persistence |

**All flags have corresponding env variables and are documented in the usage string.**

### 4.2 Runner Profile Resolution

`applyRunnerProfile` resolves profiles:
- `agenthub-runner-mock`: No-op (uses mock executor).
- `claude-code`: Sets `RunnerCommand` to `--claude-code-path`, `AgentDefault` to `"claude-code"`.
- `codex`: Sets `RunnerCommand` to `--codex-path`, `AgentDefault` to `"codex"`.
- `opencode`: Sets `RunnerCommand` to `--opencode-path`, `AgentDefault` to `"opencode"`.

Explicit `--runner-command` takes precedence over profile defaults.

### 4.3 Workspace Allowlist Enforcement

The workspace allowlist is configured via `--workspace-allowlist` (repeatable) or `AGENTHUB_WORKSPACE_ALLOWLIST` env (path-list separator).

**Enforcement:** Passed to both `api.Handler.WorkspaceAllowlist` and `mcp.NewServer.SetWorkspaceAllowlist`. The handler checks the allowlist when processing run requests with a `workDir` parameter.

**Fail-closed:** When the allowlist is empty, requests with a non-empty `workDir` are rejected. A startup warning is logged:
> "workspace allowlist is empty -- requests with a non-empty workDir will be rejected"

### 4.4 Adapter Registration

`buildAdapterRegistry` registers adapters in this order:
1. Claude Code (if `--claude-code-path` set)
2. Codex (if `--codex-path` set)
3. OpenCode (if `--opencode-path` set)
4. Runtime manifests (from `--runtime-manifest`, repeatable)
5. Anthropic SDK (if `--anthropic-sdk-path` set)
6. OpenAI SDK (if `--openai-sdk-path` set)
7. Orchestrator (auto-created if Claude Code is registered)

Default adapter is set via `--agent-default` or the runner profile.

### 4.5 Store Backend Resolution

`newStoreFromConfig`:
- `sqlite`: Requires `--store-db`, uses `NewSQLite`.
- `memory`: Uses in-memory `New()`.
- `file`: Requires `--store-file`, uses `NewFile`.
- Empty (legacy): If `--store-file` is set, uses `NewFile`; otherwise in-memory.

Validation ensures mutual exclusivity (e.g., `--store-file` cannot be combined with `--store-backend memory`).

### 4.6 Entry Point Summary

| Dimension | Status |
|---|---|
| Flag completeness | All flags documented, env fallbacks provided |
| Runner profiles | 4 presets, explicit command overrides profile |
| Workspace allowlist | Fail-closed, enforced in handler + MCP |
| Adapter registration | 7 adapter types, ordered registration |
| Store backend | 3 backends + legacy auto-detect, validation |

---

## 5. Findings Summary

### Critical Issues
None found.

### Medium Issues
1. **Full-snapshot persist pattern** (store): Every write triggers a full `DELETE + INSERT` of all rows. This is architecturally intentional (SQLite is a projection of the in-memory store) but will degrade at scale. **Recommendation:** Monitor and consider incremental row-level persist if data volume grows beyond thousands of entities.

2. **Cancel TOCTOU window** (process_executor): `Cancel` acquires `e.mu` three times separately. Between acquisitions, `finish` could clean up entries. The code handles missing entries gracefully, but the pattern is fragile for future modifications. **Recommendation:** Consider refactoring to a single lock acquisition with all cleanup in one critical section.

### Low Issues
3. **Double Wait() on process** (process_executor): The cancellation goroutine calls `proc.Wait()` after `proc.Kill()`, and the main `run` goroutine calls `cmd.Wait()`. Go handles this safely, but it is worth documenting.

4. **Max-budget not executor-enforced** (process_executor): The `--max-budget-usd` flag is passed to CLI arguments but not independently enforced. This relies on the CLI adapter to respect it. This is a design choice, not a bug.

5. **Store.persistMu is Mutex not RWMutex** (store): `LastPersistError()` takes an exclusive lock to read `lastErr`. An `RWMutex` would allow concurrent reads of the error value, but the impact is negligible since `LastPersistError` is only called during run status transitions.

### Positive Observations
- Clean separation between in-memory Store (primary) and SQLite/FileStore (durable projection).
- Migration system is robust: versioned, transactional, with rollback support and validation.
- Process lifecycle management handles graceful shutdown with stdin interrupt -> SIGTERM -> SIGKILL escalation.
- Security hooks are comprehensively wired at the ProcessExecutor level, covering all adapters uniformly.
- Seed data is properly idempotent with mutex protection and thorough test coverage.
- DecisionLoop provides max-steps enforcement with force-finish capability.
- Hub callback system is fire-and-forget (errors logged, never block lifecycle).
