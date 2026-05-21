# AgentHub Concurrency & Rate Limiting Design

> Date: 2026-05-21
> Sources: deep-dive-claude-code-tool-security.md, codex-cli.md, librechat.md, flowise.md, design-observability.md
> Target: AgentHub Runner executor + Hub scheduling layer

---

## 1. Overview

AgentHub sits at the intersection of three concurrency domains: **(a)** tool execution within a single agent turn, **(b)** multi-agent spawn/subtask fan-out, and **(c)** cross-tenant Hub scheduling. Each domain has different safety properties, resource footprints, and fairness requirements. This document compares concurrency and rate-limiting strategies observed across Claude Code, Codex CLI, LibreChat, and Flowise, then derives AgentHub's design.

---

## 2. Concurrency Models: Cross-System Comparison

### 2.1 Summary Table

| System | Concurrency Primitive | Partition Strategy | Cap | Context Safety |
|--------|----------------------|-------------------|:---:|---------------|
| **Claude Code** | TypeScript `all()` bounded async generator | Adjacent read-only tools merged into one concurrent batch; write tools split into serial batches | 10 | Serial: immediate. Concurrent: queued modifiers after batch completes |
| **Codex CLI** | Rust `tokio` async tasks + ThreadManagerState | Agent tree spawn/wait; each agent runs in its own thread with SQ/EQ channel | `agent_max_threads` + `agent_max_depth` | Agent isolation via ThreadId per agent; Session shared across tree |
| **LibreChat** | LangGraph `StateGraph` + recursive `buildSubagentConfigs` | Recursive subagent fan-out with cycle detection via `ancestors` Set | `MAX_SUBAGENT_DEPTH` + `MAX_SUBAGENT_RUN_CONFIGS` | ToolRegistry deep clone per subagent; `initialSummary = undefined` |
| **Flowise Seq** | LangGraph `StateGraph` DAG executor | DAG nodes managed by LangGraph internal scheduler; `recursionLimit` = 100 | Implicit via topology + `recursionLimit` | `BaseCheckpointSaver` across nodes |
| **Flowise Sup** | Single Supervisor + N Worker fan-out | Supervisor routes one Worker per turn via function-calling | N/A (one active at a time) | Workers inherit Supervisor's LLM |

### 2.2 Model Analysis

**Claude Code's Partition-First model (goroutine/subprocess pool equivalent):**
The key insight is **adjacency-based batching**: three read-only tools in sequence merge into one concurrent batch; a write tool between them splits into three batches. This is a domain-aware partitioner, not a generic thread pool. The `isConcurrencySafe()` per-tool declaration is the source of truth. Conservative default: parse failure or unknown tool = serial.

**Codex CLI's Agent Tree model (thread pool):**
Each spawned agent is an independent async task with its own `ThreadId`. The control plane (`AgentControl`) enforces `agent_max_threads` (max concurrent) and `agent_max_depth` (max tree depth). The SQ/EQ pattern decouples parent turn loop from child execution. Spawn limits are checked before thread creation.

**LibreChat's Recursive Fan-Out (async task with depth guard):**
`buildSubagentConfigs()` recursively expands subagent definitions with an `ancestors` Set for cycle detection. `MAX_SUBAGENT_DEPTH` and `MAX_SUBAGENT_RUN_CONFIGS` are **configuration-time** limits, not runtime concurrency caps.

**Flowise's DAG model (graph-based execution):**
LangGraph's internal executor handles concurrency implicitly from graph topology. `recursionLimit` prevents infinite loops but is not a concurrency cap.

### 2.3 AgentHub Positioning

AgentHub's Runner runs **subprocess-based** agent CLIs (Claude Code, Codex, etc.). This differs fundamentally from in-process async tasks:
- Each agent turn is a **subprocess invocation** with its own OS-level footprint (memory, FDs, CPU)
- Tool execution within a turn is handled by the agent CLI's own orchestrator
- AgentHub's concurrency concern is: **how many subprocesses to run per Edge, and how to schedule across tenants**

---

## 3. Rate Limiting Strategies: Cross-System Comparison

### 3.1 Summary Table

| Strategy | Used By | Mechanism | Backpressure | Fairness |
|----------|---------|-----------|-------------|----------|
| **Semaphore** (concurrency cap) | Claude Code (10), Codex (`agent_max_threads`) | Fixed-size permit pool | Blocks caller | FIFO |
| **Depth guard** | LibreChat (`MAX_SUBAGENT_DEPTH`), Codex (`agent_max_depth`) | Config-time validation; reject if exceeded | Immediate reject | N/A |
| **Queue depth + timeout** | Claude Code (120s/600s, 15s auto-bg) | Deadline + backgrounding after budget | Timeout kill; background yields | Per-command |
| **Recursion limit** | Flowise (`recursionLimit = 100`) | Node counter; abort when exceeded | Immediate abort | Per-graph |
| **Budget-based blocking** | AgentHub (design-observability.md) | `spentUSD / limitUSD` gate before run | Hard reject | Per-scope |
| **Heartbeat deadman** | AgentHub (design-observability.md) | 60s no heartbeat -> remove from scheduling | Evict stale capacity | Edge-level |

### 3.2 Strategy Analysis

**Token Bucket** and **Sliding Window** were NOT observed in any of the four systems for tool execution. These are API-level rate limiters. AgentHub needs token bucket only at the **model API gateway layer**, not at Runner scheduling.

**Semaphore** is universal: Claude Code caps at 10, Codex at `agent_max_threads`. Both are simple permit pools with no rate smoothing, priority queuing, or dynamic adjustment.

**Queue Depth** is implicit: Claude Code's `all()` generator queues the 11th tool when 10 are running. Codex's spawn slot reservation similarly blocks when at capacity.

### 3.3 What AgentHub Needs That Existing Systems Don't Provide

1. **Cross-tenant fairness**: Hub runs from multiple users/projects. One heavy user must not starve others.
2. **Edge capacity awareness**: Scheduling must account for reported CPU/memory/disk, not just concurrency caps.
3. **Priority preemption**: Critical runs (admin, incident response) jump the queue.
4. **Cost-based backpressure**: Budget exceeded = block, not just warn (partially covered in design-observability.md).

---

## 4. AgentHub Runner Concurrency Strategy

### 4.1 Design Principles

1. **Delegate tool-level concurrency to the agent CLI.** AgentHub must not re-implement Claude Code's partitioner or Codex's agent tree. The Runner launches subprocesses; the subprocess manages its own internal concurrency.
2. **Runner-level concurrency = subprocess pool.** Fixed-size slot pool. Each slot = one agent turn subprocess.
3. **Hub-level scheduling = capacity-aware dispatch.** Hub tracks each Edge's available slots, routes to least-loaded Edge.
4. **Budget is a hard gate.** `BudgetTracker.CheckAndRecord()` fails -> refuse with `error_max_budget_usd`.

### 4.2 Subprocess Pool (Runner Side)

```
Runner: SubprocessPool
  maxSlots: 4 (configurable)
  slotTimeout: 600s (hard kill, matches Claude Code getMaxTimeoutMs)
  gracefulTimeout: 30s (SIGTERM before SIGKILL)
```

```go
type SubprocessPool struct {
    sem             chan struct{}  // semaphore, cap = maxSlots
    maxSlots        int
    slotTimeout     time.Duration
    gracefulTimeout time.Duration
}
// Acquire() blocks until slot free; Release() frees slot.
// Available() = maxSlots - len(sem) returns free count.
```

**Slot allocation**: FIFO within Runner. No priority (priority is a Hub concern). When full, `Acquire` blocks. Hub must not dispatch to a full Runner.

### 4.3 Hub Scheduling (Capacity-Aware Dispatch)

```
Hub Dispatch:
  1. Budget gate -> exceeded? 402 refuse
  2. Edge selection: query online edges -> filter (slots > active) -> sort (fewest active first)
     -> no capacity? queue with priority
  3. Dispatch: POST /api/runs to selected Edge -> Runner.Acquire()
```

```go
type Scheduler struct {
    edges  EdgeRegistry
    budget *BudgetTracker
    queue  *PriorityQueue[RunRequest]
}

type RunRequest struct {
    RunID            string
    Priority         int    // 0=bg, 50=interactive, 100=admin
    BudgetScope      string
    EstimatedCostUSD float64
}
// Dispatch(): budget gate -> least-loaded edge -> fallback to queue
```

### 4.4 Priority Queue (Hub Side)

| Band | Value | Use Case |
|:---|:---:|---|
| `PriorityAdmin` | 100 | Admin override, incident response |
| `PriorityInteractive` | 50 | User-facing interactive sessions |
| `PriorityBatch` | 10 | Scheduled/batch jobs |
| `PriorityBackground` | 0 | Background analysis, pre-warming |

Priority matters only when queue is non-empty. With sufficient Edge capacity, all runs dispatch immediately.

### 4.5 Backpressure Flow

```
User submit -> Hub budget (exceeded -> 402)
            -> Hub find Edge (no capacity -> 202 queued)
            -> Edge find Runner (no slot -> re-dispatch)
            -> Runner Acquire (timeout -> 503)
            -> Subprocess (slotTimeout -> SIGTERM -> SIGKILL -> failed)
```

---

## 5. Multi-Agent Subprocess Fan-Out

### 5.1 Abstraction

AgentHub does NOT implement multi-agent spawning internally:
- Claude Code sub-agent (task tool) = internal CC mechanism. AgentHub sees one TurnResult.
- Codex sub-agent (spawn tool) = internal Codex mechanism. Same.
- **Hub-level parallel execution** (e.g. two agents on different Edges) = Conversation authority creates two RunRequests, dispatches concurrently.

### 5.2 Fan-Out Limits

| Limit | Value | Rationale |
|:---|---:|:---|
| Max parallel runs per Conversation | 6 | Matches Codex's 6 concurrent agent streams |
| Max parallel runs per User | 12 | Two concurrent Conversations x 6 |
| Max parallel runs per Edge | configured (default 4) | Hardware-dependent |
| Subprocess depth (agent-internal) | N/A | Delegated to agent CLI |

### 5.3 Deadlock Prevention

- **No cross-run dependencies**: each run is independent. AgentHub does not support "run B waits for run A."
- **Cycle detection**: not needed at Hub level. Sub-agent cycles handled by agent CLI (Codex's `ancestors` Set, LibreChat's cycle check).
- **Timeout deadman**: every run has 600s `slotTimeout`. Hung subprocesses are SIGKILL'd.

---

## 6. Observability Integration

### 6.1 Pool Metrics

```go
type PoolMetrics struct {
    ActiveSlots    atomic.Int64
    MaxSlots       int
    QueuedRuns     atomic.Int64  // Hub queue depth
    TotalTimedOut  atomic.Int64
}
```

### 6.2 Health Signals

- **Runner heartbeat** (10s): includes `AvailableSlots`, `ActiveRuns`
- **Edge heartbeat** (30s): aggregates all Runner pool stats
- **Hub** `/api/metrics`: queue depth, dispatch latency, slot utilization per Edge

### 6.3 Alert Thresholds

| Condition | Level | Action |
|---|---|---|
| Hub queue depth > 10 for > 60s | WARN | Consider adding Edge capacity |
| Edge slot utilization > 90% for > 5min | WARN | Pre-scale |
| Runner AvailableSlots == 0 for > 30s | INFO | Monitor for timeout cascades |
| Subprocess slotTimeout fired | ERROR | Investigate hung agent |

---

## 7. Decision Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Tool-level concurrency | Delegate to agent CLI | CC/Codex already partition; don't double-layer |
| Runner model | Semaphore-based subprocess pool | OS-level isolation; mirrors CC's semaphore pattern |
| Pool size | Configurable per Edge (default 4) | Hardware-dependent; 4 safe for 8GB Edge |
| Hub scheduling | Capacity-aware least-loaded dispatch | Avoids Edge overload; enables horizontal scaling |
| Queue model | Priority queue (4 bands) | Interactive > Batch > Background; admin override |
| Rate limiting | Budget gate + capacity gate | Cost/reliability are binding constraints for agents |
| Multi-agent fan-out | Hub-level parallel dispatch | Simple, predictable; agent-internal is CLI job |
| Subprocess timeout | 600s hard, 30s graceful | Matches CC `getMaxTimeoutMs()` = 600000 |
| Deadman switch | Runner 60s no heartbeat = offline | Prevents dispatch to dead Runners |

---

## 8. References

- `deep-dive-claude-code-tool-security.md` -- Tool partition model (Sec 1), timeout strategy (Sec 4)
- `codex-cli.md` -- Multi-agent spawn limits (Sec 2.4), SQ/EQ model (Sec 2.3)
- `librechat.md` -- Subagent depth/count limits (Sec 2.2), cycle detection (Sec 2.2)
- `flowise.md` -- Sequential Agents DAG model (Sec 2.2), recursionLimit (Sec 2.2)
- `design-observability.md` -- Budget tracking (Sec 4.3), heartbeat (Sec 3.4-3.5), metrics (Sec 2)
