# Edge Server Adapter Issues & Fixes

> Generated: 2026-05-25 | Auditor: Agent 4 — Edge Adapter Audit

## 1. Critical Issue: "no stdin data received in 3s" Warning

### 1.1 Root Cause Analysis

**Source chain:**

```
ClaudeCodeAdapter.NeedsStdin() returns true
  → process_executor.go:332-342 opens stdin pipe
  → cmd.Start() with stdin pipe attached
  → Claude Code CLI starts, sees a connected stdin pipe
  → Claude Code waits for stdin data (control protocol messages)
  → After 3 seconds of no data, Claude Code warns: "no stdin data received in 3s"
  → Eventually Claude Code proceeds (it doesn't hang — it just warns)
```

**Files involved:**
- `edge-server/internal/adapters/claude_code.go:180` — `NeedsStdin() bool { return true }`
- `edge-server/internal/lifecycle/process_executor.go:332-342` — stdin pipe creation
- `edge-server/internal/lifecycle/process_executor.go:574-593` — `publishStructuredOutput` passes stdin to `ParseStream`
- `edge-server/internal/adapters/claude_code.go:169-177` — `ParseStream` checks `if stdin != nil` and adds control handler

**Why `NeedsStdin()` returns true:**
The stdin pipe is needed for the **control protocol** — when the Desktop user approves/denies a tool permission, the decision is written to the CLI's stdin via `WriteInterrupt()` or permission responses. Without stdin, permission bridging would not work.

### 1.2 Proposed Solutions

#### Option A: Close Stdin Pipe After Process Start (Not Viable)

Close the stdin pipe immediately after `cmd.Start()` and only reopen it when needed for control messages.

**Problem:** Pipes cannot be "reopened." Once closed, the CLI process sees EOF on stdin, which may trigger unexpected behavior (e.g., Claude Code might interpret EOF as "session ended").

#### Option B: Change NeedsStdin() to Return false Until Permission Bridge is Complete (Not Viable)

Return `false` from `NeedsStdin()` to prevent pipe creation. Handle permission decisions through a different channel.

**Problem:** There is no alternative channel. The Claude Code control protocol REQUIRES stdin for bidirectional communication. Permission decisions, interrupts, model changes — all go through stdin.

#### Option C: Pass --input-format Flag to Disable Stdin Reading **(Recommended)**

Claude Code CLI has a flag to control how it reads input. By specifying `--input-format` or a similar flag, we can tell Claude Code not to read from stdin for prompts.

**Research needed:** Verify if Claude Code supports `--no-stdin` or `--input-format none` flag. Check Claude Code source:
- `-p` flag: "prompt mode" — reads prompt from CLI arg, not stdin
- When `-p` is used, Claude Code should NOT be reading stdin for the prompt — but it may still poll stdin for control messages

**Actual fix for this approach:** The `BuildCommand` in `claude_code.go` already uses `-p` flag (line 62). When `-p` is used, Claude Code should not be waiting for stdin. The warning likely comes from the control protocol handshake (Claude Code periodically checks stdin for control messages). 

**Best fix:** Close the stdin pipe from the AgentHub side immediately after `cmd.Start()`, BUT keep the `io.Writer` reference. Then, only when we need to send a control message, we attempt to write — but writes to a closed pipe will fail. Instead, we should **close stdin only if no permission requests arrive within a timeout**.

#### Option D: Lazy Stdin — Create Pipe on Demand **(Innovative)**

Instead of creating the stdin pipe before `cmd.Start()`, use a named pipe or socket that can be connected to the CLI on-demand.

**Implementation:**
```go
// In ProcessExecutor.Start():
// 1. Don't create stdin pipe
// 2. cmd.Start() without stdin
// 
// In publishStructuredOutput():
// 3. Pass a "lazy stdin" wrapper to ParseStream
// 4. The wrapper creates the actual connection only when Write() is first called
```

**Problem:** You can't add stdin to a process after it has started. The child process must inherit the pipe at creation time.

#### Option E: Suppress the Warning at the Parser Level **(Quick Fix, Recommended for P0)**

The warning originates from the Claude Code CLI's stdout (it's printed as a log message, not an error). In the NDJSON parser (`parser_ndjson.go`), we can filter out this specific log message.

**Implementation:**
```go
// In parser_ndjson.go or scanner.go:
// Skip NDJSON lines where:
//   type == "log" && message contains "no stdin data received"
```

This is a band-aid — it suppresses the symptom but the pipe is still open and Claude Code still checks it. But it's the lowest-risk fix.

#### Option F: Pre-write Control Init Message to Stdin **(Mitigation)**

Before spawning the process, immediately write a control protocol INIT message to stdin after opening the pipe. This tells Claude Code that the control channel is active.

```go
// In process_executor.go, after stdin pipe creation, before cmd.Start():
if stdin != nil {
    // Write control protocol init
    initMsg := `{"type":"control_request","request_id":"init","request":{"subtype":"initialize"}}` + "\n"
    stdin.Write([]byte(initMsg))
}
// Then start cmd
cmd.Start()
```

Claude Code would receive the init message immediately and know the control channel is active, suppressing the 3s timeout warning.

### 1.3 Recommended Solution

**Combine E and F:**
1. **Pre-write init message** (Option F) — eliminates the root cause of the warning
2. **Filter log-level messages about stdin** (Option E) — belt and suspenders

Both are low-risk, one-line changes.

---

## 2. Other Adapter Issues

### 2.1 Claude Code Adapter

| Issue | File:Line | Severity | Fix |
|---|---|---|---|
| `--max-thinking-tokens` deprecated | `claude_code.go:93-98` | Low | Already using `--thinking` mode. Legacy fallback is fine. |
| No `--dangerously-skip-permissions` in permission mode mapping | `claude_code.go:81` | Low | `--permission-mode` is passed correctly. Verify allowed values match Claude Code's current CLI. |
| `--add-dir` always uses `"."` as fallback | `claude_code.go:160-164` | Low | `workDir` defaults to `"."` which may be wrong if the user hasn't set a workspace. Consider using the Edge server's working directory. |

### 2.2 Codex Adapter

| Issue | File:Line | Severity | Fix |
|---|---|---|---|
| Phase 1 exec mode vs Phase 2 app-server | `codex.go` | Medium | Verify Codex CLI supports `--serve` mode. Phase 2 implementation may need different adapter. |
| Event mapping | `codex_event_parser.go` | Low | Verify Codex NDJSON event types still match current Codex CLI output. Events can drift between versions. |

**Assessment:** The Codex adapter seems well-structured. The Phase 1 (exec mode) vs Phase 2 (app-server) split is a design concern, not a bug.

### 2.3 OpenCode Adapter

| Issue | File:Line | Severity | Fix |
|---|---|---|---|
| Missing event types? | `opencode.go` | Low | OpenCode's event protocol has been stable. No known missing types. |
| Integration test exists | `opencode_adapter_integration_test.go` | — | Coverage is good. |

### 2.4 Control Protocol

| Issue | File:Line | Severity | Fix |
|---|---|---|---|
| Permission handler blocks on decider | `control_protocol.go:119-125` | Medium | If the decider callback hangs (Desktop crashes/connection lost), the entire run blocks. Need a timeout. |
| DefaultPermissionHandler auto-approves | `control_protocol.go:126-128` | Medium | When no decider is configured, all tools are auto-approved. This is intentional for local mode but should be logged. |

**Fix for blocking decider:**
```go
func (h *DefaultPermissionHandler) handleCanUseTool(stdin io.Writer, requestID string, inner *ControlRequestInner) error {
    // ... emit event ...
    var decision PermissionDecision
    if h.decider != nil {
        ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
        defer cancel()
        
        decisionCh := make(chan PermissionDecision, 1)
        go func() {
            decisionCh <- h.decider(ctx, PermissionRequest{...})
        }()
        
        select {
        case decision = <-decisionCh:
        case <-ctx.Done():
            decision = PermissionDecision{Behavior: "deny", Message: "Approval timeout"}
        }
    } else {
        decision = PermissionDecision{Behavior: "allow"}
    }
    // ... write response ...
}
```

### 2.5 Process Executor

| Issue | File:Line | Severity | Fix |
|---|---|---|---|
| Run timeout 30 min may be too short | `process_executor.go:98` | Low | Some complex tasks may need longer. Consider making it configurable per run. |
| Max concurrent runs: 5 | `process_executor.go:101` | Low | Hardcoded. Should be configurable. |
| `SetMetrics` is optional but never called with nil check everywhere | `process_executor.go:149-151` | Low | Nil check exists in `run()` method — fine. |

### 2.6 NDJSON Parser / Scanner

| Issue | File:Line | Severity | Fix |
|---|---|---|---|
| Large JSON payloads could OOM | `parser_ndjson.go` | Medium | No per-line size limit. Consider adding `MaxLineSize` with `bufio.Scanner.Buffer()`. |
| Context cancellation not checked in inner loops | `scanner.go` | Low | Should check `ctx.Done()` between lines to allow faster cancellation. |

---

## 3. Summary of Findings

### Critical (P0)
| # | Issue | Files | Fix |
|---|---|---|---|
| 1 | "no stdin data received in 3s" warning | `claude_code.go:180`, `process_executor.go:332-342` | Pre-write init message + filter log |

### High (P1)
| # | Issue | Files | Fix |
|---|---|---|---|
| 2 | Permission decider blocking without timeout | `control_protocol.go:119-125` | Add 30s timeout |
| 3 | Permission auto-approve without logging | `control_protocol.go:126-128` | Add debug log |

### Medium (P2)
| # | Issue | Files | Fix |
|---|---|---|---|
| 4 | Run timeout not configurable | `process_executor.go:98` | Config field |
| 5 | Max concurrent runs not configurable | `process_executor.go:101` | Config field |
| 6 | No per-line size limit in scanner | `parser_ndjson.go` | `MaxLineSize` config |
| 7 | Context not checked between scan lines | `scanner.go` | `ctx.Done()` check |

**Total actionable items: 7**
