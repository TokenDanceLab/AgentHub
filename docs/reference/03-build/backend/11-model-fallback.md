# Design: Model Fallback & Provider Degradation

> Generated: 2026-05-21
> Sources: opencode.md, kanna.md, librechat.md, cross-analysis-adapters.md
> Scope: AgentHub ModelRouter — automatic model switching and provider-level degradation

## 1. Landscape: What the Four Systems Do Today

### 1.1 Summary Table

| System | Model Fallback Chain | Error Retry | Provider Degradation | Unknown Provider Fallback |
|--------|---------------------|-------------|---------------------|--------------------------|
| **OpenCode** | None — same model retry only | RouteExecutor: exp backoff + jitter, max 2 retries, 500ms base / 10s cap | None — 12 routes are independent, no degradation chain | None — must register a provider explicitly |
| **Kanna** | None — manual UX toggle only | None — delegates to CC/Codex SDK | Two providers (Claude/Codex), manual switch | N/A — only two providers |
| **LibreChat** | None — agent-level model config only | None — delegates to LangChain SDK | Per-agent summarization provider is separate from chat provider | Yes — `initializeCustom` for any OpenAI-compatible endpoint |
| **AgentHub (target)** | **To design** | **To design** | **To design** | **To design** |

### 1.2 OpenCode: Error-Aware, Model-Unaware Retry

OpenCode's `RouteExecutor` (`llm/src/route/executor.ts:334-353`) has the most sophisticated error classification of the four systems:

- **10-variant error discriminated union**: `InvalidRequest | NoRoute | Authentication | RateLimit | QuotaExceeded | ContentPolicy | ProviderInternal | Transport | InvalidProviderOutput | UnknownProvider`
- **`retryable` getter**: Only `RateLimit` and `ProviderInternal` (500/503/504/529) are retryable; everything else fails immediately
- **Retry mechanics**: Exponential backoff + jitter, max 2 retries, base delay 500ms, cap 10000ms
- **Limitation**: Retries hit the **same route** — no alternate model or alternate provider is attempted

### 1.3 Kanna: UX-Exposed Provider Catalog

Kanna's `provider-catalog.ts` models a **three-layer resolution chain**:

```
Provider → Model → Effort
```

Each layer has defaults, but there is **no automatic fallback** when a model call fails. The user manually switches providers (Claude/Codex tabs in `ChatPreferenceControls`). The provider selector is **locked during active turns** to prevent mid-stream mutation.

### 1.4 LibreChat: Adapter Dispatcher with Custom Endpoint Gate

LibreChat's `providerConfigMap` dispatches to known adapters (`anthropic → initializeAnthropic`, `google → initializeGoogle`, etc.). The key insight: **unknown providers fall back to `initializeCustom`**, which treats any endpoint as OpenAI-compatible by looking up `getCustomEndpointConfig` from YAML/DB.

This is the only system with a **provider-level degradation path**, but it is a compile-time dispatch, not a runtime fallback — it chooses the adapter at config time, not when a call fails.

---

## 2. Design Principles for AgentHub ModelRouter

1. **Error classification drives routing decisions** — Not all errors are equal. Rate limits should retry on a different model; auth errors should never retry.
2. **Model fallback is a chain, not a retry** — When model A fails with a non-retryable error, try model B, not model A again.
3. **Provider degradation is explicit and configurable** — Provider-level failover crosses billing domains, so it must be opt-in.
4. **Fallback decisions are observable** — Every switch must emit an event so the user/UI knows which model actually served the request.
5. **Circuit breaking prevents cascading waste** — A model that just returned 429 should not be retried for N seconds.

---

## 3. ModelRouter Architecture

### 3.1 Error Classification (Inherited from OpenCode)

```
                    ┌─────────────────────────┐
                    │     LLM Call Fails      │
                    └───────────┬─────────────┘
                                │
                    ┌───────────▼─────────────┐
                    │  Classify Error by _tag  │
                    └───────────┬─────────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          │                     │                     │
  ┌───────▼───────┐   ┌────────▼────────┐   ┌────────▼────────┐
  │  Retryable    │   │  Fallbackable   │   │  Terminal       │
  │  (same model) │   │  (next model)   │   │  (fail request) │
  ├───────────────┤   ├─────────────────┤   ├─────────────────┤
  │ RateLimit     │   │ QuotaExceeded   │   │ Authentication  │
  │ ProviderInternal│  │ NoRoute         │   │ InvalidRequest  │
  │ Transport?    │   │ ContentPolicy    │   │ UnknownProvider │
  │               │   │ InvalidOutput    │   │                 │
  └───────┬───────┘   └────────┬────────┘   └────────┬────────┘
          │                    │                     │
          ▼                    ▼                     ▼
   Retry N times        Advance to next       Return error
   on same model        model in chain        to caller
```

**`Transport`** (network/timeout) is conditionally retryable: retry on same model once, then treat as fallbackable if it persists.

### 3.2 Model Fallback Chain

```go
// ModelFallbackChain is an ordered list of model entries.
// The router tries each entry in sequence until one succeeds.
type ModelFallbackChain struct {
    Name     string             // e.g., "production", "budget"
    Strategy FallbackStrategy   // "sequential" | "parallel_hedge" | "cost_ascending"
    Entries  []ModelChainEntry
}

type ModelChainEntry struct {
    ModelID      string           // e.g., "claude-sonnet-4-6"
    ProviderID   string           // e.g., "anthropic"
    Role         ChainRole        // "primary" | "secondary" | "fallback"
    RetryConfig  *RetryConfig     // Overrides per-entry
}

type ChainRole string
const (
    RolePrimary   ChainRole = "primary"   // User's preferred model
    RoleSecondary ChainRole = "secondary" // First fallback
    RoleFallback  ChainRole = "fallback"  // Last resort
)
```

### 3.3 Provider Degradation Chain

Provider degradation is a **separate concern** from model fallback. A provider is an authentication + billing domain; switching providers mid-request has cost implications.

```go
type ProviderDegradationPolicy struct {
    Enabled      bool
    SameProviderOnly bool  // If true, never cross provider boundaries
    AllowedTransitions []ProviderTransition
}

type ProviderTransition struct {
    From ProviderID
    To   ProviderID
    MaxBudgetUSD float64  // Cap on failover spend (0 = unlimited)
}
```

**Default policy**: `SameProviderOnly = true`. Cross-provider fallback requires explicit admin configuration. This prevents surprise bills from e.g., Anthropic → Google failover.

### 3.4 Circuit Breaker

```go
type CircuitBreaker struct {
    FailThreshold   int           // Consecutive failures to open circuit (default: 3)
    CooldownPeriod  time.Duration // Time before half-open probe (default: 30s)
    HalfOpenMaxReqs int           // Probe requests allowed in half-open (default: 1)
}

type ModelCircuitState struct {
    ModelID       string
    State         CircuitState  // "closed" | "open" | "half_open"
    FailCount     int
    LastFailTime  time.Time
    LastFailReason string
}
```

The circuit breaker is **per (ModelID, ProviderID)**. A model that returns 429 goes into open state and is skipped during fallback chain traversal until the cooldown expires.

### 3.5 Router Execution Flow

```
Request arrives with:
  - fallbackChainID: "production"  (or nil = no fallback)
  - activeCircuitBreakers: map[ModelID]CircuitState
  ──────────────────────────────────────────────────────
  for each entry in chain:
    1. Check circuit breaker for (entry.ModelID, entry.ProviderID)
       - OPEN: skip, emit EventFallbackSkipped
       - HALF_OPEN + quota exhausted: skip
       - CLOSED or HALF_OPEN + probe available: proceed
    2. Execute LLM call
    3. On success:
       - Close circuit breaker
       - Emit EventModelRouted(modelID, providerID, role)
       - Return response
    4. On retryable error:
       - Retry on same entry up to RetryConfig.MaxRetries
       - On exhaustion: advance to next chain entry
    5. On fallbackable error:
       - Open circuit breaker for this entry
       - Emit EventFallbackTriggered(fromModel, toModel, reason)
       - Advance to next chain entry
    6. On terminal error:
       - Abort chain, return error
  ──────────────────────────────────────────────────────
  Chain exhausted:
    - Return ErrAllModelsExhausted{ChainName, triedModels[]}
```

### 3.6 Router Events

```go
// Emitted when fallback is triggered
type FallbackTriggeredEvent struct {
    FromModel    string
    FromProvider string
    ToModel      string
    ToProvider   string
    Reason       string   // e.g., "QuotaExceeded", "RateLimit", "Transport"
    ChainName    string
    Step         int      // Position in chain
}

// Emitted when the final model is selected
type ModelRoutedEvent struct {
    ModelID     string
    ProviderID  string
    Role        ChainRole
    ChainStep   int
    TotalTries  int
}

// Emitted when a model is skipped by circuit breaker
type FallbackSkippedEvent struct {
    ModelID    string
    Reason     string   // "circuit_open"
    CooldownRemaining time.Duration
}
```

---

## 4. Pre-configured Fallback Chains

### 4.1 Anthropic-only (SameProviderOnly, recommended default)

```
primary:   claude-sonnet-4-6   (anthropic)
secondary: claude-sonnet-4-5   (anthropic)
fallback:  claude-haiku-4-5    (anthropic)
```

All models share the same API key and billing. No surprise costs. Ideal for AgentHub's default configuration.

### 4.2 Cross-provider (explicit opt-in)

```
primary:   claude-sonnet-4-6   (anthropic)
secondary: gpt-5               (openai)
fallback:  gemini-2.5-pro      (google)
```

Requires admin approval + `ProviderDegradationPolicy.AllowedTransitions` entries. Each transition can have a `MaxBudgetUSD` cap.

### 4.3 OpenRouter Proxy Chain

```
primary:   claude-sonnet-4-6   (openrouter)
secondary: claude-sonnet-4-6   (anthropic-direct)
```

OpenRouter as a front proxy, fall back to direct API if OpenRouter is down. Useful for teams that use OpenRouter for cost aggregation but want a direct-path safety net.

---

## 5. Integration with AgentHub Adapter

### 5.1 Adapter Responsibility

The adapter layer (`cross-analysis-adapters.md` Section 2) owns **transport-level retry** (e.g., spawning a subprocess, reconnecting HTTP). The ModelRouter layer owns **model-level fallback** (switching to a different model ID).

| Layer | Owns | Retry Scope |
|-------|------|-------------|
| Adapter transport | Network errors, process crashes | Same model, same provider |
| ModelRouter | Model unavailability, quota, rate limit | Different model, same or different provider |

### 5.2 Adapter Contract Change

The `StartRequest` (cross-analysis-adapters.md Section 2.2) gains a `FallbackChainID` field:

```go
type StartRequest struct {
    // ... existing fields ...
    FallbackChainID string  // "" = no fallback, "production" = use named chain
    FallbackChain   *ModelFallbackChain  // Inline override, takes precedence over named chain
}
```

The adapter calls `ModelRouter.Execute(ctx, req, chain)` instead of calling the LLM directly. The router handles chain traversal and returns either a successful response or `ErrAllModelsExhausted`.

---

## 6. What AgentHub Should NOT Do

| Anti-pattern | Why |
|-------------|-----|
| Retry on auth errors | 401/403 never self-resolve; retrying wastes quota and delays error propagation |
| Silent fallback | Every model switch must emit an event visible to the user/UI |
| Cross-provider by default | Different providers = different billing; must be explicit opt-in |
| Infinite retry | OpenCode's max-2-retries is a good cap; AgentHub should use 3 with circuit breaker |
| Fallback to weaker model without downgrade notice | If the chain falls back to haiku, the UI should indicate reduced capability |

---

## 7. Implementation Phasing

| Phase | Deliverable | Depends On |
|-------|------------|------------|
| P0 | Error classification (10-variant discriminated union → Go) | opencode.md §3.5 |
| P0 | ModelFallbackChain data model + sequential traversal | This document §3.2 |
| P0 | Integration into ClaudeCodeAdapter.Start() | cross-analysis-adapters.md §2.2 |
| P1 | Circuit breaker per (ModelID, ProviderID) | P0 |
| P1 | Fallback events (FallbackTriggered, ModelRouted, FallbackSkipped) | P0 |
| P1 | ProviderDegradationPolicy (cross-provider opt-in) | P0 |
| P2 | Parallel hedge strategy (race primary + secondary, use first success) | P1 |
| P2 | Cost-ascending auto-chain (sort by $/1M tokens) | P1 |
| P2 | Dynamic chain builder from agent capabilities (match tool support) | P1 |

---

## 8. Key Design Decisions

1. **Separate error classification from routing**: OpenCode's 10-variant error model is rich enough to drive routing decisions. AgentHub should adopt it directly rather than invent a new taxonomy.

2. **Chain is explicit, not derived**: The user/admin configures fallback chains. AgentHub does not auto-derive chains from model capabilities. This avoids surprises where the router silently picks a model that lacks tool calling or has a different context window.

3. **Circuit breaker is essential, not optional**: Without it, a rate-limited model clogs the chain — every request probes it, incurs latency, then falls through. A 30-second cooldown after 3 consecutive failures is a safe default.

4. **SameProviderOnly by default**: LibreChat's `initializeCustom` pattern (unknown → OpenAI-compatible) is clever for config-time dispatch, but runtime cross-provider fallback crosses billing boundaries. AgentHub must be conservative.

5. **Events are first-class**: Kanna's snapshot broadcast model and LibreChat's MCP event flow both emit structured events for every state change. AgentHub's fallback events follow the same principle — the UI must know which model served the request.

---

*Design complete. 2026-05-21.*
