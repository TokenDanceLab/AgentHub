# OpenHands — Workspace Sandbox Adoption Map

> **Reference**: OpenHands (`reference/openhands/openhands/app_server/sandbox/`)
> **Target**: AgentHub edge-server (`edge-server/internal/lifecycle/`)
> **Date**: 2026-05-24
> **Previous**: `01-overview.md`, `02-agent-protocol.md`

---

## Executive Summary

OpenHands implements a **3-level sandbox architecture** (Docker, Process, Remote) behind a unified `SandboxService` ABC, with full lifecycle management (start/resume/pause/delete), state machine, health checks, and session-key authentication. AgentHub currently has a flat `ProcessExecutor` that runs `exec.CommandContext` — no sandbox abstraction, no isolation levels, no lifecycle beyond Start/Cancel. This map defines a `WorkspaceProvider` interface for AgentHub modeled on OpenHands' patterns, with concrete implementation plans referencing actual AgentHub files.

---

## 1. WorkspaceProvider Interface: Adopt OpenHands SandboxService ABC Pattern

### Finding: OpenHands uses SandboxService ABC as contract; AgentHub needs equivalent WorkspaceProvider
**Reference**: `reference/openhands/openhands/app_server/sandbox/sandbox_service.py:29-232` — `SandboxService(ABC)` defines seven abstract operations:
```
search_sandboxes()       batch_get_sandboxes()
get_sandbox(id)          start_sandbox(spec_id, sandbox_id)
resume_sandbox(id)       pause_sandbox(id)
delete_sandbox(id)       pause_old_sandboxes(max)
```

Each returns `SandboxInfo` (`sandbox_models.py:33-56`) with status, session_api_key, exposed_urls, and created_at.

**AgentHub**: `edge-server/internal/lifecycle/executor.go:5-16` — `RunExecutor` interface has only two methods:
```go
type RunExecutor interface {
    Start(run store.Run, ctx RunProcessContext) error
    Cancel(runID string) CancelResult
}
```

There is **no sandbox concept** — no workspace, no isolation, no lifecycle management. The `ProcessExecutor` (`process_executor.go`) directly calls `exec.CommandContext` with a workdir.

**Change**: Create `edge-server/internal/lifecycle/workspace_provider.go`:
```go
type WorkspaceStatus string
const (
    WorkspaceStarting WorkspaceStatus = "starting"
    WorkspaceRunning  WorkspaceStatus = "running"
    WorkspacePaused   WorkspaceStatus = "paused"
    WorkspaceError    WorkspaceStatus = "error"
)

type WorkspaceInfo struct {
    ID             string
    Status         WorkspaceStatus
    WorkDir        string
    ExposedUrls    []ExposedUrl
    SessionAPIKey  string
    CreatedAt      time.Time
}

type ExposedUrl struct {
    Name string  // "agent_server", "vscode", "web_preview"
    URL  string
    Port int
}

type WorkspaceProvider interface {
    // Lifecycle
    StartWorkspace(ctx context.Context, spec WorkspaceSpec) (*WorkspaceInfo, error)
    ResumeWorkspace(ctx context.Context, workspaceID string) error
    PauseWorkspace(ctx context.Context, workspaceID string) error
    DeleteWorkspace(ctx context.Context, workspaceID string) error

    // Query
    GetWorkspace(ctx context.Context, workspaceID string) (*WorkspaceInfo, error)
    WaitReady(ctx context.Context, workspaceID string, timeout time.Duration) (*WorkspaceInfo, error)

    // Lifecycle management
    EnforceLimit(maxWorkspaces int) (pausedIDs []string, err error)
}
```
`ProcessExecutor` then implements this interface, and `RunExecutor.Start` delegates to `WorkspaceProvider.StartWorkspace`.

**Priority**: **P0** | **Effort**: 4d

---

## 2. WorkspaceSpec: Adopt SandboxSpec Template Pattern

### Finding: OpenHands uses SandboxSpec for reusable blueprints; AgentHub has ad-hoc config
**Reference**: `reference/openhands/openhands/app_server/sandbox/sandbox_spec_models.py` — `SandboxSpecInfo`:
```python
class SandboxSpecInfo(BaseModel):
    id: str              # Docker image tag
    command: list[str]   # Container start command
    initial_env: dict    # Environment variables
    working_dir: str     # Default: /home/openhands/workspace
```
Plus `sandbox_spec_service.py:74-133` — `get_agent_server_env()` auto-forwards `LLM_*` and `LMNR_*` env vars from host.

**AgentHub**: `edge-server/internal/lifecycle/process_profile.go:10-15` — `RunnerProfile` is a flat struct:
```go
type RunnerProfile struct {
    Command          string
    Template         CommandTemplate
    ExtraEnvTemplate CommandTemplate
    WorkDir          string
}
```
This is command-oriented, not workspace-oriented. There is no reusable template concept — each run's profile is constructed from CLI flags/API params.

**Change**: Create `edge-server/internal/lifecycle/workspace_spec.go`:
```go
type WorkspaceSpec struct {
    ID          string            // Template identifier
    Image       string            // For Docker: container image
    Command     []string          // Entry point
    InitialEnv  map[string]string // Environment injected at start
    WorkDir     string            // Default working directory
    ExposedPorts []ExposedPortSpec
    Mounts      []VolumeMount
    MaxLifetime time.Duration     // Auto-pause after this duration
}
```
This maps to OpenHands' SandboxSpecInfo and provides a reusable blueprint for workspace creation. The existing `RunnerProfile` becomes a template expansion target within a `WorkspaceSpec`.

**Priority**: **P0** | **Effort**: 2d

---

## 3. DockerWorkspaceProvider: AgentHub's First Container-Level Isolation

### Finding: OpenHands primary implementation is Docker; AgentHub has zero container support
**Reference**: `reference/openhands/openhands/app_server/sandbox/docker_sandbox_service.py:82-553` — `DockerSandboxService`:
- `start_sandbox()` (line 360): generates base62 ID + session API key → `docker_client.containers.run()` with detach + init
- Port mapping (line 391-431): bridge mode maps to random host ports; host mode uses container ports directly
- `_container_to_checked_sandbox_info()` (line 233): health check via `httpx_client.get(agent_server_url/health)` with `startup_grace_seconds` (15s default) → status ERROR after grace period
- `pause_old_sandboxes()` (line 188): sorts by `created_at`, pauses oldest to maintain `max_num_sandboxes` (default 5)
- Session API key (line 392): 32-byte random base62, injected as `OH_SESSION_API_KEYS_0` env var
- Volume mounts (line 61-68): `VolumeMount{host_path, container_path, mode}` for shared filesystem areas
- KVM passthrough (line 454): `/dev/kvm:/dev/kvm:rwm` for hardware virtualization
- Host network mode (line 448): via `network_mode='host'` when `AGENT_SERVER_USE_HOST_NETWORK=true`
- Extra hosts (line 480): `host.docker.internal:host-gateway` for Docker-to-host communication

**AgentHub**: `edge-server/internal/lifecycle/process_executor.go:32-73` — `ProcessExecutor` runs `exec.CommandContext(ctx, cmdPath, args...)` with only `cmd.Dir = workDir`. No container, no port mapping, no health check, no session key, no volume mounts, no limit enforcement.

**Change**: Create `edge-server/internal/lifecycle/docker_workspace.go` implementing `WorkspaceProvider`:
1. Use Go Docker SDK (`github.com/docker/docker/client`) to manage containers
2. `StartWorkspace()`: generate random ID + session key → create container with `WorkspaceSpec` → map ports → health check → return `WorkspaceInfo`
3. `WaitReady()`: poll `GET {exposed_url}/health` every 2s until 2xx response or timeout
4. `PauseWorkspace()`: `docker pause <container>` → update status
5. `DeleteWorkspace()`: `docker stop` + `docker rm` + remove volume
6. `EnforceLimit()`: list running containers, `docker pause` oldest if over max
7. Feature-gate behind config flag `sandbox.provider = "docker"` (default: `"process"`)

**Priority**: **P1** | **Effort**: 7d

---

## 4. ProcessWorkspaceProvider: Elevate Current ProcessExecutor

### Finding: OpenHands ProcessSandboxService provides template for AgentHub's current path
**Reference**: `reference/openhands/openhands/app_server/sandbox/process_sandbox_service.py:67-461` — `ProcessSandboxService`:
- Each sandbox is a `subprocess.Popen` with its own `working_dir` (line 139-142)
- Port allocation: `_find_unused_port()` starting from `base_port` (line 91-101)
- Session API key: 32-byte random base62 (line 309)
- Process tracking via global `_processes` dict (line 63): `{sandbox_id: ProcessInfo}`
- `ProcessInfo` (line 48-59): `pid, port, user_id, working_dir, session_api_key, created_at, sandbox_spec_id`
- Status derived from `psutil.Process.is_running()` + HTTP health check
- Log file: `{working_dir}/.openhands-agent-server.log` (line 139)
- Cleanup: `shutil.rmtree(working_dir)` on delete (line 397)

**AgentHub**: `edge-server/internal/lifecycle/process_executor.go` is close but missing:
- No workspace directory isolation (uses `cfg.WorkDir` directly, shared across runs)
- No port management (no concept of ports)
- No session API key (no workspace authentication)
- No health checking
- No limit enforcement
- No lifecycle states (STARTING/RUNNING/PAUSED/ERROR)

**Change**: Upgrade `ProcessExecutor` to implement `WorkspaceProvider`:
1. `StartWorkspace()`: create dedicated subdirectory under a `workspaces/` root → spawn process → health check → return `WorkspaceInfo`
2. Track workspaces in a `sync.Map` (replacing flat `map[string]context.CancelFunc` on line 40)
3. Add `WaitReady()`: poll `http://localhost:{port}/alive` for workspace-level health
4. Add `PauseWorkspace()`: signal process (SIGSTOP equivalent) + update status
5. Add `EnforceLimit()`: kill oldest workspace processes when over `maxWorkspaces`
6. Add workspace-level port allocation and session key generation

**Priority**: **P0** | **Effort**: 5d

---

## 5. Workspace Status State Machine

### Finding: OpenHands has explicit state machine; AgentHub uses flat status strings
**Reference**: `reference/openhands/openhands/app_server/sandbox/sandbox_models.py:9-16` — `SandboxStatus` enum:
```
STARTING → RUNNING → PAUSED
                ↓       ↓
              ERROR   MISSING
```

Plus `docker_sandbox_service.py:114-127` — Docker status mapping:
```python
'running' → RUNNING, 'paused' → PAUSED,
'exited' → PAUSED, 'created' → STARTING,
'restarting' → STARTING, 'removing' → MISSING,
'dead' → ERROR
```

**AgentHub**: `edge-server/internal/lifecycle/process_executor.go` — Run statuses are flat strings passed to event store: `"queued"`, `"started"`, `"cancelling"`, `"cancelled"`, `"failed"`, `"finished"`. No states between `queued` and `started` for workspace initialization; no `PAUSED` or `ERROR` states.

**Change**: Create `edge-server/internal/lifecycle/workspace_status.go`:
```go
type WorkspaceStatus string
const (
    WorkspaceCreating WorkspaceStatus = "creating"  // allocation/startup
    WorkspaceRunning  WorkspaceStatus = "running"   // healthy
    WorkspacePaused   WorkspaceStatus = "paused"    // suspended
    WorkspaceError    WorkspaceStatus = "error"     // failed health check
    WorkspaceStopped  WorkspaceStatus = "stopped"   // deleted
)

var validTransitions = map[WorkspaceStatus][]WorkspaceStatus{
    WorkspaceCreating: {WorkspaceRunning, WorkspaceError},
    WorkspaceRunning:  {WorkspacePaused, WorkspaceError, WorkspaceStopped},
    WorkspacePaused:   {WorkspaceRunning, WorkspaceError, WorkspaceStopped},
    WorkspaceError:    {WorkspaceStopped},
}
```
Add `TransitionStatus(from, to WorkspaceStatus) error` to enforce valid transitions. Wire into `ProcessExecutor.run()` to update workspace status alongside run status.

**Priority**: **P1** | **Effort**: 2d

---

## 6. Health Check + Startup Grace Period

### Finding: OpenHands validates sandbox health before reporting RUNNING; AgentHub just starts
**Reference**: `reference/openhands/openhands/app_server/sandbox/sandbox_service.py:78-126` — `wait_for_sandbox_running()`:
- Polls `get_sandbox(id)` every `poll_interval` (default 2s)
- Checks status: RUNNING → optionally health-check agent server via `httpx_client.get(/alive)`
- ERROR → raise immediately
- Timeout after `timeout` seconds (default 120) → raise SandboxError

Plus `docker_sandbox_service.py:233-280` — `_container_to_checked_sandbox_info()`:
- After `startup_grace_seconds` (default 15s) without `/health` response → status = ERROR
- Before grace period → status = STARTING

**AgentHub**: `edge-server/internal/lifecycle/process_executor.go:79-101` — `Start()` immediately launches goroutine, sets status to `"started"` on `cmd.Start()` success. No health check, no grace period, no retry. If the child process starts but immediately crashes, AgentHub won't know until `cmd.Wait()` returns.

**Change**: Add to `ProcessExecutor.Start()`:
1. After `cmd.Start()`: poll workspace health endpoint every 1s for up to `startupGracePeriod` (default 15s)
2. If health check fails after grace period: set status to `"failed"` with reason
3. If health passes: set status to `"started"` as currently done
4. Wire this through `WorkspaceProvider.WaitReady()` → `timeout` parameter from caller

**Priority**: **P0** | **Effort**: 2d

---

## 7. Session API Key Authentication

### Finding: OpenHands authenticates sandbox access via session keys; AgentHub has no workspace auth
**Reference**: `reference/openhands/openhands/app_server/sandbox/sandbox_service.py:24-26` — Session API key pattern:
```python
SESSION_API_KEY_VARIABLE = 'OH_SESSION_API_KEYS_0'
```
Generated as `base62.encodebytes(os.urandom(32))` per sandbox. Injected as env var. Validate via `sandbox_router.py` checking `X-Session-API-Key` header. The key is only returned when status is RUNNING (line 79).

`remote_sandbox_service.py:74-76` — SHA-256 hash of key stored in DB for efficient lookup without storing raw key.

**AgentHub**: No per-workspace authentication. The `ProcessExecutor.envForRun` (line 300-320) injects `AGENTHUB_RUN_ID`, `AGENTHUB_PROJECT_ID`, `AGENTHUB_THREAD_ID` but these are identifiers, not authentication tokens.

**Change**: Add to `ProcessExecutor.Start()` (or new `ProcessWorkspaceProvider.StartWorkspace()`):
1. Generate `sessionAPIKey := base62.Random(32)` per workspace start
2. Inject as `AGENTHUB_SESSION_API_KEY` env var into child process
3. Hash and store in workspace info for lookup
4. Return raw key only in `WorkspaceInfo` (when status RUNNING) — nil otherwise
5. Optional: add middleware in edge-server HTTP layer to validate `X-Session-API-Key` for workspace-scoped API calls

**Priority**: **P1** | **Effort**: 2d

---

## 8. Workspace Limit Enforcement

### Finding: OpenHands auto-pauses oldest sandboxes; AgentHub has no resource limits
**Reference**: `reference/openhands/openhands/app_server/sandbox/sandbox_service.py:188-229` — `pause_old_sandboxes(max_num_sandboxes)`:
1. Get all RUNNING sandboxes
2. If count ≤ max, no-op
3. Sort by `created_at` (oldest first)
4. Pause `count - max` oldest

`docker_sandbox_service.py:374` — `start_sandbox` calls `pause_old_sandboxes(self.max_num_sandboxes - 1)` before creating new sandbox.

Default limits: Docker = 5 (line 578), Process = unlimited, Remote = 10 (line 901).

**AgentHub**: No limit enforcement. `process_executor.go:40` uses an unbounded `map[string]context.CancelFunc` for `running` processes. Multiple concurrent runs could exhaust system resources.

**Change**: Add `EnforceLimit(maxWorkspaces int)` to `WorkspaceProvider` interface:
1. Count running workspaces
2. If over max: sort by start time, kill/cancel oldest
3. Return list of paused workspace IDs
4. Call `EnforceLimit(max-1)` before `StartWorkspace()` in `ProcessExecutor`

Add config: `agent.workspace.maxConcurrent int` (default 5).

**Priority**: **P1** | **Effort**: 2d

---

## 9. ExposedUrl Pattern for Workspace Services

### Finding: OpenHands models workspace services as named URLs; AgentHub has flat stdout/stderr
**Reference**: `reference/openhands/openhands/app_server/sandbox/sandbox_models.py:18-30` — `ExposedUrl`:
```python
class ExposedUrl(BaseModel):
    name: str   # "AGENT_SERVER", "VSCODE", "WORKER_1", "WORKER_2"
    url: str
    port: int
```
Four standard service names (line 27-30). Each sandbox returns `exposed_urls` only when RUNNING.

**AgentHub**: No exposed URL concept. `process_executor.go` reads `stdout`/`stderr` pipes and publishes raw byte chunks. There is no way for AgentHub to know what services a workspace exposes (Jupyter, web preview, API server).

**Change**: Add to `WorkspaceInfo`:
```go
type ExposedUrl struct {
    Name string  // "web_preview", "api_server", "jupyter", "vscode"
    URL  string
    Port int
}
```
Docker mode: derived from port mappings. Process mode: derived from port allocation in workspace spec. Wire into `WorkspaceProvider.GetWorkspace()` return value.

**Priority**: **P2** | **Effort**: 2d

---

## 10. Environment Variable Forwarding

### Finding: OpenHands auto-forwards env by prefix; AgentHub has full whitelist approach
**Reference**: `reference/openhands/openhands/app_server/sandbox/sandbox_spec_service.py:74-133` — `get_agent_server_env()`:
- `AUTO_FORWARD_PREFIXES = ('LLM_', 'LMNR_')` (line 74)
- All env vars with these prefixes are auto-forwarded to agent-server container
- Additional overrides via `OH_AGENT_SERVER_ENV` JSON env var

**AgentHub**: `edge-server/internal/lifecycle/env_sanitizer.go:10-242` — `SanitizedEnv()` uses a comprehensive whitelist (200+ env vars) but this is an all-or-nothing approach — either inherit full parent env (when `profileEnv` is non-nil) or filter to safe whitelist. No prefix-based forwarding for extensibility.

**Change**: Add prefix-based forwarding to `SanitizedEnv()`:
```go
var AutoForwardPrefixes = []string{"AGENTHUB_", "LLM_", "OBSERVABILITY_"}
```
When `profileEnv == nil`: first apply whitelist filter, then append all parent env vars matching `AutoForwardPrefixes`. This allows new AGENTHUB-prefixed configs to pass through without updating the whitelist.

**Priority**: **P2** | **Effort**: 1d

---

## 11. Adoption Priority Roadmap

| # | Finding | Priority | Effort | Dependencies |
|---|---------|----------|--------|--------------|
| 1 | WorkspaceProvider interface | **P0** | 4d | None |
| 2 | WorkspaceSpec templates | **P0** | 2d | None |
| 4 | ProcessWorkspaceProvider (upgrade) | **P0** | 5d | #1, #2 |
| 6 | Health check + startup grace period | **P0** | 2d | #4 |
| 5 | Workspace status state machine | **P1** | 2d | #1 |
| 7 | Session API key auth | **P1** | 2d | #4 |
| 8 | Workspace limit enforcement | **P1** | 2d | #4 |
| 3 | DockerWorkspaceProvider | **P1** | 7d | #1, #2 |
| 9 | ExposedUrl pattern | **P2** | 2d | #1 |
| 10 | Env var prefix forwarding | **P2** | 1d | None |

**Total P0 effort**: 13d. **Total P1 effort**: 13d. **Total P2 effort**: 3d. **Grand total**: 29d.

---

## Key AgentHub Files to Modify

| File | Current Role | Planned Change |
|------|-------------|----------------|
| `edge-server/internal/lifecycle/executor.go` | 2-method `RunExecutor` | Extend with `WorkspaceProvider` delegation |
| `edge-server/internal/lifecycle/process_executor.go` | Flat `exec.CommandContext` | Implement `WorkspaceProvider` for process-level sandbox |
| `edge-server/internal/lifecycle/process_profile.go` | `RunnerProfile` struct | Evolve into `WorkspaceSpec` (reusable blueprints) |
| `edge-server/internal/lifecycle/env_sanitizer.go` | Whitelist-based env filtering | Add prefix forwarding (+ reuse list for wrapper stripping in Subagent A) |
| `edge-server/internal/lifecycle/workspace_provider.go` | **NEW** | `WorkspaceProvider` interface + `WorkspaceInfo` + `WorkspaceStatus` |
| `edge-server/internal/lifecycle/workspace_spec.go` | **NEW** | `WorkspaceSpec` template + `ExposedUrl` + `VolumeMount` types |
| `edge-server/internal/lifecycle/docker_workspace.go` | **NEW** | `DockerWorkspaceProvider` implementation with Docker SDK |
| `edge-server/internal/lifecycle/workspace_status.go` | **NEW** | State machine with transition validation |

---

## Side-by-Side: OpenHands vs AgentHub Sandbox Architecture

```
OpenHands                              AgentHub (current)         AgentHub (planned)
─────────────────────────────────────  ────────────────────────   ──────────────────────────
SandboxService ABC                     RunExecutor (2 methods)    WorkspaceProvider (8 methods)
 ├─ DockerSandboxService               └─ ProcessExecutor          ├─ ProcessWorkspaceProvider
 ├─ ProcessSandboxService                  (direct exec.Cmd)       ├─ DockerWorkspaceProvider (P1)
 └─ RemoteSandboxService                                           └─ RemoteWorkspaceProvider (P2)

SandboxSpecInfo                        RunnerProfile              WorkspaceSpec
 ├─ image, command, env, dir            ├─ Command, Args, Env      ├─ Image, Command, InitialEnv
 └─ exposed_ports                      └─ WorkDir                  ├─ ExposedPorts, Mounts
                                                                   └─ MaxLifetime

SandboxStatus enum                     flat strings               WorkspaceStatus enum
 STARTING → RUNNING → PAUSED           queued/started/cancelling   Creating → Running → Paused
     ↓         ↓                       cancelled/failed/finished   Running  → Error   → Stopped
   ERROR    MISSING                                                (explicit transition validation)

Health check + grace period            cmd.Start() no check       WaitReady() with /health poll

Session API key (base62 32B)           AGENTHUB_RUN_ID (no auth)  AGENTHUB_SESSION_API_KEY

Limit enforcement (pause_old)          none                       EnforceLimit(maxWorkspaces)

ExposedUrl (named services)            stdout/stderr pipes only   ExposedUrl in WorkspaceInfo

Env prefix forwarding (LLM_*)          Whitelist (200+ vars)      Whitelist + prefix forwarding
```
