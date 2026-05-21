# AgentHub Error Handling & User Feedback UX Design

> Synthesized from: `opencode.md` (LLMErrorReason 10-variant + RouteExecutor retry),
> `cross-analysis-adapters.md` (Section 3 per-agent workarounds + ResultPayload subtypes),
> `design-desktop-ux.md` (DiffCard + ConnectionStatus + Toast + RunStore states),
> `deep-dive-claude-code-tool-security.md` (SecurityViolation severity + PolicyEngine decisions)
> Date: 2026-05-21

---

## 1. Error Classification Taxonomy

### 1.1 Three-Axis Model

Every error in the AgentHub system is classified along three orthogonal axes.
This taxonomy merges OpenCode's `LLMErrorReason` discriminated union,
CC's `result.is_error` / exit-code semantics, and AgentHub's own `ResultSubtype` model.

```
                    ┌── User-Fixable (retry after user action)
                    │
Error ──Origin──────┼── System (infrastructure, transient or operator-fixable)
                    │
                    └── Agent-Internal (model output invalid, tool logic bug)
```

#### Axis 1: Origin (who can fix it)

| Origin | Definition | Examples | Source |
|--------|-----------|----------|--------|
| **User-Fixable** | Requires user to change input, credentials, or configuration before retry | InvalidRequest (bad params), Authentication (401/403), QuotaExceeded, ContentPolicy (prompt violates filter), RateLimit (user can wait or upgrade) | OpenCode LLMErrorReason |
| **System** | Infrastructure failure outside user control; transient or requires operator intervention | Transport (network/timeout), ProviderInternal (500/503/504), NoRoute (misconfiguration), MCP connection failure, Edge WS disconnect | OpenCode + connectionStore |
| **Agent-Internal** | The model or tool produced invalid output, or the agent hit a logical limit | InvalidProviderOutput (parse error), max_turns, max_budget_usd, tool execution failure, security violation (misparsing), subprocess crash | ResultPayload subtypes + SecurityViolation |

#### Axis 2: Retryability (can the same request succeed on retry)

| Retryability | Behavior | Examples |
|-------------|----------|----------|
| **Auto-Retryable** | Transient; system retries automatically with backoff | RateLimit (429), ProviderInternal (500/503), Transport (timeout) |
| **Manual-Retryable** | User must change something before retry | Authentication (fix key), InvalidRequest (fix params), QuotaExceeded (top up), ContentPolicy (reword prompt) |
| **Non-Retryable** | Same request will always fail; requires alternative path | InvalidProviderOutput (model bug), security violation SeverityBlock, NoRoute |

> OpenCode's `LLMErrorReason` encodes retryability via a `retryable` getter per variant.
> AgentHub adopts the same pattern as a boolean field on `AgentHubError`.

#### Axis 3: Severity (how urgent / disruptive is the UX)

| Severity | UX Impact | Display Channel |
|----------|----------|----------------|
| **Info** | Background notification, no interruption | Toast (auto-dismiss 4s), log panel |
| **Warning** | Non-blocking alert; user should know but not blocked | Inline banner, connection dot yellow |
| **Error** | Action failed; user must acknowledge or retry | Inline error card, DiffCard red border, status badge |
| **Critical** | Session/connection broken; requires immediate user action | Modal or full-screen error state, connection dot red, blocking retry dialog |
| **Block** | Security violation; system denies execution | ApprovalCard (denied), security explainer, no retry path |

### 1.2 Unified Error Type (Go)

```go
// AgentHubError is the single error type flowing through all layers.
type AgentHubError struct {
    Code        ErrorCode       // machine-readable enum
    Origin      ErrorOrigin     // user-fixable | system | agent-internal
    Retryable   bool            // can the same input succeed on retry
    Severity    ErrorSeverity   // info | warning | error | critical | block
    Message     string          // human-readable (one sentence)
    Detail      string          // technical detail (stack, raw response, violation pattern)
    Suggestion  string          // actionable guidance for user ("Check your API key at...")
    RetryAction *RetryAction    // if non-nil, the UI renders this retry button/link
    Source      ErrorSource     // which layer produced this (llm, adapter, tool, security, edge)
    Raw         json.RawMessage // original provider error for debugging
}
```

### 1.3 ErrorCode Enum (merged from all four sources)

```go
type ErrorCode string

const (
    // --- LLM Provider errors (from OpenCode LLMErrorReason) ---
    ErrInvalidRequest        ErrorCode = "invalid_request"         // 400/404/409/422
    ErrNoRoute               ErrorCode = "no_route"                // no provider configured
    ErrAuthentication        ErrorCode = "authentication"          // 401/403
    ErrRateLimit             ErrorCode = "rate_limit"              // 429 (retryable)
    ErrQuotaExceeded         ErrorCode = "quota_exceeded"          // 429 quota
    ErrContentPolicy         ErrorCode = "content_policy"          // content filter rejection
    ErrProviderInternal      ErrorCode = "provider_internal"       // 500/503/504/529 (retryable)
    ErrTransport             ErrorCode = "transport"               // network/timeout (retryable)
    ErrInvalidProviderOutput ErrorCode = "invalid_provider_output" // parse error
    ErrUnknownProvider       ErrorCode = "unknown_provider"        // catch-all

    // --- Turn-level errors (from ResultPayload subtypes) ---
    ErrMaxTurns               ErrorCode = "max_turns"
    ErrMaxBudget              ErrorCode = "max_budget_usd"
    ErrMaxStructuredOutput    ErrorCode = "max_structured_output_retries"
    ErrExecution              ErrorCode = "error_during_execution"

    // --- Tool execution errors ---
    ErrToolNotFound     ErrorCode = "tool_not_found"
    ErrToolTimeout      ErrorCode = "tool_timeout"
    ErrToolDenied       ErrorCode = "tool_denied"
    ErrToolCrashed      ErrorCode = "tool_crashed"
    ErrSandboxDenial    ErrorCode = "sandbox_denial"

    // --- Security violations (from SecurityViolation) ---
    ErrSecurityBlock    ErrorCode = "security_block"     // SeverityBlock: always deny
    ErrSecurityWarning  ErrorCode = "security_warning"   // SeverityHigh: mandatory ask
    ErrSecurityNotice   ErrorCode = "security_notice"    // SeverityLow/Medium: non-misparsing

    // --- Connection / infrastructure ---
    ErrEdgeDisconnected ErrorCode = "edge_disconnected"
    ErrEdgeTimeout      ErrorCode = "edge_timeout"
    ErrRunnerUnavailable ErrorCode = "runner_unavailable"
    ErrMCPConnection    ErrorCode = "mcp_connection_failed"

    // --- Session / workflow ---
    ErrSessionNotFound  ErrorCode = "session_not_found"
    ErrForkFailed       ErrorCode = "fork_failed"
    ErrCompactionFailed ErrorCode = "compaction_failed"
    ErrMessageSendFailed ErrorCode = "message_send_failed"

    // --- Diff / Git errors (from desktop UX enums) ---
    ErrNotARepository   ErrorCode = "not_a_repository"
    ErrBranchNotFound   ErrorCode = "branch_not_found"
    ErrDiffParseError   ErrorCode = "diff_parse_error"
    ErrGitHookFailed    ErrorCode = "git_hook_failed"
    ErrNothingToCommit  ErrorCode = "nothing_to_commit"
    ErrGitConflict      ErrorCode = "git_conflict"
    ErrGitAuthFailed    ErrorCode = "git_auth_failed"
    ErrGitPushRejected  ErrorCode = "git_push_rejected"
)
```

---

## 2. Error Display UI: Four-Channel Model

### 2.1 Channel Decision Matrix

| Channel | Visibility | Dismissal | Best For | Examples |
|---------|-----------|-----------|----------|----------|
| **Inline Card** | Contextual, inside message stream | User scrolls past | Tool-level errors, diff failures, approval denials | DiffCard `apply_failed`, ToolResult `is_error`, ApprovalCard denied |
| **Toast** | Global, top-right stack | Auto-dismiss 4s or swipe | Transient notifications, background task completion | "Connection restored", "Message sent", "Compaction complete" |
| **Status Indicator** | Persistent, sidebar footer | None (always visible) | Connection health, run state, MCP server status | ConnectionStatus dot (green/yellow/red), RunIndicator |
| **Modal / Overlay** | Blocking, center-screen | Explicit dismiss button | Critical errors requiring user decision | Auth expired (re-login), session corrupted, fatal crash |

### 2.2 Inline Error Card (DiffCard pattern)

DiffCard error states from `design-desktop-ux.md` Section 3.2 generalize to all tool-result error displays:

| Component State | Visual | Actions |
|-----------------|--------|---------|
| `pending` (default) | Yellow left border | [Apply] [Discard] [View Full] |
| `applying` | Animating pulse | Spinner "Applying..." |
| `applied` | Green left border, fade to gray | [Undo (5s window)] |
| `apply_failed` | Red left border | Red "Failed" + [Retry] [Discard] |
| `discarded` | Gray left border, opacity reduced | "Discarded" grayed out |

Generalized to `ErrorCard`:

```tsx
// src/components/chat/ErrorCard.tsx
interface ErrorCardProps {
    error: AgentHubError
    context: "tool_result" | "diff" | "approval" | "send_failed"
    onRetry?: () => void
    onDismiss?: () => void
    onModify?: () => void  // "Edit & Resend" for message failures
}
```

**Render rules:**
- `Severity == "block"`: Red left border, no retry button, explainer text ("This command was blocked by security policy: ...")
- `Severity == "critical"`: Red left border, primary [Retry] + secondary [Dismiss]
- `Severity == "error"`: Orange left border, [Retry] if Retryable, else [Dismiss]
- `Severity == "warning"`: Yellow left border, dismissable
- `Severity == "info"`: No border, inline text only

### 2.3 Toast Notification (from design-desktop-ux.md ToastContainer)

```tsx
// Toast types from AgentHub stores
type ToastType = "success" | "error" | "warning" | "info" | "loading"

// Toast lifecycle
// 1. Emitted by store action after WS event or API response
// 2. Stacked in ToastContainer (top-right, max 5 visible)
// 3. Auto-dismiss after 4s (configurable per toast)
// 4. User can swipe to dismiss early
// 5. "loading" toasts persist until replaced by success/error

// Examples:
// - "Connected to Edge: us1-desktop" (success, 3s)
// - "Message send failed — tap to retry" (error, persistent until action)
// - "Compaction completed: 12k tokens freed" (info, 4s)
// - "Security check: brace expansion obfuscation detected" (warning, 6s)
```

### 2.4 Connection Status Indicator (from `connectionStore`)

Permanent footer element in LeftSidebar:

```
Green dot + "us1-desktop" + "12ms" → normal
Yellow dot + "Connecting..."      → momentary (reconnect attempt N)
Red dot + "Disconnected"          → offline, with [Reconnect] button
Red banner (full-width)           → "Edge unreachable — offline mode" after max retries
```

Reconnect strategy: exponential backoff (1s, 2s, 4s, 8s, max 30s), reset on success.

### 2.5 Run Status Badge (from `runStore`)

Displayed in ChatHeader as `ExecutionBadge`:

| Status | Visual | Example text |
|--------|--------|-------------|
| `queued` | Gray pill | "Queued..." |
| `starting` | Blue pulse | "Starting..." |
| `running` | Green pulse | "Edge: us1-desktop / Runner #3" |
| `awaiting_approval` | Yellow pulse | "Waiting for approval..." |
| `completed` | Green check (2s) then gone | -- |
| `failed` | Red cross + error summary | "Failed: rate limit exceeded" |
| `cancelled` | Gray strikethrough | "Cancelled" |

---

## 3. Retry Strategy UX

### 3.1 Strategy Decision Tree

```
Error occurs
  │
  ├── Retryable && Severity < Critical?
  │     ├── Auto-retry active? (RouteExecutor, WS reconnect)
  │     │     └── Backoff timer running → Toast: "Retrying in 3s... (attempt 2/3)"
  │     │     └── All retries exhausted → Inline error card with [Manual Retry]
  │     └── No auto-retry?
  │           └── Inline error card with [Retry] button
  │
  ├── User-fixable?
  │     └── Error card with [Modify & Retry] or specific action link
  │           ("Open API key settings", "Check quota dashboard")
  │
  └── Non-retryable?
        └── Error card with explanation only, no retry button
              ("This model does not support tool use. Switch to Claude or Codex.")
```

### 3.2 Auto-Retry Patterns

#### LLM Route Executor (from OpenCode `RouteExecutor`)

```
Exponential backoff + jitter
  Base delay: 500ms
  Max delay: 10000ms
  Max retries: 2
  Retryable codes: RateLimit, ProviderInternal, Transport
  Sensitive header/query/body redaction before logging
  UI feedback: Toast "Request failed (500). Retrying... (1/2)"
```

#### WebSocket Reconnect (from `connectionStore`)

```
Exponential backoff
  Delays: 1s, 2s, 4s, 8s, max 30s
  Infinite retries (until explicit disconnect)
  UI: Connection dot transitions green→yellow→red
  After 3 failed attempts: red banner "Edge disconnected"
  On reconnect: Toast "Connection restored" + green dot
```

#### Message Send Retry (Optimistic UI)

```
Optimistic: message appears immediately with "sending..." indicator
  Timeout: 10s soft, 30s hard
  On soft timeout: spinner persists, toast "Still trying..."
  On failure: red dot on message, inline banner [Retry] [Edit & Resend] [Delete]
  On success: server ID replaces local ID, "sending..." → timestamp
```

### 3.3 Manual Retry UX

| Context | Trigger | UI Component | Actions |
|---------|---------|-------------|---------|
| Tool execution failed | `ToolResult.is_error` | ErrorCard (inline) | [Retry with same params] [Modify params & retry] |
| Diff apply failed | `DiffCard apply_failed` | DiffCard red border | [Retry] [Discard] |
| Message send failed | Send timeout/error | Inline banner on message | [Retry] [Edit & Resend] [Delete] |
| Approval denied | User or system denied | ApprovalCard | [Edit command & re-request] |
| Auth expired | 401 on API call | Modal overlay | [Re-enter credentials] [Switch API key] |
| Max turns/budget hit | Turn completes with error | Result card in stream | [Continue in new turn] [Increase limit] |

### 3.4 Security Violation Retry Path

Security violations have their own retry logic, distinct from operational errors:

| Severity | Auto-Deny? | Retry Path |
|----------|-----------|------------|
| **Block** | Yes (system) | No retry. Card explains which security rule was triggered. User must rephrase the prompt to avoid the pattern entirely. |
| **High** (misparsing) | Mandatory ask | ApprovalCard shown. User can [Approve Once]. Cannot auto-approve via allowlist. |
| **Medium** (non-misparsing) | Ask user | ApprovalCard shown. User can [Approve Once] or [Always Allow] (adds to allowlist). |
| **Low** (non-misparsing) | Ask user (fallback) | Allowlist rules can auto-approve. If no rule match, shows ApprovalCard. |

---

## 4. AgentHub Error Handling Architecture

### 4.1 Layer Responsibilities

```
┌──────────────────────────────────────────────────┐
│  UI Layer (React)                                │
│  ErrorCard / Toast / ConnectionDot / Modal       │
│  Reads: AgentHubError.Code, .Severity, .Suggestion│
│  Renders: appropriate channel + retry actions     │
└──────────────────┬───────────────────────────────┘
                   │ AgentHubError (serialized via WS/REST)
┌──────────────────┴───────────────────────────────┐
│  Edge Server (Go)                                │
│  ErrorNormalizer: adapter errors → AgentHubError │
│  ConnectionMonitor: WS health, reconnect logic   │
│  SessionErrorTracker: per-session error log      │
└──────────────────┬───────────────────────────────┘
                   │
┌──────────────────┴───────────────────────────────┐
│  Runner (Go)                                     │
│  PolicyEngine.Evaluate() → ApprovalDecision      │
│  SecurityPipeline.Evaluate() → SecurityViolation │
│  ToolExecutor → ToolResult (with is_error)       │
│  AdapterErrorMapper: native → AgentHubError      │
└──────────────────┬───────────────────────────────┘
                   │
┌──────────────────┴───────────────────────────────┐
│  Agent Adapter (Go)                              │
│  NDJSON/SSE/Rollout parser → AgentEvent stream   │
│  Error detection: exit code, result.is_error,    │
│    LLMErrorReason._tag, HTTP status codes        │
│  Maps native errors → AgentHubError via mapper   │
└──────────────────────────────────────────────────┘
```

### 4.2 Adapter Error Mapping (from cross-analysis-adapters.md Section 3)

Each adapter has unique error encodings that must be normalized:

#### Claude Code Adapter
```go
// CC-specific error sources and their mapping
var ccErrorMapping = map[string]ErrorCode{
    // result.is_error + result.errors[] strings
    // Exit code != 0 but result.is_error == false → warning (non-zero exit may be intentional)
    // tool_result.is_error == true → ErrExecution with tool context
}
```

**Workaround-aware error handling:**
- stdout guard interference (Workaround 1): stderr lines with `[stdout-guard]` prefix → log only, not user-facing
- Exit code interpretation (Workaround 2): always check `result.is_error`, not just exit code
- MCP startup latency (Workaround 4): `system_init` with 0 MCP tools on turn 1 → silent, not an error

#### Codex Adapter
```go
// Codex-specific: rollout trace parsing failures, sandbox errors
// Workaround 8: sandbox errors vs tool failures must be distinguished
```

#### OpenCode Adapter
```go
func mapOpenCodeError(body []byte) *AgentHubError {
    var errResp struct {
        _tag   string `json:"_tag"`
        error  string `json:"error"`
        status int    `json:"status"`
    }
    json.Unmarshal(body, &errResp)
    switch errResp._tag {
    case "RateLimit":         return newError(ErrRateLimit, OriginSystem, true, ...)
    case "Authentication":    return newError(ErrAuthentication, OriginUserFixable, false, ...)
    case "Transport":         return newError(ErrTransport, OriginSystem, true, ...)
    case "ProviderInternal": return newError(ErrProviderInternal, OriginSystem, true, ...)
    case "InvalidRequest":    return newError(ErrInvalidRequest, OriginUserFixable, false, ...)
    case "QuotaExceeded":     return newError(ErrQuotaExceeded, OriginUserFixable, false, ...)
    case "ContentPolicy":     return newError(ErrContentPolicy, OriginUserFixable, false, ...)
    case "NoRoute":           return newError(ErrNoRoute, OriginSystem, false, ...)
    case "InvalidProviderOutput": return newError(ErrInvalidProviderOutput, OriginAgentInternal, false, ...)
    case "UnknownProvider":   return newError(ErrUnknownProvider, OriginSystem, false, ...)
    }
}
```

### 4.3 MCP Connection Errors (from opencode.md Section 4)

MCP server status is a 5-state discriminated union. AgentHub maps these to `AgentHubError`:

| MCP Status | ErrorCode | Severity | Retryable | UX |
|-----------|-----------|----------|-----------|-----|
| `connected` | -- | -- | -- | Green badge in MCP settings |
| `disabled` | -- | -- | -- | Gray badge, user intentionally off |
| `failed` | `mcp_connection_failed` | error | true | Red badge + [Reconnect] button + error detail |
| `needs_auth` | `authentication` | warning | false (needs OAuth) | Yellow badge + [Authenticate] button |
| `needs_client_registration` | `mcp_connection_failed` | error | true | Red badge + detail + [Retry Registration] |

### 4.4 Tool Execution Error Flow (PolicyEngine + SecurityPipeline)

```
ToolCall arrives at Runner
  │
  ├── SecurityPipeline.Evaluate(command)
  │     ├── ControlCharRe match? → DENY (SeverityBlock, no user prompt)
  │     ├── Misparsing violation? → ErrSecurityWarning (SeverityHigh)
  │     │     └── UI: ApprovalCard "Brace expansion obfuscation detected"
  │     │         Actions: [Approve Once] only (no allowlist override)
  │     └── Non-misparsing violation? → ErrSecurityNotice (SeverityLow/Medium)
  │           └── UI: ApprovalCard with [Approve Once] [Always Allow]
  │
  ├── PolicyEngine.Evaluate(toolCall, evalCtx)
  │     ├── bypassPermissions mode → auto-allow (read-only path still checked)
  │     ├── plan mode + write tool → DENY
  │     ├── Rule match (allow) → auto-allow
  │     ├── Rule match (deny) → ErrToolDenied
  │     ├── HighRiskPattern match + AutoDeny → ErrToolDenied
  │     └── No match → default (based on ToolDescriptor.riskLevel)
  │
  ├── ToolExecutor.runWithTimeout(call, cfg)
  │     ├── progress timer (2s) → emit ToolProgress event
  │     ├── blocking budget (15s) → auto-background
  │     │     └── UI: ToolUseCard shows "Running in background..."
  │     ├── default timeout (120s) → ErrToolTimeout
  │     └── execute → ToolResult (success or is_error)
  │
  └── Result emitted to AgentEvent stream
```

### 4.5 UI State Machine: Error Lifecycle

```
          ┌────────────────────────────────────────────┐
          │                 NORMAL                       │
          │  (streaming, idle, awaiting input)           │
          └──────┬──────────┬──────────┬────────────────┘
                 │          │          │
          error  │   warning│   info   │
          occurs │   event  │   event  │
                 ▼          ▼          ▼
        ┌───────────┐ ┌─────────┐ ┌─────────┐
        │ ERROR     │ │ WARNING │ │ INFO    │
        │ (inline   │ │ (toast  │ │ (toast  │
        │  card)    │ │  + dot) │ │  4s)    │
        └─────┬─────┘ └────┬────┘ └────┬────┘
              │            │           │
    ┌─────────┼────────┐   │           │
    │         │        │   │           │
    ▼         ▼        ▼   ▼           ▼
┌────────┐ ┌──────┐ ┌──────┐     auto-dismiss
│RETRYING│ │FIXED │ │GIVING│
│(spinner│ │(green│ │ UP   │
│+toast) │ │flash)│ │(gray)│
└───┬────┘ └──┬───┘ └──────┘
    │         │
    │ success │
    └────┬────┘
         ▼
      NORMAL
```

### 4.6 Store Integration Summary

| Store | Error-Related Fields | Events Updated By |
|-------|---------------------|-------------------|
| `runStore` | `runStatus`, `runError` on `failRun()` | `run.failed` WS event |
| `threadStore` | `ToolResult.is_error`, `messageCache` error messages | `run.item` (tool_result) WS event |
| `approvalStore` | `pendingApprovals`, `approvalHistory` with deny reason | `permission.requested` / `permission.resolved` |
| `connectionStore` | `edgeStatus`, `lastError`, `reconnectAttempt` | `edge.connection_status` / `edge.pong` |
| `diffStore` | `diffError: DiffError`, `commitError`, push/pull errors | REST responses + local git |
| `projectStore` | `projectError` | Failed project load |
| `previewStore` | (implicit: artifact load failure) | `artifact.created` / load failure |
| `pluginStore` | Plugin `status: "error"`, `error` string | Plugin load/install failure |
| `searchStore` | (implicit: FTS5 query failure → toast) | Search API error |
| `uiStore` | (ToastContainer renders from any store's error side-effects) | Cross-store |

---

## 5. Design Decisions & Principles

1. **Single error type**: `AgentHubError` flows through all layers. No per-layer error structs -- the UI should not need to know which layer produced the error to render it correctly. The `Origin` and `Source` fields are for logging/debugging.

2. **Retry is a first-class field**: `Retryable` boolean + optional `RetryAction` struct (label, endpoint, params) means the UI can render retry buttons generically without adapter-specific knowledge.

3. **Security violations are errors, not a separate system**: A security block is just an error with `Origin=AgentInternal, Severity=Block, Retryable=false`. The ApprovalCard component handles the UX difference.

4. **Toast for transient, Card for persistent**: Channel selection is driven by Severity and Retryability, not by error origin. A transient transport error should be a toast; a persistent auth error should be an inline card.

5. **Connection state is ambient, not an event**: The connection dot is always visible and reflects the last known state. Disconnects produce a toast on transition but the dot is the SSOT. This avoids error-card spam during flaky connections.

6. **Optimistic send with rollback**: User messages appear immediately. Only on confirmed failure does the UI show an error state. This is the same pattern as DiffCard's optimistic apply→undo window.

7. **Error aggregation for batch tools**: When multiple concurrent tools fail (ToolRuntime concurrency=10), errors are collected and rendered as a single `ToolUseSummary` card with per-tool error details, not as 10 separate error cards.

---

## A. References

- `opencode.md` Section 3.5 -- `LLMErrorReason` 10-variant discriminated union
- `opencode.md` Section 3.6 -- `RouteExecutor` retry: exponential backoff, 2 retries, 500ms base, 10s cap
- `opencode.md` Section 4 -- MCP `Status` 5-state discriminated union
- `cross-analysis-adapters.md` Section 3 -- Per-agent workarounds (8 per adapter), error mapping
- `cross-analysis-adapters.md` Section 2 -- `ResultPayload` subtypes (5 error variants)
- `design-desktop-ux.md` Section 3.2 -- DiffCard display/apply/discard state machine
- `design-desktop-ux.md` Section 2.2.7 -- `uiStore` ToastContainer
- `design-desktop-ux.md` Section 2.2.8 -- `connectionStore` edgeStatus + reconnect
- `design-desktop-ux.md` Section 2.2.4 -- `diffStore` DiffError/CommitError/PushError enums
- `design-desktop-ux.md` Section 4.4-4.5 -- Mobile adaptation: bottom sheet + offline indicator
- `deep-dive-claude-code-tool-security.md` Section 3.1 -- `SecurityViolation` struct + Severity tiers
- `deep-dive-claude-code-tool-security.md` Section 3.3 -- `SecurityPipeline` misparsing vs non-misparsing gate
- `deep-dive-claude-code-tool-security.md` Section 5 -- `PolicyEngine.Evaluate()` decision flow
