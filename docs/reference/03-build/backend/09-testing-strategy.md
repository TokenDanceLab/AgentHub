# AgentHub Testing Strategy

> Date: 2026-05-21
> Based on: design-go-services.md, cross-analysis-adapters.md, deep-dive-kanna-orchestrator-mapping.md, design-desktop-ux.md, scaffold-go-services.md
> Status: Draft v1.0

---

## 0. Overview

### 0.1 Five-Layer Test Pyramid

```
           ┌──────────────┐
           │  Adversarial │  5-10 scenarios, run per-release
           │  (Agents)    │
          ┌┴──────────────┴┐
          │      E2E       │  15-25 scenarios, run per-PR merge
          │  (Playwright)  │
         ┌┴────────────────┴┐
         │    Frontend      │  60-100 tests, run per-commit
         │  (Vitest + RTL)  │
        ┌┴──────────────────┴┐
        │   Go Integration   │  40-60 tests, run per-commit
        │  (real SQLite/WS)  │
       ┌┴────────────────────┴┐
       │     Go Unit Tests     │  120-180 tests, run per-commit
       │  (table-driven, -race)│
       └──────────────────────┘
```

### 0.2 Test Infrastructure Configuration

Per `scaffold-go-services.md` and `design-go-services.md` Appendix B:

**Go test toolchain** (from go.mod):
- Go 1.24 with `testing/synctest` (stdlib test clock)
- `github.com/google/go-cmp v0.7.0` for diff-based assertions (no testify)
- `-race` flag enabled in CI (`go test ./... -race -count=1`)

**CI pipeline** (from `.github/workflows/ci.yml`):
- `lint` job: golangci-lint (errcheck, gosimple, govet, ineffassign, staticcheck, unused, revive)
- `test` job: `go test ./... -race -count=1`
- `build` job: compile hub/edge/runner binaries
- `buf-breaking` job: protobuf schema compatibility check

**Frontend test toolchain**:
- Vitest (fast, Vite-native, Jest-compatible API)
- @testing-library/react for component tests
- @testing-library/user-event for interaction simulation
- msw (Mock Service Worker) for HTTP mock or fetch-mock for Edge API
- Playwright for E2E (Chromium + Firefox, headed in CI)

**Test directory conventions**:
- Go: `*_test.go` co-located with source (standard Go pattern)
- Frontend: `__tests__/` per-feature or `*.test.tsx` co-located
- E2E: `e2e/` at project root

---

## 1. Go Unit Tests

### 1.1 protocol/ -- Type Serialization/Deserialization

**Target package**: `packages/protocol/`

**What to test** -- every generated type used across service boundaries must have round-trip JSON stability. The `AgentEvent` union type (11 variants, `cross-analysis-adapters.md` Section 2.2) is the highest-risk surface.

| Test File | Coverage Scope | Key Techniques |
|-----------|---------------|----------------|
| `protocol/agent_event_test.go` | All 11 `AgentEventType` variants: `system_init`, `assistant_text`, `reasoning`, `tool_call`, `tool_result`, `tool_progress`, `result`, `stream_event`, `approval_request`, `approval_decision`, `status_change` | Table-driven round-trip: `json.Marshal` -> `json.Unmarshal` -> `go-cmp.Diff`. Verify every field survives the cycle. |
| `protocol/start_request_test.go` | `StartRequest` with all 30 fields (model, thinking, maxTokens, tools, MCPConfig, sandbox, forkFrom, etc.) | Test zero-value omitempty behavior. Test `ProviderExtras map[string]any` passthrough. |
| `protocol/usage_info_test.go` | `UsageInfo`, `CostInfo`, `ResultPayload` numeric boundaries | Edge cases: 0 tokens, max int64, negative (should reject). |
| `protocol/approval_types_test.go` | `ToolPermissionRequest`, `PermissionDecision`, `ApprovalRequestPayload` | Verify `ToolInput` map[string]any survives nested JSON (e.g., nested objects, arrays). |

**Test pattern** (table-driven, no external dependencies):

```go
func TestAgentEvent_RoundTrip(t *testing.T) {
    tests := []struct {
        name  string
        event AgentEvent
    }{
        {
            name: "system_init",
            event: AgentEvent{
                Type: EventSystemInit,
                Payload: SystemInitPayload{
                    Model: "claude-sonnet-4-6",
                    Tools: []ToolDef{{Name: "Bash", IsDestructive: true}},
                },
            },
        },
        // ... all 11 variants
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            data, err := json.Marshal(tt.event)
            if err != nil {
                t.Fatalf("marshal: %v", err)
            }
            var got AgentEvent
            if err := json.Unmarshal(data, &got); err != nil {
                t.Fatalf("unmarshal: %v", err)
            }
            if diff := cmp.Diff(tt.event, got); diff != "" {
                t.Errorf("round-trip mismatch (-want +got):\n%s", diff)
            }
        })
    }
}
```

**Go 1.24 advantage**: Use `testing/synctest` for time-dependent fields (`Timestamp int64`):

```go
func TestAgentEvent_Timestamp(t *testing.T) {
    synctest.Test(t, func(t *testing.T) {
        // time.Now() returns fake clock within synctest bubble
        evt := AgentEvent{Timestamp: time.Now().UnixMilli()}
        // ...
    })
}
```

### 1.2 security/ -- PolicyEngine 23 Safety Checks

**Target package**: `runner/internal/security/` and `edge/internal/security/`

**What to test**: The two security modules each have distinct responsibilities:

**A. `runner/internal/security/path_guard_test.go`** -- PathGuard (design-go-services.md Section 3.3):

| Check # | Test Scenario | Expected |
|---------|--------------|----------|
| 1 | Path within allowed root | `ValidatePath("/worktree/src/main.go")` -> nil |
| 2 | Path traverses above root | `ValidatePath("/worktree/../../etc/passwd")` -> error |
| 3 | Absolute path outside root | `ValidatePath("/etc/passwd")` -> error |
| 4 | Symlink escape (if symlink exists) | Create symlink in worktree pointing outside, validate resolution -> error |
| 5 | Empty path | `ValidatePath("")` -> error |
| 6 | Relative path resolved correctly | `ValidatePath("src/../src/main.go")` -> resolved within root |
| 7 | Multiple allowed roots | `ResolvePath(worktree, relative)` picks correct root |
| 8 | Unicode paths | Validate works with CJK/non-ASCII filenames |
| 9 | NTFS alternate data streams (Windows) | `ValidatePath("file.txt:hidden")` -> error |
| 10 | Very long paths (>260 Windows, >4096 Linux) | Graceful handling, not panic |

**B. `runner/internal/security/command_approval_test.go`** -- CommandApprovalPolicy:

| Check # | Test Scenario | Expected |
|---------|--------------|----------|
| 11 | Allowed command matches exact | `"git status"` with allow rule `"git *"` -> allowed |
| 12 | Denied command overrides allow | `"rm -rf /"` with deny rule `"rm *"` -> denied |
| 13 | Empty allowRules (deny-all default) | Any command -> denied |
| 14 | Command with pipes passes allow | `"cat file | grep pattern"` -> depends on first command |
| 15 | Command injection via semicolon | `"git status; rm -rf /"` -> denied (second command) |
| 16 | Command injection via backticks | `` "echo `cat /etc/passwd`" `` -> denied |
| 17 | Environment variable override | `"ENV=evil git pull"` -> denied |
| 18 | Shell metacharacters in args | `"echo $(whoami)"` -> denied |
| 19 | Allowed command with safe args | `"git diff --cached"` -> allowed |
| 20 | Nil input | `ValidateCommand("")` -> error |
| 21 | Very long command string | Truncation safety, no OOM |
| 22 | Regex bypass attempt | `"git\\nrm -rf /"` -> denied (newline injection) |
| 23 | chained commands with && | `"git status && curl evil.com"` -> denied |

**Test pattern**:

```go
func TestCommandApprovalPolicy(t *testing.T) {
    policy := &CommandApprovalPolicy{
        allowRules: []CommandRule{
            {Pattern: "git *"},
            {Pattern: "go *"},
            {Pattern: "npm *"},
        },
        denyRules: []CommandRule{
            {Pattern: "rm *"},
            {Pattern: "sudo *"},
        },
    }
    tests := []struct {
        name    string
        command string
        want    bool // true = allowed
    }{
        {"git status allowed", "git status", true},
        {"git push allowed", "git push origin main", true},
        {"rm denied", "rm -rf /", false},
        {"sudo denied", "sudo systemctl restart", false},
        {"chained command denied", "git status && rm file", false},
        {"injection via semicolon", "git status; cat /etc/passwd", false},
        // ... all 23 checks
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := policy.Validate(tt.command)
            if got.Allowed != tt.want {
                t.Errorf("Validate(%q) = %v, want %v", tt.command, got.Allowed, tt.want)
            }
        })
    }
}
```

**C. `edge/internal/security/security_test.go`** -- LocalAuthorizer:

| Check # | Test Scenario |
|---------|--------------|
| 1 | User can access their own project |
| 2 | User cannot access another user's project |
| 3 | CanApprove checks target user permission |
| 4 | Nil/empty project path |

### 1.3 store/ -- EventStore JSONL Read/Write + Snapshot Compaction

**Target package**: `hub/internal/store/`, `edge/internal/store/`, `runner/internal/store/`

**What to test**: Event-sourcing persistence based on Kanna's JSONL pattern (deep-dive-kanna-orchestrator-mapping.md Section 6):

**A. JSONL Write Chain Serialization** (derived from Kanna `event-store.ts:616-623`):

```go
// packages/protocol/eventstore_test.go
func TestEventStore_AppendOrder(t *testing.T) {
    // Spawn N goroutines concurrently appending events
    // Verify JSONL file has strictly monotonic sequence numbers
    // No interleaved lines, no corrupted JSON
}
func TestEventStore_WriteChain(t *testing.T) {
    // Simulate writeChain serialization:
    // Even under concurrent writes, file integrity holds
}
```

**B. JSONL Read Replay** (derived from Kanna `event-store.ts:353-374`):

| Test Scenario | Expected |
|--------------|----------|
| Replay empty log | Empty slice, no error |
| Replay single event | Exact match on all fields |
| Replay 10000 events | All events recovered, order preserved |
| Replay with corrupted line (mid-write crash) | Skip corrupted line, log warning, continue |
| Replay with trailing newline | Handled gracefully |
| Replay with empty lines | Skipped |
| Multi-source replay with timestamp sort | Events merged in correct timestamp order |

**C. Snapshot Compaction** (derived from Kanna `event-store.ts:1228-1238`):

```go
func TestEventStore_SnapshotCompaction(t *testing.T) {
    // 1. Append events until log exceeds 2MB threshold
    // 2. Verify snapshot.json is generated
    // 3. Verify original JSONL is cleared/truncated
    // 4. Verify replay from snapshot + remaining JSONL produces identical state
}
func TestEventStore_SnapshotOnly(t *testing.T) {
    // Replay from pure snapshot (no JSONL) -- common after compaction
}
func TestEventStore_CompactionIdempotent(t *testing.T) {
    // Running compaction twice produces identical snapshot
}
```

**D. Version Migration** (derived from Kanna `event-store.ts:222-225`):

```go
func TestEventStore_VersionMismatch(t *testing.T) {
    // Write v1 events, open with v2 schema
    // Verify migration function is called
    // Or: data dir reset with warning
}
```

### 1.4 memory/ -- ContextBuilder Token Budget

**Target package**: `edge/internal/context_builder/`

**What to test**: The ContextBuilder's core responsibility is assembling context within a token budget. Key parameters from design-go-services.md Section 3.2:

| Test Scenario | Key Parameters | Expected |
|--------------|---------------|----------|
| Empty conversation | `MaxTokens=100000` | SystemPrompt only, TokenCount <= budget |
| Short conversation fits | 5 messages, total 5000 tokens | All messages included |
| Long conversation exceeds budget | 200 messages, `MaxTokens=10000` | Earlier messages summarized/truncated |
| Summarization boundary | `SummarizeEarlier=true` | Messages before compact boundary replaced with summary |
| Memory entries included | Project has 10 memory entries | Memory entries included, counted in token budget |
| Project files included | `.agenthub/` has 3 files | File contents included, counted |
| Zero budget | `MaxTokens=0` | Error or minimum (system prompt only) |
| Negative budget | `MaxTokens=-1` | Error |
| Token counting accuracy | Known string lengths | TokenCount matches tiktoken/go estimate |
| ReserveRatio from design | `reserveRatio=0.15` | 85% for messages, 15% reserved for response |

```go
func TestContextBuilder_TokenBudget(t *testing.T) {
    tests := []struct {
        name        string
        spec        ContextSpec
        messages    []imcore.Message
        wantMaxTokens int // upper bound on AssembledContext.TokenCount
    }{
        {
            name:        "fits within budget",
            spec:        ContextSpec{MaxTokens: 10000},
            messages:    generateMessages(5, 500), // 5 x 500 tokens each
            wantMaxTokens: 10000,
        },
        {
            name:        "exceeds budget with summarization",
            spec:        ContextSpec{MaxTokens: 1000, SummarizeEarlier: true},
            messages:    generateMessages(50, 500),
            wantMaxTokens: 1000,
        },
        // ...
    }
}
```

### 1.5 Additional Unit Test Targets

**A. `packages/adapters/event_normalizer_test.go`** -- Event normalization correctness (cross-analysis-adapters.md Section 4.1):

Test each of the 14 native-to-unified event mappings for all three adapters:
- `NormalizeCCEvent`: Claude Code NDJSON lines -> AgentEvent (verify all 13 CC message types)
- `NormalizeCodexItem`: Codex RolloutItem -> AgentEvent (verify TurnItem types)
- `NormalizeOpenCodeEvent`: OpenCode SSE -> AgentEvent (verify 16 LLMEvent -> 11 AgentEvent mapping)
- `NormalizeToolName`: `mcp__<server>__<tool>` canonical format

**B. `packages/transport/local_test.go`** -- Local transport encode/decode

**C. `packages/im-core/conversation_test.go`** -- Conversation and Message model validation

**D. `packages/checkpoint-core/content_addressed_test.go`** -- SHA-256 + zstd storage round-trip

**E. `runner/internal/diff/differ_test.go`** -- Git diff parsing and patch application on temp repos

**F. `runner/internal/preview/port_allocator_test.go`** -- Port allocation in 5100-5199 range, concurrent allocation safety

**G. `hub/internal/store/fts_test.go`** -- FTS5 query builder correctness (unit level, no DB required)

---

## 2. Go Integration Tests

### 2.1 Runner + Edge Local Communication

**Target**: `runner/internal/executor/` + `edge/internal/runner_manager/`

**What to test**: End-to-end communication between Edge's RunnerManager and Runner's HTTP API, using a real running Runner process.

```go
// runner/internal/executor/executor_integration_test.go
// Build tag: //go:build integration

func TestRunnerIntegration_StartAndStream(t *testing.T) {
    // 1. Start Runner server on random port (127.0.0.1:0)
    // 2. POST /runs with a trivial Claude Code prompt: "echo hello"
    // 3. Connect to /runs/:id/stream (SSE)
    // 4. Verify: system_init event arrives with tools list
    // 5. Verify: assistant_text events arrive
    // 6. Verify: result event with is_error=false
    // 7. Verify: run status transitions: starting -> running -> done
}

func TestRunnerIntegration_Cancel(t *testing.T) {
    // 1. Start a long-running prompt ("sleep 30 && echo done")
    // 2. After 2 seconds, DELETE /runs/:id
    // 3. Verify run status -> cancelled
    // 4. Verify child process is terminated (ProcessRegistry.KillAll)
}

func TestRunnerIntegration_MultiRunConcurrency(t *testing.T) {
    // 1. Start 3 concurrent runs
    // 2. Verify each has independent session ID
    // 3. Verify output streams don't cross
    // 4. Cancel one, verify others continue
}
```

**Real CLI dependency note**: These tests require `claude` (or a mock echo binary) on the test runner. CI should install a test fixture binary that emits valid NDJSON without making API calls:

```go
// testdata/fake-claude/main.go -- a minimal NDJSON emitter for testing
func main() {
    fmt.Println(`{"type":"system_init","session_id":"test-1",...}`)
    fmt.Println(`{"type":"assistant","message":{"content":[{"type":"text","text":"Hello!"}]}}`)
    fmt.Println(`{"type":"result","subtype":"success","is_error":false}`)
}
```

### 2.2 SQLite FTS5 Search

**Target**: `hub/internal/store/fts.go` + real `modernc.org/sqlite`

**What to test**: Full-text search correctness with the FTS5 external content + trigger pattern from design-go-services.md Section 4.2.

```go
// hub/internal/store/fts_integration_test.go
// Build tag: //go:build integration

func TestFTS5_SearchMessages_Basic(t *testing.T) {
    db := openTestDB(t)
    defer db.Close()
    runMigrations(t, db)

    // Seed: insert 100 messages with known content
    seedMessages(t, db, []seedMessage{
        {Content: "implement OAuth2 login flow", ConvID: "c1"},
        {Content: "fix SQL injection in user endpoint", ConvID: "c1"},
        {Content: "add unit tests for auth module", ConvID: "c2"},
        // ...
    })

    // Test: search "OAuth2"
    results := SearchMessages(ctx, db, "c1", "OAuth2", 10)
    // Verify: 1 result, snippet contains <mark>OAuth2</mark>
}

func TestFTS5_SearchMessages_Ranking(t *testing.T) {
    // Insert documents with varying term frequency
    // Verify BM25 ranking: more frequent terms rank higher
    // Verify snippet() function returns correct context window
}

func TestFTS5_TriggerSync(t *testing.T) {
    // INSERT a message -> verify it appears in FTS5 immediately
    // UPDATE a message -> verify old content removed, new content indexed
    // DELETE a message -> verify it's removed from FTS5
}

func TestFTS5_SearchMemory_CrossProject(t *testing.T) {
    // Seed memory entries across 3 projects
    // Search project A only -> only project A results
    // Verify FTS5 content_rowid correctly links to memory_entries
}

func TestFTS5_PorterStemming(t *testing.T) {
    // Search "running" -> matches "run", "runner", "running"
    // Search "tests" -> matches "test", "testing", "tests"
}

func TestFTS5_Unicode(t *testing.T) {
    // Search CJK characters
    // Search emoji
    // Search mixed scripts
}
```

**Test DB setup**:

```go
func openTestDB(t *testing.T) *sql.DB {
    t.Helper()
    db, err := sql.Open("sqlite", ":memory:?_journal_mode=WAL")
    if err != nil {
        t.Fatalf("open test db: %v", err)
    }
    return db
}
```

### 2.3 WebSocket Hub Multi-Client Broadcast

**Target**: `hub/internal/wsgateway/hub.go`

**What to test**: The WSHub's Room-based broadcast model with real WebSocket connections via `coder/websocket`.

```go
// hub/internal/wsgateway/hub_integration_test.go
// Build tag: //go:build integration

func TestWSHub_JoinAndBroadcast(t *testing.T) {
    hub := NewHub()
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    go hub.Run(ctx)

    // 1. Start test HTTP server with hub.Upgrade handler
    srv := httptest.NewServer(hub.Upgrade("conv:test-1", noopAuth))
    defer srv.Close()

    // 2. Connect 3 clients
    clients := connectClients(t, srv.URL, 3)

    // 3. Client 1 sends a message
    sendJSON(t, clients[0], `{"type":"chat","text":"hello"}`)

    // 4. Verify: Clients 2 and 3 receive it (BroadcastExcept excludes sender)
    msg2 := recvJSON(t, clients[1])
    msg3 := recvJSON(t, clients[2])
    assert.Equal(t, `{"type":"chat","text":"hello"}`, msg2)
    assert.Equal(t, `{"type":"chat","text":"hello"}`, msg3)

    // 5. Verify: Client 1 does NOT receive its own message
    assertNoMessage(t, clients[0], 500*time.Millisecond)
}

func TestWSHub_MultipleRoomsIsolation(t *testing.T) {
    // Client A in room "conv:1", Client B in room "conv:2"
    // Broadcast to room "conv:1" -> only Client A receives
}

func TestWSHub_ClientDisconnect(t *testing.T) {
    // 1. Join 2 clients to room
    // 2. Disconnect client 1
    // 3. Client count == 1
    // 4. Broadcast -> only client 2 receives
}

func TestWSHub_RoomCleanup(t *testing.T) {
    // 1. Join 1 client to room
    // 2. Disconnect client
    // 3. Room count -> 0 (room deleted from map)
}

func TestWSHub_SendQueueFull(t *testing.T) {
    // 1. Create client with SendCh capacity 1
    // 2. Fill the channel without reading
    // 3. Next write -> client unregistered (backpressure)
}

func TestWSHub_BroadcastExcept(t *testing.T) {
    // 1. 3 clients in room
    // 2. BroadcastExcept with excludeID = client2
    // 3. client1 and client3 receive, client2 does not
}

func TestWSHub_ConcurrentJoin(t *testing.T) {
    // 1. Spawn 50 goroutines concurrently joining room
    // 2. Run with -race
    // 3. Final client count == 50
    // 4. All clients receive broadcast
}
```

### 2.4 Additional Integration Test Targets

**A. `edge/internal/hub_client/ws_client_test.go`** -- Edge-to-Hub WebSocket reconnection with exponential backoff

**B. `edge/internal/sync_client/syncer_test.go`** -- Cursor-based incremental sync between Edge and Hub

**C. `edge/internal/local_ws/gateway_test.go`** -- Desktop UI WebSocket event delivery

**D. `runner/internal/workspace/git_worktree_test.go`** -- Real git worktree create/diff/apply/discard on a temp git repo

**E. `runner/internal/checkpoint/manager_test.go`** -- Checkpoint create/restore/fork/Diff on temp worktree

**F. Database migration integration tests** -- `scripts/migrate.go` on real SQLite, verify all migration SQL is valid

### 2.5 Integration Test Build Tags and CI

```go
//go:build integration

package wsgateway_test

// Integration tests use real network, real filesystem, real DB.
// Excluded from `go test ./...` (unit test run).
// Run separately: `go test -tags=integration ./...`
```

CI workflow addition:

```yaml
# .github/workflows/ci.yml (additional job)
integration-test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-go@v5
      with: { go-version: '1.24' }
    - run: go test -tags=integration ./... -count=1 -timeout 120s
```

---

## 3. Frontend Tests

### 3.1 React Component Rendering (Vitest + Testing Library)

**Test infrastructure** (`apps/web/vitest.config.ts`):

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
})
```

**Component test targets** (derived from `design-desktop-ux.md` Section 1 component tree):

| Component | Test File | What to Test |
|-----------|----------|-------------|
| `MessageTree` | `MessageTree.test.tsx` | Renders messages in correct tree order. Sibling navigation (SiblingSwitch). Virtualization (1000+ messages). |
| `MessageNode` | `MessageNode.test.tsx` | AuthorityStripe color (blue=Hub, green=Edge, orange=Hybrid). Progressive disclosure L0-L4. |
| `ThinkingBlock` | `ThinkingBlock.test.tsx` | Default collapsed. Toggle expand/collapse. Content rendered as Markdown. |
| `ToolUseCard` | `ToolUseCard.test.tsx` | Collapsed by default (header only). Expand shows ToolParams + ToolResult. Different result types (Read/Write/Edit/Bash/Task). |
| `DiffCard` | `DiffCard.test.tsx` | State machine: pending -> applying -> applied -> discarded. Undo within 5s window. |
| `ApprovalCard` | `ApprovalCard.test.tsx` | Renders tool details. Approve/ApproveOnce/Deny buttons. Auto-deny timer countdown. |
| `ComposeArea` | `ComposeArea.test.tsx` | Text input. @mention popover (fuzzy filter). Shift+Enter newline vs Enter send. SendButton disabled when empty. StopButton visible when running. |
| `RightPanel` | `RightPanel.test.tsx` | Tab switching (Files/Diff/Preview/Git/Logs/Terminal). Panel resize. |
| `DiffPanel` | `DiffPanel.test.tsx` | Unified vs split view. File list rendering. Hunk display (added/deleted/context lines). AgentDiffSource label. |
| `MobileDrawer` | `MobileDrawer.test.tsx` | Open/close animation. Backdrop click closes. Swipe gesture. |
| `MobileBottomSheet` | `MobileBottomSheet.test.tsx` | Drag handle interaction. Height resizing. Tab switching in sheet. |
| `Sidebar` | `Sidebar.test.tsx` | ProjectTree rendering. ThreadCard (title, meta, RunIndicator). SearchBar with FTS5 results. ArchivedSection. |
| `ChatHeader` | `ChatHeader.test.tsx` | Editable thread title. AgentSelector dropdown. ExecutionBadge. WorkspaceIndicator (branch + git status). |
| `ForkDialog` | `ForkDialog.test.tsx` | Four ForkMode radio buttons. Create Fork button. |

**Test pattern**:

```tsx
// src/components/chat/MessageNode.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import { MessageNode } from './MessageNode'

describe('MessageNode', () => {
  it('renders user message text', () => {
    render(<MessageNode message={mockUserMessage} />)
    expect(screen.getByText('Hello Claude!')).toBeInTheDocument()
  })

  it('renders authority stripe with correct color', () => {
    const { container } = render(
      <MessageNode message={mockEdgeMessage} authority="edge" />
    )
    const stripe = container.querySelector('[data-authority-stripe]')
    expect(stripe).toHaveClass('border-l-green-500')
  })

  it('collapses thinking block by default', () => {
    render(<MessageNode message={mockMessageWithThinking} />)
    expect(screen.queryByText('Thinking content...')).not.toBeVisible()
    expect(screen.getByText(/Thinking/)).toBeInTheDocument() // toggle button
  })

  it('expands thinking block on toggle click', async () => {
    const user = userEvent.setup()
    render(<MessageNode message={mockMessageWithThinking} />)
    await user.click(screen.getByText(/Thinking/))
    expect(screen.getByText('Thinking content...')).toBeVisible()
  })

  it('expands tool use card on click', async () => {
    const user = userEvent.setup()
    render(<MessageNode message={mockMessageWithToolUse} />)
    await user.click(screen.getByText('Read'))
    expect(screen.getByText('src/main.go')).toBeVisible()
  })

  it('navigates siblings with SiblingSwitch', async () => {
    const user = userEvent.setup()
    const onSiblingChange = vi.fn()
    render(
      <MessageNode
        message={mockMessageWithSiblings}
        siblingCount={3}
        siblingPosition={1}
        onSiblingChange={onSiblingChange}
      />
    )
    await user.click(screen.getByLabelText('Next sibling'))
    expect(onSiblingChange).toHaveBeenCalledWith(2)
  })
})
```

### 3.2 WebSocket Mock + Message Flow Tests

**Target**: `apps/web/src/hooks/useWebSocket.test.ts` and store integration

**What to test**: The complete WS event -> store action -> React re-render pipeline from design-desktop-ux.md Section 2.3.

```tsx
// src/hooks/useWebSocket.test.ts
import { renderHook, act } from '@testing-library/react'
import { WS } from 'vitest-websocket-mock' // or custom mock

describe('useWebSocket -> Store Integration', () => {
  let server: WS

  beforeEach(() => {
    server = new WS('ws://127.0.0.1:3210/ws')
  })

  afterEach(() => {
    server.close()
  })

  it('message.created -> threadStore.appendMessage', async () => {
    const { result } = renderHook(() => useThreadStore())
    server.send(JSON.stringify({
      type: 'message.created',
      payload: { id: 'msg-1', threadId: 't1', content: 'Hello' }
    }))
    await waitFor(() => {
      expect(result.current.messageCache.get('msg-1')).toBeDefined()
    })
  })

  it('message.streaming -> accumulated content update', async () => {
    server.send(JSON.stringify({
      type: 'message.streaming',
      payload: { messageId: 'msg-2', delta: 'Hel' }
    }))
    server.send(JSON.stringify({
      type: 'message.streaming',
      payload: { messageId: 'msg-2', delta: 'lo' }
    }))
    await waitFor(() => {
      expect(result.current.streamingContent.get('msg-2')).toBe('Hello')
    })
  })

  it('run.status_changed -> runStore.updateRunStatus', async () => {
    server.send(JSON.stringify({
      type: 'run.status_changed',
      payload: { runId: 'r1', status: 'running' }
    }))
    // ... verify store update
  })

  it('permission.requested -> approvalStore.addApprovalRequest', async () => {
    server.send(JSON.stringify({
      type: 'permission.requested',
      payload: { id: 'apr-1', toolName: 'Bash', command: 'rm -rf /' }
    }))
    // ... verify approval card appears
  })

  it('reconnection with exponential backoff', async () => {
    server.close()
    // ... verify connectionStore.status = 'disconnected'
    // ... verify reconnect attempts with delays
  })
})
```

**Edge API mock** (for REST-based operations):

```ts
// src/test/mocks/edge-api.ts
import { http, HttpResponse } from 'msw'

export const edgeHandlers = [
  http.get('/api/projects', () => {
    return HttpResponse.json([{ id: 'p1', name: 'AgentHub', rootPath: '/code/agenthub' }])
  }),
  http.get('/api/threads/:id/messages', ({ params }) => {
    return HttpResponse.json(mockMessages[params.id] || [])
  }),
  http.post('/api/threads/:id/messages', async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({ id: 'msg-new', ...body }, { status: 201 })
  }),
]
```

### 3.3 Zustand Store State Transition Tests

**Target**: All 10 Zustand stores from design-desktop-ux.md Section 2.

**What to test**: Pure store logic (no React rendering), fast and deterministic.

**A. `threadStore`** -- highest complexity due to message tree:

```ts
// src/stores/threadStore.test.ts
import { useThreadStore } from './threadStore'

describe('threadStore', () => {
  beforeEach(() => {
    useThreadStore.setState(useThreadStore.getInitialState())
  })

  it('buildMessageTree constructs correct tree', () => {
    const store = useThreadStore.getState()
    // Seed: 5 messages with parent_id relationships
    store.messageCache = new Map([
      ['m1', { id: 'm1', parentId: null, content: 'root' }],
      ['m2', { id: 'm2', parentId: 'm1', content: 'child1' }],
      ['m3', { id: 'm3', parentId: 'm1', content: 'child2' }], // sibling of m2
      ['m4', { id: 'm4', parentId: 'm2', content: 'grandchild' }],
    ])

    const tree = store.buildMessageTree('t1')
    expect(tree.children).toHaveLength(1) // m1
    expect(tree.children[0].children).toHaveLength(2) // m2, m3 (siblings)
    expect(tree.children[0].children[0].children).toHaveLength(1) // m4
  })

  it('forkThread creates new thread with correct mode', async () => {
    // Mock API
    // Test all 4 ForkMode values: DIRECT_PATH, INCLUDE_BRANCHES, TARGET_LEVEL, DEFAULT
  })

  it('createSibling adds sibling at correct position', async () => {
    // Create sibling at node m2 (which has sibling m3)
    // Verify: m2's parent now has 3 children
  })

  it('navigateSibling wraps around at boundaries', () => {
    const store = useThreadStore.getState()
    store.setSiblingPosition('node-1', 0) // first of 3
    store.navigateSibling('node-1', 'prev')
    expect(store.siblingPosition.get('node-1')).toBe(2) // wraps to last
    store.navigateSibling('node-1', 'next')
    expect(store.siblingPosition.get('node-1')).toBe(0) // back to first
  })

  it('updateStreamingMessage accumulates deltas', () => {
    const store = useThreadStore.getState()
    store.streamingContent.set('msg-stream', 'Hel')
    store.updateStreamingMessage('t1', 'msg-stream', 'lo World', false)
    expect(store.streamingContent.get('msg-stream')).toBe('Hello World')
  })

  it('updateStreamingMessage on complete marks finished', () => {
    const store = useThreadStore.getState()
    store.streamingContent.set('msg-stream', 'Done')
    store.updateStreamingMessage('t1', 'msg-stream', '', true)
    // streamingContent entry removed, messageCache updated with final content
    expect(store.streamingContent.has('msg-stream')).toBe(false)
  })
})
```

**B. `runStore`** -- run lifecycle:

```ts
// src/stores/runStore.test.ts
describe('runStore', () => {
  it('startRun sets status to starting', async () => { /* ... */ })
  it('completeRun sets status to completed, populates result', async () => { /* ... */ })
  it('failRun sets status to failed, populates error', async () => { /* ... */ })
  it('stopRun sets status to cancelled', async () => { /* ... */ })
  it('runStatusByThread maps thread to current run', () => { /* ... */ })
  it('only one active run per thread', async () => {
    // Attempt to start a second run on same thread while one is running
    // Expect error: thread already has active run
  })
})
```

**C. `diffStore`** -- diff and git state machine:

```ts
// src/stores/diffStore.test.ts
describe('diffStore', () => {
  it('loadDiff populates files with hunks', async () => { /* ... */ })
  it('toggleFileSelection adds/removes from selectedFiles', () => { /* ... */ })
  it('addComment attaches to correct file and line', () => { /* ... */ })
  it('commit with selected files calls API', async () => { /* ... */ })
  it('generateCommitMessage uses AI and sets generatedMessage', async () => { /* ... */ })
  it('selectAllFiles selects all changed files', () => { /* ... */ })
})
```

**D. `approvalStore`** -- permission state:

```ts
// src/stores/approvalStore.test.ts
describe('approvalStore', () => {
  it('addApprovalRequest adds to pending', () => { /* ... */ })
  it('approve removes from pending, adds to history', async () => { /* ... */ })
  it('deny with reason records in history', async () => { /* ... */ })
  it('approveOnce enables single-use, reverts after', async () => { /* ... */ })
  it('auto-deny on expiry', async () => {
    // Advance fake timer past expiresAt
    // Verify pending is empty, history has auto-denied entry
  })
})
```

**E. `uiStore`** -- layout and responsive behavior:

```ts
// src/stores/uiStore.test.ts
describe('uiStore', () => {
  it('setIsMobile(true) triggers layout change', () => { /* ... */ })
  it('sidebarWidth clamped between 200-420', () => { /* ... */ })
  it('rightPanelWidth clamped between 280-600', () => { /* ... */ })
  it('setView switches between welcome/chat/settings', () => { /* ... */ })
  it('toggleSidebar toggles sidebarOpen', () => { /* ... */ })
})
```

**F. `previewStore`** -- artifact and version management:

```ts
// src/stores/previewStore.test.ts
describe('previewStore', () => {
  it('openArtifact loads content and versions', async () => { /* ... */ })
  it('setActiveVersion switches content', () => { /* ... */ })
  it('setActiveTab switches between code/preview/split', () => { /* ... */ })
  it('compareAgents returns side-by-side results', async () => { /* ... */ })
})
```

**G. `connectionStore`** -- WS connection state:

```ts
// src/stores/connectionStore.test.ts
describe('connectionStore', () => {
  it('initial state is disconnected', () => { /* ... */ })
  it('connectEdge transitions to connecting -> connected', () => { /* ... */ })
  it('recordError sets lastError and status to error', () => { /* ... */ })
  it('incrementReconnect tracks attempt count', () => { /* ... */ })
  it('resetReconnect resets to 0 on successful connection', () => { /* ... */ })
  it('setWsLatency updates ping/pong time', () => { /* ... */ })
})
```

**H. `searchStore`** -- FTS5 search state:

```ts
// src/stores/searchStore.test.ts
describe('searchStore', () => {
  it('search populates results with snippets', async () => { /* ... */ })
  it('setFilter scopes by project', () => { /* ... */ })
  it('clearSearch resets query and results', () => { /* ... */ })
  it('results sorted by BM25 score', () => { /* ... */ })
})
```

**I. `projectStore`** -- project loading:

```ts
// src/stores/projectStore.test.ts
describe('projectStore', () => {
  it('loadProjects fetches from Edge API', async () => { /* ... */ })
  it('openProject sets activeProjectId', () => { /* ... */ })
  it('createProject calls POST /api/projects', async () => { /* ... */ })
  it('refreshWorkspaceStatus updates git status', async () => { /* ... */ })
})
```

**J. `pluginStore`** -- plugin registry:

```ts
// src/stores/pluginStore.test.ts
describe('pluginStore', () => {
  it('loadManifests scans plugins directory', async () => { /* ... */ })
  it('loadPlugin dynamically imports module', async () => { /* ... */ })
  it('enablePlugin sets enabled=true', async () => { /* ... */ })
  it('pluginTabs filters by slot="tab"', () => { /* ... */ })
  it('installPlugin from git URL', async () => { /* ... */ })
})
```

---

## 4. E2E Tests

### 4.1 Playwright Configuration

```ts
// e2e/playwright.config.ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: true,
  retries: 1,
  reporter: [['html'], ['list']],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'mobile',
      use: { ...devices['iPhone 14'], viewport: { width: 375, height: 812 } },
    },
    {
      name: 'tablet',
      use: { ...devices['iPad Pro'], viewport: { width: 768, height: 1024 } },
    },
  ],
  webServer: [
    {
      command: 'go run ./services/edge/cmd/main.go',
      port: 3210,
      reuseExistingServer: true,
    },
    {
      command: 'pnpm --dir apps/web dev',
      port: 3000,
      reuseExistingServer: true,
    },
  ],
})
```

### 4.2 E2E Scenario Catalog

#### Critical Path 1: Full Agent Execution + Diff Flow

**Test**: `e2e/agent-execution.spec.ts`

```
Scenario: User sends prompt, agent responds, applies code changes, user reviews diff

  1. Open app, select project "demo-project"
  2. Verify: Sidebar shows thread list
  3. Click "New Thread" button
  4. Verify: Empty center chat appears, ComposeArea focused

  5. Type: "@ClaudeCode write a function to calculate fibonacci in Go"
  6. Press Enter

  7. Verify: User message appears in chat (optimistic render)
  8. Verify: RunIndicator spinner appears in sidebar thread card
  9. Verify: SendButton replaced by StopButton

  10. Wait for: "system_init" message (tools list appears in debug panel)
  11. Wait for: assistant text message appears (streaming cursor animation)
  12. Wait for: ToolUseCard appears (Read or Write tool)
  13. Verify: ToolUseCard shows tool name and parameter summary

  14. Wait for: "result" message (run completed)
  15. Verify: StopButton replaced by SendButton
  16. Verify: RunIndicator shows green check then disappears

  17. Verify: DiffCard appears in message (if agent modified files)
  18. Click "View Full Diff" in DiffCard
  19. Verify: RightPanel opens with Diff tab
  20. Verify: Added lines in green, deleted lines in red

  21. Click "Apply" in DiffPanel
  22. Verify: "Applied" confirmation with Undo button
  23. Click "Undo"
  24. Verify: Changes reverted

  Mobile variant (768px):
  25. Set viewport to 768x1024
  26. Verify: Sidebar is collapsed (drawer hidden)
  27. Tap hamburger menu
  28. Verify: MobileDrawer slides in from left
  29. Verify: RightPanel is bottom sheet with drag handle
```

#### Critical Path 2: Approval Flow

**Test**: `e2e/approval-flow.spec.ts`

```
Scenario: Agent requests permission, user approves/denies

  1. Start a new thread
  2. Send: "@ClaudeCode delete all temp files"
  3. Wait for: ApprovalCard appears in chat
  4. Verify: ApprovalCard shows tool name "Bash" and command details
  5. Verify: Auto-deny countdown timer is visible (5min)

  6. Click "Approve Once"
  7. Verify: ApprovalCard disappears
  8. Verify: Tool use proceeds, tool_result appears

  Deny variant:
  9. Send: "@ClaudeCode rm -rf /tmp/*"
  10. Wait for: ApprovalCard
  11. Click "Deny"
  12. Verify: Tool call shows "Denied" status
  13. Verify: Agent acknowledges denial in next message
```

#### Critical Path 3: Thread Fork

**Test**: `e2e/fork-flow.spec.ts`

```
Scenario: User forks a thread at a specific message

  1. Open existing thread with 10+ messages
  2. Right-click message #5
  3. Verify: ContextMenu appears with "Fork Here" option
  4. Click "Fork Here"
  5. Verify: ForkDialog opens with mode selector
  6. Select "DIRECT_PATH" radio
  7. Click "Create Fork"
  8. Verify: New thread appears in sidebar under same project
  9. Verify: Fork source banner: "Forked from Thread A / Message #5"
  10. Verify: Only messages from root to #5 are visible
  11. Verify: ComposeArea is ready for new prompt
```

#### Critical Path 4: Global Search

**Test**: `e2e/search-flow.spec.ts`

```
Scenario: User searches across all conversations

  1. Press Ctrl+K
  2. Verify: GlobalSearchDialog opens, input auto-focused
  3. Type "auth login"
  4. Verify: Results appear after debounce (with highlighted snippets)
  5. Verify: Results include project name, thread title, timestamp
  6. Click first result
  7. Verify: Navigated to target thread, scrolled to matching message
  8. Verify: Search highlight on matching text in message body
```

#### Critical Path 5: RightPanel Tab Navigation

**Test**: `e2e/right-panel.spec.ts`

```
Scenario: User switches between Files/Diff/Preview/Git/Logs/Terminal tabs

  1. Click Files tab -> FileTreePanel renders with directory tree
  2. Click Diff tab -> DiffPanel renders with file list
  3. Click Preview tab -> PreviewPanel renders with code/preview/split tabs
  4. Click Git tab -> GitPanel renders with Changes/History/Branches views
  5. Click Logs tab -> LogsPanel renders with log stream
  6. Click Terminal tab -> TerminalPanel renders with xterm container
```

#### Critical Path 6: Multi-Agent Group Chat (P1+)

**Test**: `e2e/group-chat.spec.ts`

```
Scenario: User chats with multiple agents in a group

  1. Open group conversation with @ClaudeCode and @Codex
  2. Send: "Both of you: review this function"
  3. Verify: Both agents respond
  4. Verify: Claude's response has Authority label [Edge:us1]
  5. Verify: Codex's response has Authority label [Edge:us1]
```

### 4.3 Mobile 768px Breakpoint Tests

**Test**: `e2e/mobile.spec.ts`

```
Scenario: Layout transforms at 768px breakpoint

  1. Set viewport to 800x600 (above breakpoint)
  2. Verify: Three-column layout (sidebar + center + right panel)

  3. Resize to 700x600 (below breakpoint)
  4. Verify: Single-column layout (center chat only)
  5. Verify: Sidebar hidden, hamburger menu visible in ChatHeader
  6. Verify: RightPanel hidden, tab bar at bottom

  7. Click hamburger menu
  8. Verify: MobileDrawer slides from left, backdrop blur
  9. Click backdrop
  10. Verify: Drawer closes

  11. Click a RightPanel tab icon in bottom bar
  12. Verify: MobileBottomSheet slides up from bottom
  13. Verify: Drag handle visible at top of sheet
  14. Swipe down on drag handle past 35% threshold
  15. Verify: Bottom sheet closes

  iOS keyboard test (iPhone 14 viewport):
  16. Tap ComposeArea textarea
  17. Verify: ComposeArea stays above keyboard (visualViewport)
  18. Type message and send
  19. Verify: Keyboard dismisses, chat scrolls to bottom
```

### 4.4 E2E Test Helpers

```ts
// e2e/helpers.ts
import { Page, expect } from '@playwright/test'

export async function startNewThread(page: Page, projectName: string) {
  await page.click(`text=${projectName}`)
  await page.click('[data-testid="new-thread-button"]')
  await expect(page.locator('[data-testid="compose-area"]')).toBeVisible()
}

export async function sendMessage(page: Page, text: string) {
  const textarea = page.locator('[data-testid="compose-textarea"]')
  await textarea.fill(text)
  await page.keyboard.press('Enter')
}

export async function waitForRunComplete(page: Page, timeout = 30000) {
  await page.waitForSelector('[data-testid="send-button"]', { timeout })
}

export async function waitForMessageContaining(page: Page, text: string, timeout = 30000) {
  await page.waitForSelector(`[data-testid="message-body"]:has-text("${text}")`, { timeout })
}
```

---

## 5. Agent Adversarial Testing

AgentHub's unique testing dimension: **Claude Code produces output; Codex reviews it; a human makes the final decision.**

### 5.1 Test Architecture

```
┌──────────────────────────────────────────────────────────┐
│                 Adversarial Test Harness                  │
│                                                           │
│  ┌───────────┐    ┌───────────┐    ┌───────────┐         │
│  │ Producer   │    │ Reviewer   │    │ Arbitrator │        │
│  │ (Claude    │───>│ (Codex)    │───>│ (Human or  │        │
│  │  Code)     │    │            │    │  Rule Set)  │        │
│  └───────────┘    └───────────┘    └───────────┘         │
│       │                │                  │               │
│       ▼                ▼                  ▼               │
│  ┌───────────────────────────────────────────────────┐   │
│  │              Result Collector                       │   │
│  │  - Accepted (by reviewer)                          │   │
│  │  - Rejected (with reason)                          │   │
│  │  - Modified (by human arbitration)                 │   │
│  │  - Regressions (did review miss anything?)         │   │
│  └───────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

### 5.2 Test Scenarios

Each scenario runs through the full pipeline: Producer generates -> Reviewer critiques -> Human/rule-set arbitrates. Metrics collected per scenario.

#### Code Generation Scenarios

| # | Scenario | Producer Task | Reviewer Task | Expected Review Finding |
|---|---------|--------------|---------------|------------------------|
| 1 | **Security: SQL Injection** | "Write a Go function to query users by email from the database" | "Review this code for SQL injection vulnerabilities" | Should flag string concatenation in SQL, suggest parameterized queries |
| 2 | **Security: Path Traversal** | "Write a function to read a file given a user-provided filename" | "Review this code for path traversal vulnerabilities" | Should flag missing path sanitization, suggest PathGuard usage |
| 3 | **Error Handling** | "Write a function that reads config, connects to DB, and returns user count" | "Review this code for error handling" | Should flag unwrapped errors, missing nil checks, panic-prone code |
| 4 | **Concurrency** | "Write a cache with concurrent read/write support" | "Review for race conditions" | Should flag unsynchronized map access, suggest sync.RWMutex |
| 5 | **Resource Leak** | "Write a function that reads all files in a directory and processes them" | "Review for resource leaks" | Should flag unclosed file handles, missing defer close |
| 6 | **Performance** | "Write a function to find duplicates in a large string slice" | "Review for performance issues" | Should flag O(n^2) algorithm, suggest map-based O(n) approach |
| 7 | **API Design** | "Design a REST API handler for user CRUD operations" | "Review the API design" | Should flag missing input validation, inconsistent error responses, missing pagination |
| 8 | **Test Quality** | "Write unit tests for the user service" | "Review the test coverage and quality" | Should flag missing edge cases, over-mocking, no table-driven tests |
| 9 | **Style Consistency** | "Implement the device registration flow following the project's patterns" | "Review for style consistency with existing code" | Should flag naming convention violations, missing interface compliance |
| 10 | **Documentation** | "Write a public function with documentation" | "Review documentation completeness" | Should flag missing Go doc comments, unclear parameter descriptions |

#### Diff Review Scenarios

| # | Scenario | Producer Task | Reviewer Task | Expected Decision |
|---|---------|--------------|---------------|-------------------|
| 11 | **Low-risk change** | "Add a log statement to the auth flow" | "Review this diff" | Accept (low-risk, cosmetic) |
| 12 | **High-risk change** | "Refactor the permission checking logic" | "Review this diff" | Request human review (touches security path) |
| 13 | **Breaking change** | "Rename the public API endpoint from /users to /accounts" | "Review this diff" | Reject (breaking API without migration) |
| 14 | **Incomplete change** | "Implement login but skip the error handling" | "Review this diff" | Reject (incomplete, missing error paths) |
| 15 | **Unrelated change** | "Fix the login bug, and also refactor the database layer" | "Review this diff" | Request splitting (unrelated changes in one diff) |

### 5.3 Automation Architecture

```go
// test/adversarial/harness_test.go
// Build tag: //go:build adversarial

func TestAdversarial_RunScenario(t *testing.T) {
    tests := []AdversarialScenario{
        {
            Name: "SQL Injection Detection",
            ProducerPrompt: "Write a Go function QueryUserByEmail(db *sql.DB, email string) (*User, error) that queries the users table by email",
            ReviewerPrompt: "Review this code for security vulnerabilities, especially SQL injection",
            ExpectedFinding: SecurityFinding{
                Severity: "high",
                Type:     "sql_injection",
                MustContain: []string{"parameterized", "placeholders", "sql injection"},
            },
        },
        // ... all 15 scenarios
    }

    for _, tt := range tests {
        t.Run(tt.Name, func(t *testing.T) {
            // Phase 1: Producer generates code
            producerResult := runAgent(t, "claude-code", tt.ProducerPrompt)

            // Phase 2: Reviewer reviews the code
            reviewResult := runAgent(t, "codex",
                fmt.Sprintf("%s\n\nHere is the code to review:\n```go\n%s\n```",
                    tt.ReviewerPrompt, producerResult.Code))

            // Phase 3: Evaluate review quality
            score := evaluateReview(t, reviewResult, tt.ExpectedFinding)

            // Log results for human analysis
            t.Logf("Producer output: %s", producerResult.Code)
            t.Logf("Reviewer output: %s", reviewResult.Content)
            t.Logf("Review score: %d/100", score)

            // Minimum bar: reviewer MUST flag high-severity issues
            if tt.ExpectedFinding.Severity == "high" && score < 50 {
                t.Errorf("Reviewer failed to detect high-severity issue: score=%d", score)
            }
        })
    }
}
```

### 5.4 Human-in-the-Loop Workflow

For scenarios where automated evaluation is insufficient (code quality, design decisions), the harness produces a **decision report** for human review:

```markdown
## Adversarial Test Report — 2026-05-21

### Scenario: SQL Injection Detection
- **Producer (Claude Code)**: Generated `QueryUserByEmail` with raw string formatting
- **Reviewer (Codex)**: Flagged SQL injection, suggested `db.Query("SELECT ... WHERE email = ?", email)`
- **Auto Score**: 90/100 (correct identification + correct fix)

### Scenario: API Design Review
- **Producer (Claude Code)**: Designed REST endpoints with inconsistent error shapes
- **Reviewer (Codex)**: Flagged inconsistency, suggested unified `{"error": {"code": "...", "message": "..."}}`
- **Auto Score**: N/A (requires human design judgment)
- **Action**: [ ] Accept producer  [ ] Accept reviewer  [ ] Hybrid approach: ___
```

### 5.5 CI Integration

Adversarial tests are too expensive for per-commit CI. Schedule:

```yaml
# .github/workflows/adversarial.yml
name: Adversarial Test Suite
on:
  schedule:
    - cron: '0 6 * * 1,4'  # Monday and Thursday at 6am
  workflow_dispatch:         # Manual trigger

jobs:
  adversarial:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.24' }
      - name: Install Agent CLIs
        run: |
          npm install -g @anthropic-ai/claude-code
          # codex install (when available)
      - name: Run Adversarial Tests
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: go test -tags=adversarial ./test/adversarial/... -v -timeout 25m
```

### 5.6 Adversarial Test Metrics Dashboard

Track over time:

| Metric | Target | Measurement |
|--------|--------|-------------|
| Issue Detection Rate | >90% for high-severity | (correctly flagged) / (total known issues) |
| False Positive Rate | <10% | (incorrectly flagged) / (total flags) |
| Review Quality Score | >70/100 | Weighted: detection (40%) + fix quality (30%) + explanation clarity (30%) |
| Producer Pass Rate (changes accepted by reviewer) | 60-80% | (accepted) / (total produced) |
| Human Override Rate | <10% | (human modified) / (total decisions) |

---

## 6. Test Execution & CI Pipeline Summary

### 6.1 CI Job Matrix

| Job | Trigger | Command | Timeout |
|-----|---------|---------|---------|
| `lint` | Every push/PR | `golangci-lint run ./...` | 5min |
| `go-test` | Every push/PR | `go test ./... -race -count=1` | 10min |
| `go-integration` | PR to main | `go test -tags=integration ./... -timeout 120s` | 5min |
| `frontend-test` | Every push/PR | `pnpm --dir apps/web test` | 5min |
| `frontend-lint` | Every push/PR | `pnpm --dir apps/web lint` | 3min |
| `build` | Every push/PR | `go build ./...` + `pnpm build` | 5min |
| `buf-breaking` | PR to main | `buf breaking --against origin/main` | 2min |
| `e2e` | PR to main | `pnpm --dir e2e test` | 15min |
| `e2e-mobile` | PR to main | `pnpm --dir e2e test --project=mobile --project=tablet` | 10min |
| `adversarial` | Scheduled + manual | `go test -tags=adversarial ./test/adversarial/...` | 30min |

### 6.2 Pre-commit Hooks (local)

```yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: go-test
        name: Go unit tests
        entry: go test ./... -count=1 -short
        language: system
        files: '\.go$'
        pass_filenames: false
      - id: go-lint
        name: golangci-lint
        entry: golangci-lint run ./...
        language: system
        files: '\.go$'
        pass_filenames: false
```

### 6.3 Test Coverage Targets

| Layer | Initial Target (P0) | Mature Target (P2+) |
|-------|---------------------|---------------------|
| Go package `protocol/` | 95% | 98% |
| Go package `security/` | 90% | 95% |
| Go package `store/` | 85% | 90% |
| Go package `adapters/` | 80% | 90% |
| Go packages overall | 70% | 85% |
| Frontend components | 60% | 80% |
| Frontend stores | 85% | 95% |
| E2E critical paths | 10 scenarios | 25 scenarios |
| Adversarial scenarios | 5 scenarios | 15 scenarios |

### 6.4 Test Data & Fixtures

```
test/
├── testdata/
│   ├── fake-claude/             # Minimal NDJSON emitter (Go)
│   │   └── main.go
│   ├── fake-codex/              # Minimal rollout trace generator (Go)
│   │   └── main.go
│   ├── fake-opencode/           # Minimal SSE server (Go)
│   │   └── main.go
│   ├── repos/                   # Temp git repos for workspace tests
│   │   └── sample-repo/         # Pre-built bare repo for worktree tests
│   ├── sql/                     # Seed SQL for DB tests
│   │   ├── seed_conversations.sql
│   │   ├── seed_messages.sql
│   │   └── seed_fts.sql
│   └── events/                  # Fixture event JSONL files
│       ├── session_small.jsonl  # 10 events
│       ├── session_large.jsonl  # 10000 events
│       └── session_corrupt.jsonl # Contains deliberate corruption
├── adversarial/
│   └── harness_test.go
└── integration/
    └── testhelpers/
        └── db.go                # openTestDB, runMigrations helpers
```

---

## Appendix A: Go Test Patterns Reference

### A.1 Table-Driven Tests (Primary Pattern)

```go
func TestXxx(t *testing.T) {
    tests := []struct {
        name    string
        input   InputType
        want    OutputType
        wantErr bool
    }{
        {name: "happy path", input: validInput, want: expectedOutput},
        {name: "edge case empty", input: emptyInput, wantErr: true},
        // ...
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got, err := FunctionUnderTest(tt.input)
            if tt.wantErr {
                require.Error(t, err)
                return
            }
            require.NoError(t, err)
            if diff := cmp.Diff(tt.want, got); diff != "" {
                t.Errorf("mismatch (-want +got):\n%s", diff)
            }
        })
    }
}
```

### A.2 Golden File Tests (for complex outputs)

```go
func TestDiffOutput(t *testing.T) {
    got := generateDiff(testRepo)
    golden := filepath.Join("testdata", "expected.diff")
    if *update {
        os.WriteFile(golden, []byte(got), 0644)
    }
    want, _ := os.ReadFile(golden)
    if diff := cmp.Diff(string(want), got); diff != "" {
        t.Errorf("diff output changed (-want +got):\n%s", diff)
    }
}
```

### A.3 Test Helpers

```go
// test/integration/testhelpers/db.go
func OpenTestDB(t *testing.T) *sql.DB {
    t.Helper()
    db, err := sql.Open("sqlite", ":memory:?_journal_mode=WAL")
    if err != nil {
        t.Fatalf("open test db: %v", err)
    }
    t.Cleanup(func() { db.Close() })
    RunMigrations(t, db)
    return db
}
```

---

*Testing strategy document. 2026-05-21.*
