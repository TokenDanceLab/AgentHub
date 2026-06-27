# Open Design Daemon Architecture -- AgentHub Adoption Analysis

## 1. Overview

Open Design (OD) is a local-first design workspace with a monorepo daemon (TypeScript/Node.js). AgentHub is a distributed agent execution platform with an Edge Server (local process execution, Go) and a Hub Server (central coordination, Go). This document maps architectural patterns from OD's daemon to AgentHub's edge/hub servers, assigns adoption priorities, and provides concrete Go/TypeScript code snippets for each finding.

Status: Deep-research complete. All OD file references are relative to `reference/open-design/apps/daemon/src/`. All AgentHub file references are absolute from the repository root.

---

## 2. Server Lifecycle (P0: Core Architecture)

### Finding 2.1: Single-process daemon with Express + process spawning

**Open Design:** `server.ts:3350-3382` -- `startServer()` creates a single Express app, binds to `127.0.0.1:7456`, and spawns agent CLIs as child processes via `node:child_process.spawn`. The daemon process is the sole orchestrator -- no separate scheduler, no worker pool.

**AgentHub:** `edge-server/internal/lifecycle/process_executor.go:58-89` -- `NewProcessExecutor()` takes an event bus, store, adapter registry; manages concurrent runs up to `maxConcurrentRuns=5`. Separate Edge Server (local process) and Hub Server (coordination) -- a distributed split OD does not have.

```go
// AgentHub already has the right split. OD has single-process convenience
// but no horizontal scaling. AgentHub's pattern is preferred for production.
type ProcessExecutor struct {
    bus        *events.Bus
    store      store.RunLifecycleStore
    adapter    adapters.AgentAdapter
    adapterReg *adapters.Registry
    running    map[string]context.CancelFunc
    stdins     map[string]io.Writer
}
```

**P0 adoption:** OD's plugin snapshot system could be adopted in AgentHub for deterministic prompt replay. See Finding 6.1.

### Finding 2.2: Graceful shutdown with active-run draining

OD: `server.ts` shutdown path (invoked via `process.on('SIGTERM', ...)`) iterates active runs, sends SIGTERM, waits grace period, escalates to SIGKILL. `runs.ts:221-240` -- `shutdownActive()`.

AgentHub: `process_executor.go:162-196` -- `Cancel()` sends adapter-specific interrupt via stdin, then cancels context; `publishCancelled()` transitions run to `cancelled` state. Two-phase shutdown via `SetRunStatusIf("cancelling", ...)`.

**P0 adoption:** OD's `runs.ts` in-memory run map with client/waiter sets is simpler than AgentHub's Pattern, but AgentHub's interrupt-via-stdin approach (`adapters.WriteInterrupt`) is superior for Claude Code's graceful cleanup. Adopt AgentHub's stdin-interrupt pattern.

---

## 3. Run Lifecycle (P0: Core Architecture)

### Finding 3.1: In-memory SSE event bus with reconnection support

OD: `runs.ts:19-263` -- `createChatRunService()` maintains an in-memory `Map<string, Run>` with `events[]` ring buffer (max 2000 events). SSE clients attach via `stream(run, req, res)` with `Last-Event-ID` header support for reconnection. Terminal runs auto-cleanup after TTL (30 min).

AgentHub: `edge-server/internal/events/bus.go` (not shown, but referenced) -- event bus with publish/subscribe; `handlers.go:497-584` -- WebSocket event stream with cursor-based replay; `process_executor.go:374-527` -- publishes structured events from agent stdout.

```typescript
// OD: Simple in-memory SSE with reconnection
const stream = (run, req, res) => {
    const sse = createSseResponse(res);
    const lastEventId = Number(req.get('Last-Event-ID') || 0);
    for (const record of run.events) {
        if (record.id > lastEventId) sse.send(record.event, record.data, record.id);
    }
    if (TERMINAL_RUN_STATUSES.has(run.status)) { sse.end(); return; }
    run.clients.add(sse);
    res.on('close', () => { run.clients.delete(sse); sse.cleanup(); });
};
```

```go
// AgentHub: WebSocket with cursor-based replay
func (h *Handler) GetEvents(w http.ResponseWriter, r *http.Request) {
    cursorStr := r.URL.Query().Get("cursor")
    subID, ch, replay := h.Bus.Subscribe(cursor)
    defer h.Bus.Unsubscribe(subID)
    for _, evt := range replay { conn.WriteJSON(evt) }
    // event loop + heartbeat
}
```

**P0 adoption:** AgentHub's WebSocket + cursor replay is more robust. OD's SSE with Last-Event-ID is simpler for browser clients. AgentHub should keep WebSocket for hub-edge communication; OD's SSE pattern is best for browser UI delivery.

### Finding 3.2: Run cancel with ACP session abort

OD: `runs.ts:199-218` -- `cancel()` prefers RPC-level abort for ACP sessions (`run.acpSession.abort()`), with SIGTERM fallback after grace period. This is a Claude Code-specific optimization.

AgentHub: `process_executor.go:162-196` -- `Cancel()` writes adapter-specific interrupt to stdin, then cancels context. No ACP session tracking.

**P1 adoption:** OD's ACP/permission-rpc session abort pattern is Claude Code-specific. AgentHub's adapter interface (`adapters.AgentAdapter`) already provides `NeedsStdin()` -- this is the right abstraction. No code adoption needed unless AgentHub adds ACP protocol support.

---

## 4. Agent Adapter Layer (P0: Multi-Provider Support)

### Finding 4.1: Protocol-agnostic streaming adapter pattern

OD: Uses multiple streaming parsers:
- `claude-stream.ts` -- Claude Code `--output-format stream-json --verbose` JSONL parser
- `json-event-stream.ts` -- Unified parser for OpenCode/Gemini/Cursor/Codex JSONL streams
- `copilot-stream.ts` -- GitHub Copilot stream parser
- `qoder-stream.ts` -- Qoder stream parser

Each parser normalizes diverse CLI output formats into a unified event vocabulary: `status`, `text_delta`, `thinking_delta`, `tool_use`, `tool_result`, `usage`.

AgentHub: `edge-server/internal/adapters/adapter.go:23-43` -- `AgentAdapter` interface with `BuildCommand()` and `ParseStream()` methods. Each adapter implementation (ClaudeCode, Codex, OpenCode) normalizes output to unified bus events (e.g., `run.agent.text_delta`, `run.agent.tool_call`).

```go
// AgentHub adapter interface (already well-designed)
type AgentAdapter interface {
    Metadata() AdapterMetadata
    Capabilities() AgentCapabilities
    BuildCommand(ctx RunProcessContext) (cmdPath string, args []string, env []string, workDir string)
    ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) error
    NeedsStdin() bool
}
```

**P0 -- already well-aligned.** AgentHub's interface-based adapter pattern mirrors OD's functional parser pattern. AgentHub's go interfaces are a production-grade evolution.

### Finding 4.2: Bus event type normalization

OD: `claude-stream.ts:86-258` -- Emits typed events: `{type: 'status', label: 'initializing'}`, `{type: 'text_delta', delta: '...'}`, `{type: 'tool_use', id, name, input}`, etc.

AgentHub: `adapter.go:98-128` -- Bus event type constants: `BusEventTextDelta = "run.agent.text_delta"`, `BusEventToolCall = "run.agent.tool_call"`, `BusEventThinking = "run.agent.thinking"`, etc. AgentHub has richer event taxonomy (22 types vs OD's ~8 types).

**P1 -- adopt AgentHub additional event types that OD surfaced:**
- `BusEventPermissionRequested/Decided` -- OD has no equivalent (Claude Code handles permissions internally)
- `BusEventCompactBoundary` -- context compaction signal
- `BusEventSubAgentSpawn` -- orchestrator support
- `BusEventHookStarted/Progress/Response` -- plugin hook pipeline equivaent

---

## 5. Database / Persistence (P1: Data Layer)

### Finding 5.1: SQLite with WAL mode and forward-compatible migrations

OD: `db.ts:52-278` -- SQLite via `better-sqlite3`. Tables: `projects`, `templates`, `conversations`, `messages`, `preview_comments`, `tabs`, `deployments`, `routines`, `routine_runs`. Uses WAL journal mode, foreign keys ON. Forward-compatible column additions via `PRAGMA table_info` inspection.

AgentHub: `edge-server/internal/store/` (referenced) -- in-memory store for edge; `hub-server/internal/service/agent.go:35-36` -- hub uses GORM with PostgreSQL. Split persistence: edge is transient, hub is durable.

```sql
-- OD: SQLite schema pattern (portable, zero-config)
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    skill_id TEXT,
    design_system_id TEXT,
    metadata_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
```

**P1 adoption:** OD's SQLite pattern is appropriate for edge-local storage. AgentHub could add edge-local SQLite for:
1. Offline message queue when hub is unreachable
2. Local conversation history for instant recall
3. Tool token registry (see Finding 8.1)

### Finding 5.2: JSON column pattern for extensible metadata

OD: `metadata_json TEXT` column stores arbitrary JSON blobs. Used for project metadata (`entryFile`, `kind`, `linkedDirs`, etc.), message events, and attachment data. Normalized via `normalizeProject()` etc.

AgentHub: `hub-server` uses structured GORM models (e.g., `model.CustomAgent` with separate fields for `SystemPrompt`, `CapabilityTags`, `ToolWhitelist`, `ModelParams`).

**P2 adoption:** OD's JSON column pattern enables rapid iteration without schema changes. AgentHub's structured approach is more type-safe. Hybrid: use JSONB columns for edge-specific metadata that the hub schema hasn't formalized yet.

---

## 6. Plugin / Pipeline System (P1: Extensibility)

### Finding 6.1: Plugin snapshot + prompt block composition

OD: `server.ts:9742-9787` -- Before each agent spawn, OD resolves the active plugin snapshot via `getSnapshot(db, appliedPluginSnapshotId)` and builds a `pluginPromptBlock()` that injects pipeline stage instructions into the system prompt.

```typescript
// OD: Plugin snapshot → prompt block injection
const snap = getSnapshot(db, appliedPluginSnapshotId);
if (snap) pluginBlock = pluginPromptBlock(snap);

const prompt = composeSystemPrompt({
    agentId,
    skillBody,
    designSystemBody,
    ...(pluginBlock ? { pluginBlock } : {}),
    ...(activeStageBlocks ? { activeStageBlocks } : {}),
});
```

**P1 adoption:** AgentHub could adopt this pattern for pipeline-driven agent templates. The pipeline concept (stages → atoms → workers) maps cleanly to AgentHub's `SubAgentTask` dispatch.

### Finding 6.2: Bundled atom prompt rendering

OD: `server.ts:9764-9787` -- `renderActiveStageBlock()` converts pipeline stages into LLM-readable `## Active stage` blocks. Gated by `OD_BUNDLED_ATOM_PROMPTS=0` kill switch.

**P2 adoption:** If AgentHub adds multi-stage pipelines, OD's atom prompt rendering is a reference implementation for making pipeline state legible to the LLM.

---

## 7. MCP (Model Context Protocol) Integration (P1: Protocol Bridge)

### Finding 7.1: MCP stdio server pattern with full tool catalog

OD: `mcp.ts:314-475` -- `runMcpStdio()` starts an MCP stdio server that proxies tools to the running daemon's HTTP API. Tools: `list_projects`, `get_artifact`, `get_file`, `create_artifact`, `write_file`, etc. Rich instruction block (375 lines) educates the MCP client about active-context fallback, project resolution, and artifact bundling.

```typescript
// OD: MCP server with project-aware active context
const resolveProjectArg = async (baseUrl, arg) => {
    if (typeof arg === 'string' && arg.length > 0) {
        const resolved = await resolveProjectId(baseUrl, arg);
        return { id: resolved.id, resolved, active: null };
    }
    let active = await getJson(`${baseUrl}/api/active`);
    if (!active || active.active === false || !active.projectId) {
        throw new Error('project arg omitted and Open Design has no active project');
    }
    return { id: active.projectId, resolved: null, active };
};
```

**P1 adoption:** AgentHub already provides API endpoints (`handlers.go:708-815`). Adding an MCP server that proxies those endpoints would let external coding agents (Claude Code, Cursor, Zed) interact with AgentHub projects. OD's active-context pattern (callback to `/api/active`) is a UX win that AgentHub should replicate.

### Finding 7.2: Design system resources as MCP URIs

OD: `mcp.ts:383-413` -- Exposes `od://skills/<id>/SKILL.md` and `od://design-systems/<id>/DESIGN.md` as MCP resource URIs. Skills are intentionally NOT exposed as tools -- they are reference material, not executable actions.

**P2 adoption:** Useful pattern for exposing AgentHub agent templates as MCP resources so coding agents can discover available agent configurations.

---

## 8. Tool Token / Capability Gate (P0: Security)

### Finding 8.1: Scoped tool token registry for agent subprocesses

OD: `server.ts:10070-10093` -- Before spawning an agent, OD mints a scoped tool token via `toolTokenRegistry.mint()` with allowed endpoints and operations. The token is injected into the agent's runtime environment and validated by tool execution endpoints.

```typescript
// OD: Tool token mint with endpoint/operation allowlist
const toolTokenGrant = toolTokenRegistry.mint({
    runId,
    projectId,
    allowedEndpoints: CHAT_TOOL_ENDPOINTS,
    allowedOperations: CHAT_TOOL_OPERATIONS,
    ...(pluginGrantContext ?? {}),
});
const runtimeToolPrompt = createAgentRuntimeToolPrompt(daemonUrl, toolTokenGrant);
```

**P0 adoption -- critical for AgentHub.** AgentHub currently passes `AGENTHUB_RUN_ID` and `AGENTHUB_PROJECT_ID` as environment variables (`process_executor.go:418-422`) but has no scoped token for the child process to call back to the edge server. OD's tool token pattern provides defense-in-depth:

1. Agent process cannot call arbitrary daemon endpoints
2. Token is scoped to the specific run
3. Token is revoked on run completion/cancellation
4. Plugin capability grants gate connector access

```go
// Proposed AgentHub adoption: ToolTokenRegistry
type ToolTokenRegistry struct {
    tokens map[string]*ToolToken
    mu     sync.RWMutex
}

type ToolToken struct {
    Token            string
    RunID            string
    ProjectID        string
    AllowedEndpoints []string
    IssuedAt         time.Time
    ExpiresAt        time.Time
}
```

---

## 9. Prompt Composition (P1: Context Assembly)

### Finding 9.1: Multi-source prompt assembly

OD: `server.ts:9790-9840` -- `composeSystemPrompt()` assembles the final agent prompt from many sources:
- Skill body + skill modes
- Design system body, tokens CSS, components manifest
- Memory body (extracted from past conversations)
- Plugin pipeline stages
- Craft sections
- User instructions (app-config) + project instructions (DB)
- External MCP server awareness
- Codex image generation override
- Locale-specific handling

**P1 adoption:** AgentHub's equivalent is simpler. `process_executor.go:240-255` passes `Prompt` directly to `BuildCommand()`. OD's multi-source composition could inform richer context assembly in AgentHub:

```go
// Proposed: AgentHub PromptContext
type PromptContext struct {
    SystemPrompt     string
    UserPrompt       string
    SkillOverrides   []SkillOverride
    DesignSystem     *DesignSystemContext
    Memory           []MemoryEntry
    PipelineStages   []PipelineStage
    CraftSections    []CraftSection
    AgentInstructions string
}
```

### Finding 9.2: Skill side-files staged into agent CWD

OD: `server.ts:10213-10227` -- `stageActiveSkill()` copies skill directories into `<cwd>/.od-skills/` so all agent CLIs can access skill side-files regardless of `--add-dir` support. Falls back to absolute paths if staging fails.

**P2 adoption:** AgentHub could adopt this pattern for bundling agent configuration files alongside the project workspace before agent execution.

---

## 10. Chat BYOK Proxy (P2: Value-Add Feature)

### Finding 10.1: BYOK tool injection with OpenAI-compatible tool definitions

OD: `byok-tools.ts:103-203` -- When users bring their own API key, OD injects OpenAI-compatible `tools` definitions (`generate_image`, `generate_speech`, `generate_video`) into upstream completion requests. The daemon handles the tool dispatch loop: execute -> feed result -> re-issue completion.

```typescript
// OD: BYOK tool loop
const tools = BYOK_SENSEAUDIO_TOOLS; // OpenAI-compatible tool defs
const resp = await fetch(upstreamAPI, {
    body: JSON.stringify({ model, messages, tools }),
});
// Parse tool_calls, execute daemon-side, feed back as role: "tool" message
```

**P2 adoption:** AgentHub could offer a "BYOK Lite" mode where users paste an API key and AgentHub routes to their provider. Lower priority than P0/P1 items.

---

## 11. Project File Management (P1: Workspace Isolation)

### Finding 11.1: Path traversal-safe project file operations

OD: `projects.ts:980-1030` -- `resolveSafe()` validates paths stay within the project directory. `resolveSafeReal()` adds symlink-aware revalidation to prevent symlink attacks. Every file read/write goes through these guards.

AgentHub: No equivalent yet -- AgentHub currently operates on agent CLI output, not project files.

**P1 adoption:** When AgentHub adds file artifact management, OD's path safety pattern is the reference:

```go
func ResolveSafe(dir, name string) (string, error) {
    safePath := validateProjectPath(name)
    target := filepath.Join(dir, safePath)
    if !strings.HasPrefix(target, dir+string(os.PathSeparator)) && target != dir {
        return "", errors.New("path escapes project dir")
    }
    return target, nil
}
```

### Finding 11.2: Artifact manifest sidecar files

OD: `projects.ts:717-719` -- Every HTML/Markdown/SVG artifact gets a `.artifact.json` sidecar with `kind`, `metadata`, and `createdAt/updatedAt`. Used for publication guards and stub regression detection.

**P2 adoption:** Useful for AgentHub when tracking agent output artifacts with metadata.

---

## 12. Automated Routines (P1: Scheduling)

### Finding 12.1: Routine service with schedule and run tracking

OD: `db.ts:165-199` -- `routines` table with `schedule_kind`, `schedule_value`, `schedule_json`, `project_mode`, `project_id`, `skill_id`, `agent_id`. `routine_runs` table tracks each execution.

**P1 adoption:** AgentHub has `cron-runs` and scheduling in its architecture but OD's routine model is more complete (per-project scheduling with agent/skill targeting). Consider adopting:

```go
type Routine struct {
    ID          string
    Name        string
    Prompt      string
    Schedule    RoutineSchedule
    ProjectMode string
    ProjectID   string
    SkillID     string
    AgentID     string
    Context     json.RawMessage
    Enabled     bool
}
```

---

## 13. Endpoint Architecture Comparison

### OD API Routes (Express)
```
POST  /api/chat/stream        -- Chat run with SSE response
GET   /api/runs/:id/stream     -- SSE event stream for existing run
POST  /api/runs/:id/cancel     -- Cancel running agent
GET   /api/agents               -- List available agents
GET   /api/projects             -- List projects
POST  /api/projects             -- Create project
GET   /api/projects/:id/files   -- List files
POST  /api/projects/:id/files   -- Upload/write file
GET   /api/health               -- Health check
GET   /api/active               -- Active context
```

### AgentHub API Routes (net/http ServeMux)
```
POST  /v1/runs                  -- Create and start run
POST  /v1/runs/:id:cancel       -- Cancel running agent
GET   /v1/agents                -- List available adapters
GET   /v1/projects              -- List projects
POST  /v1/projects              -- Create project
GET   /v1/threads               -- List threads
POST  /v1/threads               -- Create thread
POST  /v1/threads/:id/messages  -- Post message
GET   /v1/events                -- WebSocket event stream
GET   /v1/health                -- Health check
POST  /v1/permissions/decide    -- Desktop permission gate
GET   /v1/agent-instances       -- Runtime agent instances
```

**Verdict:** Route surfaces are well-aligned. AgentHub has thread/item model (inspired by OpenAI Assistants API); OD has conversation/message model. Both serve the same purposes.

---

## 14. Adoption Priority Summary

| Finding | Priority | OD Source | AgentHub Target | Effort |
|---------|----------|-----------|-----------------|--------|
| 2.2 -- Stdin interrupt for graceful cancel | P0 | `runs.ts:204-218` | `process_executor.go:162-196` | Low (already done) |
| 4.1 -- Adapter interface pattern | P0 | `claude-stream.ts` | `adapter.go:23-43` | Low (aligned) |
| 8.1 -- Tool token registry | P0 | `server.ts:10070-10093` | New `internal/security/tokens.go` | High |
| 3.1 -- SSE reconnection | P0 | `runs.ts:133-158` | `handlers.go:497-584` | Medium |
| 5.1 -- Edge-local SQLite | P1 | `db.ts:52-278` | New `internal/store/sqlite.go` | High |
| 6.1 -- Plugin snapshot prompt injection | P1 | `server.ts:9742-9787` | Pipeline composition in `agent.go` | High |
| 7.1 -- MCP server proxy | P1 | `mcp.ts:314-475` | New `cmd/agenthub-mcp/` | Medium |
| 9.1 -- Multi-source prompt assembly | P1 | `server.ts:9790-9840` | `BuildCommand()` context expansion | Medium |
| 12.1 -- Routine scheduling | P1 | `db.ts:165-199` | Hub scheduler | Medium |
| 11.1 -- Path-safe file ops | P1 | `projects.ts:980-1030` | New `internal/fs/guard.go` | Medium |
| 5.2 -- JSON metadata columns | P2 | `db.ts:54-63` | GORM model extensions | Low |
| 6.2 -- Pipeline atom rendering | P2 | `server.ts:9764-9787` | N/A (future) | N/A |
| 7.2 -- MCP resource URIs for templates | P2 | `mcp.ts:383-413` | MCP server extension | Low |
| 10.1 -- BYOK tool injection | P2 | `byok-tools.ts:103-203` | New proxy route | High |
| 11.2 -- Artifact manifest sidecars | P2 | `projects.ts:717-719` | Artifact metadata | Low |
| 13 -- Route alignment | -- | `server.ts` | `handlers.go:708-815` | Low (already aligned) |

---

## 15. Recommended Adoption Sequence

### Phase A: Security hardening (sprint 1)
1. Implement tool token registry (Finding 8.1) -- prevents agent subprocesses from calling arbitrary edge endpoints
2. Add path-safe file operations (Finding 11.1) -- groundwork for file artifact support

### Phase B: Protocol bridging (sprint 2)
3. Add MCP server proxy (Finding 7.1) -- lets external coding agents interact with AgentHub projects
4. Implement SSE reconnection with Last-Event-ID (Finding 3.1) -- better browser UX

### Phase C: Context richness (sprint 3)
5. Multi-source prompt assembly (Finding 9.1) -- richer agent contexts
6. Plugin/pipeline snapshot prompt injection (Finding 6.1) -- deterministic run configuration

### Phase D: Persistence (sprint 4)
7. Edge-local SQLite for offline queue (Finding 5.1)
8. Routine scheduling (Finding 12.1)
