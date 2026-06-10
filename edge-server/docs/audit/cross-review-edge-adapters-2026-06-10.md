# Cross-Review: Edge Server Adapters

**Date**: 2026-06-10
**Scope**: `edge-server/internal/adapters/` — all adapter implementations, registry, security, event, and fixture infrastructure.
**Reviewer**: Automated cross-review

---

## 1. Adapter-by-Adapter Compliance Report

### 1.1 ClaudeCodeAdapter (`claude_code.go`)

| Dimension | Status | Notes |
|-----------|--------|-------|
| AgentAdapter compliance | PASS | All 5 methods implemented: Metadata, Capabilities, BuildCommand, ParseStream, NeedsStdin, Available |
| Event coverage | PASS | Full NDJSON protocol via NDJSONStreamParser — all bus events covered |
| Error handling | PASS | Delegates to NDJSONStreamParser; ParseStreamError wrapping handled there |
| Security hooks | PASS | SecureEmitter at executor level + NDJSONStreamParser also runs PreToolUse inline (dual-path, see Finding F-01) |
| Resource cleanup | PASS | No owned resources; process lifecycle managed by ProcessExecutor |
| Permission broker | PASS | Has SetPermissionBroker + BrokeredPermissionHandler for stdin control protocol |
| stdin requirement | PASS | NeedsStdin=true (correct — Claude Code uses stdin for control protocol) |

**Findings**:
- None blocking. This is the reference adapter.

---

### 1.2 CodexAdapter (`codex.go`)

| Dimension | Status | Notes |
|-----------|--------|-------|
| AgentAdapter compliance | PASS | All 5 methods present |
| PreflightAdapter | PASS | Implements PreflightCheck() for OPENAI_API_KEY + binary check |
| Event coverage | PASS | Maps all Codex exec protocol events (thread.started, turn.started/completed/failed, item.started/completed/updated, error) |
| Error handling | PASS | Panic recovery in ScanLines handler; JSON parse errors fall back to raw text |
| Security hooks | PASS | Covered by SecureEmitter at executor level |
| Resource cleanup | PASS | No owned resources |
| Budget tracking | PASS | CtxBudgetKey extraction, cumulative Track() per turn |
| stdin requirement | PASS | NeedsStdin=false (correct — batch JSONL mode) |

**Findings**:
- **F-02 (LOW)**: `a.budget` is set on the receiver struct (`a.budget = budget`) inside ParseStream. If ParseStream is called concurrently (unlikely but structurally possible), this is a data race. Should use a local variable or pass budget through the closure instead.
- **F-03 (INFO)**: `Capabilities().Streaming` is `false` but codex uses `--json` which is effectively streaming JSONL. The semantic intent is "Phase 1 batch" but the actual behavior is line-by-line streaming. Consider documenting this distinction.

---

### 1.3 OpenCodeAdapter (`opencode.go`)

| Dimension | Status | Notes |
|-----------|--------|-------|
| AgentAdapter compliance | PASS | All 5 methods present |
| Event coverage | PASS | Maps step_start, text, tool_use, reasoning, permission.asked, step_finish, error |
| Error handling | PASS | Panic recovery in ScanLines handler; unparseable lines silently skipped |
| Security hooks | PASS | Covered by SecureEmitter at executor level |
| Resource cleanup | PASS | No owned resources |
| Budget tracking | PASS | CtxBudgetKey extraction, cumulative Track() |
| stdin requirement | PASS | NeedsStdin=false (correct — batch mode) |

**Findings**:
- **F-04 (LOW)**: Same budget race as Codex — `a.budget = budget` mutates receiver inside ParseStream.
- **F-05 (MEDIUM)**: `Capabilities().MCPIntegration` is not set (defaults to false), but there is no comment explaining why. If OpenCode supports MCP in the future, this will silently under-report capability.
- **F-06 (LOW)**: `Capabilities().SubAgentSpawn` is not set (defaults to false). No documentation of whether OpenCode supports this.
- **F-07 (INFO)**: Tool_use events emit both BusEventToolCall and BusEventToolResult for a single `tool_use` event. This is semantically correct (one event = start + completion), but differs from Codex/Claude Code which split these across separate protocol events.

---

### 1.4 AnthropicSDKAdapter (`anthropic_sdk.go`)

| Dimension | Status | Notes |
|-----------|--------|-------|
| AgentAdapter compliance | PASS | All 5 methods present |
| PreflightAdapter | PASS | Implements PreflightCheck() for API key validation |
| CapabilityHealthMetadata | PASS | Exposes health metadata for capability reporting |
| Event coverage | PASS | Maps message_start, content_block_start/delta/stop, message_delta, message_stop, error |
| Error handling | PASS | HTTP errors emit BusEventResult + return NonRecoverableParseError; non-OK status codes handled |
| Security hooks | PASS | Covered by SecureEmitter at executor level |
| Resource cleanup | **ISSUE** | See F-08 |
| Budget tracking | PARTIAL | Emits BusEventContextUsage at message_stop, but no CtxBudgetKey / budget.Track() |
| stdin requirement | PASS | NeedsStdin=false (correct — HTTP-only adapter) |

**Findings**:
- **F-08 (MEDIUM)**: `httpClient := &http.Client{Timeout: anthropicHTTPTimeout}` is created per ParseStream call. This creates a new HTTP client (and transport) per request. While functionally correct, it means connection pooling is not shared across runs. A shared client with per-request context deadlines would be more efficient.
- **F-09 (LOW)**: No budget tracking via CtxBudgetKey. The adapter emits BusEventContextUsage but does not call budget.Track(). Other adapters (Codex, OpenCode) do track. This means budget-aware features (BudgetAwareEmitter, auto-compaction warnings) will not work for Anthropic SDK runs.
- **F-10 (INFO)**: `Capabilities().FileChanges` is false (correct — raw API has no file change detection). `Capabilities().PermissionHooks` is false (correct). These are properly reflected.
- **F-11 (LOW)**: The `buildMessages` method uses `role = "assistant"` inside `if role == "assistant"` — tautological but harmless. A comment or removal would improve clarity.

---

### 1.5 OpenAISDKAdapter (`openai_sdk.go`)

| Dimension | Status | Notes |
|-----------|--------|-------|
| AgentAdapter compliance | PASS | All 5 methods present |
| PreflightAdapter | PASS | Implements PreflightCheck() for API key validation |
| CapabilityHealthMetadata | PASS | Exposes health metadata for capability reporting |
| Event coverage | PASS | Maps Chat Completions SSE: text deltas, tool call accumulation, reasoning content, finish |
| Error handling | PASS | HTTP errors emit BusEventResult + return NonRecoverableParseError |
| Security hooks | PASS | Covered by SecureEmitter at executor level |
| Resource cleanup | **ISSUE** | Same as F-08 — per-request HTTP client |
| Budget tracking | PARTIAL | Same as Anthropic — emits BusEventContextUsage but no budget.Track() |
| stdin requirement | PASS | NeedsStdin=false (correct) |

**Findings**:
- **F-12 (MEDIUM)**: Same HTTP client per-request issue as AnthropicSDKAdapter (F-08). Both SDK adapters should share a common approach.
- **F-13 (LOW)**: Same budget tracking gap as F-09 — no CtxBudgetKey integration.
- **F-14 (INFO)**: Tool calls are accumulated during streaming and only emitted at stream end (after the `[DONE]` sentinel). This means tool_call events arrive late compared to other adapters. The UI may need to handle this latency difference.
- **F-15 (INFO)**: `Capabilities().ThinkingVisible` is false. The adapter does handle `reasoning_content` from o-series models and emits BusEventThinking. The capability flag should be true if reasoning visibility is supported.

---

### 1.6 RuntimeManifestAdapter (`runtime_manifest.go`)

| Dimension | Status | Notes |
|-----------|--------|-------|
| AgentAdapter compliance | PASS | All 5 methods present |
| CapabilityHealthMetadata | PASS | Exposes fixture health metadata |
| Event coverage | PASS | Delegates to MapSDKFixtureStream which maps fixture events to bus events |
| Error handling | PASS | Validates manifest schema, fixture path existence |
| Security hooks | PASS | Covered by SecureEmitter at executor level |
| Resource cleanup | PASS | File reads are bounded; io.ReadAll on subprocess stdout |
| stdin requirement | PASS | Returns false for fixture-file, manifest.Stdin for fixture-subprocess |
| Available | PASS | Validates manifest + checks fixture file existence |

**Findings**:
- **F-16 (LOW)**: `io.ReadAll(stdout)` in fixture-subprocess mode has no size limit. A malicious or runaway fixture subprocess could exhaust memory. Should use io.LimitReader.

---

### 1.7 Fixture Infrastructure (`agentspec_fixture.go`)

| Dimension | Status | Notes |
|-----------|--------|-------|
| Purpose | PASS | Compiles AgentHubAgentSpec V1 schemas into no-spend fixture streams |
| Validation | PASS | Schema version check, required fields, rejects live runtime allowance |
| Event coverage | PASS | Emits invocation_plan, capability_health, session_ready via SDKFixtureStream |
| Security | PASS | Prompt redacted, no-spend enforced, no SDK/API/CLI calls |

**Findings**:
- None. This is pure data transformation with proper validation.

---

## 2. Event Mapping Consistency Matrix

### 2.1 Core Lifecycle Events

| Event | Claude Code | Codex | OpenCode | Anthropic SDK | OpenAI SDK |
|-------|:-----------:|:-----:|:--------:|:-------------:|:----------:|
| `session_init` | system.init | thread.started | step_start | session_init | session_init |
| `session_state_changed` | system.init (busy) | turn.started/completed (busy/idle) | step_start/step_finish (busy/idle) | -- | -- |
| `text_delta` | content_block_delta | -- (raw text fallback) | text (via part) | content_block_delta | delta.content |
| `text_block` | content_block_stop (text) | agent_message | -- | content_block_stop (text) | post-stream accumulation |
| `thinking` | content_block (thinking) | reasoning item | reasoning part | thinking_delta | reasoning_content |
| `tool_call` | tool_use | item.started (cmd/mcp/web) | tool_use (start) | content_block_stop (tool_use) | post-stream accumulation |
| `tool_result` | tool_result | item.completed (cmd/mcp/web) | tool_use (completion) | -- | -- |
| `file_change` | tool_result (Write/Edit) | file_change item | tool_use (file-modifying) | -- | -- |
| `result` | result | turn.completed/failed, error | step_finish, error | message_stop, SSE error | post-stream |
| `context_usage` | usage (in result) | turn.completed (usage) | step_finish (tokens) | message_stop (usage) | post-stream (usage) |

### 2.2 Consistency Findings

- **F-17 (MEDIUM)**: `session_state_changed` is emitted by Codex and OpenCode (busy/idle transitions) but NOT by Anthropic SDK or OpenAI SDK. The Anthropic SDK emits `status_change` with "running" status at message_start, using a different event type. Consumers expecting `session_state_changed` for UI state indicators will not receive it from SDK adapters.

- **F-18 (LOW)**: OpenCode does not emit `text_block` events — only `text_delta`. Other adapters emit both delta (incremental) and block (complete). The OpenCode JSON protocol `text` event contains the full text in `part.text`, which is emitted as a delta. This may cause UI rendering differences.

- **F-19 (INFO)**: Anthropic SDK and OpenAI SDK do not emit `file_change` events (capabilities correctly report FileChanges=false). This is correct but should be documented for consumers.

- **F-20 (INFO)**: Claude Code NDJSON parser emits `tool_result` with a `content` key for tool output. Codex and OpenCode emit `output` key. The SecureEmitter handles both keys for PostToolUse, but downstream consumers should be aware of this inconsistency.

### 2.3 Permission Events

| Event | Claude Code | Codex | OpenCode | Anthropic SDK | OpenAI SDK |
|-------|:-----------:|:-----:|:--------:|:-------------:|:----------:|
| `permission_requested` | control protocol | -- | permission.asked | -- | -- |
| `permission_decided` | control protocol | -- | -- | -- | -- |

- Only Claude Code and OpenCode emit permission events. OpenCode's `permission.asked` is emitted with `nonInteractive: true` and `decisionBridge: "blocked"` — it is informational only, as the adapter does not have a permission broker for stdin responses.

---

## 3. Security Hook Coverage Report

### 3.1 Hook Application Architecture

```
                    ProcessExecutor
                         |
            +------------+------------+
            |                         |
     SecureEmitter              NDJSONStreamParser
     (all adapters)            (Claude Code only)
            |                         |
         HookChain              HookChain (inline)
```

**SecureEmitter** wraps the emitter for ALL adapters at the ProcessExecutor level. It intercepts:
- `tool_call` events -> runs PreToolUse (classification + blocking)
- `tool_result` events -> runs PostToolUse (output inspection)

**NDJSONStreamParser** (Claude Code) ALSO runs PreToolUse inline in its `emit()` method. This means Claude Code tool calls pass through hooks TWICE (once in parser, once in SecureEmitter).

### 3.2 Coverage Matrix

| Adapter | SecureEmitter | Inline Hooks | Double-Hook Risk |
|---------|:------------:|:------------:|:-----------------:|
| Claude Code | YES | YES (NDJSONStreamParser) | YES (F-21) |
| Codex | YES | NO | NO |
| OpenCode | YES | NO | NO |
| Anthropic SDK | YES | NO | NO |
| OpenAI SDK | YES | NO | NO |

**Findings**:
- **F-21 (MEDIUM)**: Claude Code tool_call events are hooked twice — once by NDJSONStreamParser.emit() and once by SecureEmitter. The first hook may modify the payload (e.g., set `status: "blocked"`), and the second hook runs on the already-modified payload. For idempotent hooks (like SecurityHook), this is safe (blocked input is re-classified and stays blocked). But for stateful hooks, this could cause double-counting or unexpected behavior. The NDJSONStreamParser inline hooks should be removed now that SecureEmitter provides uniform coverage.

### 3.3 SecurityHook Risk Classification

The SecurityHook classifies tools into 5 risk levels:

| Risk Level | Tools | Auto-approve? |
|------------|-------|:------------:|
| RiskLow | Read, Grep, Glob | YES |
| RiskMedium | Write, Edit, NotebookEdit | YES (Auto/YOLO) |
| RiskHigh | Bash, WebFetch, WebSearch, Skill, SendMessage, TaskCreate, TaskUpdate, mcp__* | Confirm (Auto) |
| RiskBlocked | rm -rf /, curl\|bash, sudo bash, chmod 777, >/dev/sda | DENY |
| RiskCritical | (reserved, not classified by any tool) | DENY |

### 3.4 Blocked Pattern Coverage

The `dangerousPatternsRE` covers 7 categories with self-tests:
1. Root deletion (rm -rf /)
2. Remote execution (curl/wget | shell)
3. Root shell escalation (sudo bash, sudo -i, sudo su)
4. World-writable (chmod 777)
5. Block device overwrite (>/dev/sda, dd of=/dev/*)
6. Raw device copy (cp/mv to /dev/sd*)
7. Tee to block device

Positive and negative test cases are verified at init() time with panics on failure.

---

## 4. Resource Cleanup Issues

### 4.1 Process-Based Adapters (Claude Code, Codex, OpenCode)

- **Process lifecycle**: Managed by ProcessExecutor, not by adapters. Adapters only build commands and parse output. CLEAN.
- **stdin pipe**: Claude Code requests stdin (NeedsStdin=true). ProcessExecutor is responsible for closing the pipe. Adapter does not own it.
- **Scanner buffers**: ScanLines and bufio.Scanner are stack-allocated. GC-managed. CLEAN.

### 4.2 SDK Adapters (Anthropic SDK, OpenAI SDK)

- **F-22 (MEDIUM)**: HTTP clients are created per-request (`&http.Client{Timeout: 30*time.Minute}`). Each client gets its own transport with a fresh connection pool. Under high concurrency, this wastes file descriptors and prevents TCP connection reuse. Should use a shared `http.Client` (or at minimum a shared `http.Transport`) stored on the adapter struct.

- **F-23 (LOW)**: Response body is closed via `defer resp.Body.Close()`. This is correct but the close happens after the SSE stream is fully consumed by the scanner. If the scanner returns early (context cancellation), the deferred close will still fire. CLEAN.

- **F-24 (INFO)**: SDK adapters use a sentinel noop command (`cmd /c exit 0` on Windows, `true` on Linux). The noop process starts and exits immediately. Its stdout/stdin pipes are unused. ProcessExecutor must handle this gracefully (not block on stdout read from an already-exited process). This is a ProcessExecutor concern, not an adapter concern.

### 4.3 Runtime Manifest Adapter

- **F-25 (LOW)**: `io.ReadAll(stdout)` for fixture-subprocess mode has no size bound (see F-16).

### 4.4 Goroutine Leaks

- No goroutines are spawned by any adapter. ScanLines and SSE parsing are synchronous, blocking operations driven by the caller. CLEAN.

---

## 5. Recommendations

### Priority 1 — Should Fix

| ID | Finding | Recommendation |
|----|---------|----------------|
| F-21 | Claude Code double-hooked | Remove inline PreToolUse from NDJSONStreamParser.emit(). SecureEmitter now provides uniform coverage for all adapters. |
| F-22 | Per-request HTTP clients | Initialize a shared `http.Client` in NewAnthropicSDKAdapter/NewOpenAISDKAdapter. Use context deadlines for per-request timeouts instead of client-level Timeout. |
| F-09/F-13 | SDK adapters lack budget tracking | Extract CtxBudgetKey in both SDK adapters and call budget.Track() when usage data is available (at message_stop / post-stream). |

### Priority 2 — Should Consider

| ID | Finding | Recommendation |
|----|---------|----------------|
| F-17 | SDK adapters skip session_state_changed | Emit BusEventSessionStateChanged (busy at start, idle at result) in both SDK adapters for UI consistency. |
| F-08/F-12 | HTTP client efficiency | Extract a shared `sdkHTTPClient` helper for both SDK adapters with proper transport settings (MaxIdleConns, IdleConnTimeout). |
| F-16/F-25 | Unbounded io.ReadAll | Wrap with `io.LimitReader(stdout, maxFixtureSize)` in RuntimeManifestAdapter. |
| F-02/F-04 | Budget mutation on receiver | Change Codex and OpenCode adapters to use local budget variable captured by closure instead of mutating `a.budget`. |
| F-15 | OpenAI SDK ThinkingVisible | Set `ThinkingVisible: true` since the adapter handles `reasoning_content` and emits BusEventThinking. |

### Priority 3 — Nice to Have

| ID | Finding | Recommendation |
|----|---------|----------------|
| F-18 | OpenCode missing text_block | Consider accumulating text deltas and emitting a final BusEventTextBlock at step_finish for consistency. |
| F-20 | Tool output key inconsistency | Consider normalizing tool output to a consistent key (e.g., always "output") in SecureEmitter or a post-processing layer. |
| F-03 | Codex Streaming capability flag | Document that `Streaming: false` means "no incremental token streaming" (batch JSONL) rather than "no real-time events". |
| F-05/F-06 | OpenCode capability gaps | Add explicit comments for unset capabilities (MCPIntegration, SubAgentSpawn) explaining whether they are not supported or not yet implemented. |
| F-11 | Tautological role assignment | Clean up `if role == "assistant" { role = "assistant" }` in AnthropicSDKAdapter.buildMessages. |

---

## 6. Interface Compliance Summary

| Adapter | Metadata | Capabilities | BuildCommand | ParseStream | NeedsStdin | Available | PreflightCheck | CapabilityHealth |
|---------|:--------:|:------------:|:------------:|:-----------:|:----------:|:---------:|:--------------:|:----------------:|
| ClaudeCode | OK | OK | OK | OK | OK (true) | OK | -- | -- |
| Codex | OK | OK | OK | OK | OK (false) | OK | OK | -- |
| OpenCode | OK | OK | OK | OK | OK (false) | OK | -- | -- |
| AnthropicSDK | OK | OK | OK | OK | OK (false) | OK | OK | OK |
| OpenAISDK | OK | OK | OK | OK | OK (false) | OK | OK | OK |
| RuntimeManifest | OK | OK | OK | OK | OK | OK | -- | OK |

- All 6 core adapters fully implement the AgentAdapter interface (5 required methods).
- 3 adapters additionally implement PreflightAdapter (Codex, AnthropicSDK, OpenAISDK).
- 3 adapters additionally implement CapabilityHealthMetadata (AnthropicSDK, OpenAISDK, RuntimeManifest).
- No adapter has methods that always return nil/error (all paths are functional).

---

## 7. Supporting Infrastructure Assessment

| File | Purpose | Assessment |
|------|---------|------------|
| `adapter.go` | Interface + event types + error types | Clean. ParseStreamError with recoverable flag is well-designed. |
| `registry.go` | Adapter registration + resolution | Clean. Thread-safe with RWMutex. ValidateCLIAdapterID covers all 5 IDs. |
| `security_hooks.go` | Tool risk classification + blocked patterns | Thorough. 7 blocked categories, init-time self-test, SkillInspector support. |
| `event_emitter.go` | BusEventEmitter, ScopedEmitter, PayloadLimitEmitter, BudgetAwareEmitter | Clean. Payload truncation with UTF-8 safety. BudgetAwareEmitter prevents recursive emission. |
| `secure_emitter.go` | Unified security layer for all adapters | Clean. Handles both "content" and "output" keys for PostToolUse. |
| `scanner.go` | Shared ScanLines with context cancellation | Clean. Properly sized buffer (256KB initial, 10MB max). |
| `sdk_common.go` | Cross-platform noop command | Minimal and correct. |
| `model_config.go` | Model aliases + reasoning effort resolution | Complete. All 5 adapters have aliases. ResolveModelWithDefault provides safe fallback. |
| `context_budget.go` | CtxBudgetKey constant | Minimal. |
| `agentspec_fixture.go` | AgentSpec V1 to fixture stream compilation | Thorough validation, no-spend enforcement. |
| `runtime_manifest.go` | Custom runtime manifest loading | Good validation, unsafe transport blocking, secret redaction. |
