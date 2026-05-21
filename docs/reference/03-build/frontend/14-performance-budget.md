# AgentHub Performance Budget & Benchmark Metrics

> Date: 2026-05-21 | Scope: P0 desktop-only (Edge+Runner colocated on 127.0.0.1)
> Based on: design-observability.md, design-go-services.md, design-desktop-ux.md, design-micro-interactions.md, roadmap-research-to-implementation.md

---

## 1. Overview

P0 runs entirely on local loopback -- network latency is negligible. Performance bottlenecks are:
SQLite serial writes, React virtual list rendering, and subprocess startup.

| Constraint | Value | Rationale |
|-----------|-------|-----------|
| Budget scope | P0 desktop loopback | WAN/Hub latency not in P0 scope |
| Target hardware | 4+ cores, 16GB RAM, SSD | Developer laptop profile |
| Confidence level | P50 primary; P95 secondary | P50 is reliably reproducible; P95 varies with GC/OS |

---

## 2. P0 Performance Budgets

### 2.1 Frontend

| Metric | Budget | Measurement |
|--------|:------:|------------|
| FCP | < 600ms | `web-vitals` on initial load |
| TTI | < 1.2s | `web-vitals` after hydrate + store init |
| Thread switch latency | < 100ms | Click ThreadCard to first message visible |
| Message bubble render (single) | < 16ms | React Profiler per MessageNode mount |
| Message list scroll | 60fps (<16ms/frame) | 200-item virtual list scroll |
| Streaming text append | < 16ms/chunk | WS event to DOM update (16ms debounce coalescing, design-micro-interactions.md 6.5) |
| Global Search (Ctrl+K) | < 300ms | Debounce end to results render (P1) |
| DiffCard expand (L2) | < 200ms | max-height transition (P1) |

### 2.2 Backend (Go Services)

| Metric | P50 | P95 | Measurement |
|--------|:---:|:---:|------------|
| SQLite message INSERT | < 5ms | < 20ms | `DBWriteLatency` histogram |
| SQLite FTS5 search | < 10ms | < 25ms | `DBQueryLatency` histogram, 10K messages |
| SQLite SELECT history (50 rows) | < 3ms | < 10ms | Paginated message load |
| WS broadcast (room of 5) | < 5ms | -- | hub.Broadcast() to last SendCh append |
| WS ping/pong round-trip | < 2ms | -- | coder/websocket built-in, 15s interval |
| Agent subprocess start | < 200ms | < 500ms | Cmd.Start() to first stdout line |
| Git worktree add | < 100ms | < 300ms | Existing repo, local SSD |
| Edge `/healthz` | < 1ms | -- | Process-liveness only |
| Edge `/readyz` | < 100ms | -- | SQLite ping + local WS check |

### 2.3 AgentRun End-to-End Lifecycle

| Phase | Budget | Notes |
|-------|:------:|-------|
| User Enter to Edge WS receive | < 5ms | Loopback, negligible |
| Edge orchestrator dispatch | < 10ms | RouteMessage to POST /runs |
| Runner spawn agent subprocess | < 200ms | queueLatency histogram segment |
| First agent output to UI (E2E) | < 250ms | Enter key to first content_block_start visible |
| Tool result display | < 50ms | After agent stdout; ToolUseCard mount + ToolResult render |

---

## 3. Critical Path Metrics

### 3.1 Browser Timeline

```
TTI Budget (1200ms):
  0──FCP(600ms)──hydrate──store_init(900ms)──idle(1200ms)

Thread Switch (100ms budget):
  0──setActiveThread(10ms)──loadMessages(40ms)──virtual_mount(80ms)──paint(100ms)

Streaming (16ms/chunk):
  0──WS→store(2ms)──React_batch(14ms)──paint(16ms)
```

Key enablers:
- FCP < 600ms: code-split Monaco editor + lazy-load DiffViewer
- TTI < 1.2s: Zustand store init synchronous, must complete within 300ms post-hydrate
- Thread < 100ms: `@tanstack/react-virtual` with 3 overscan (design-desktop-ux.md 1)
- Streaming 16ms: coalesce debounce window (design-micro-interactions.md 6.5, Kanna pattern)

### 3.2 Message Bubble Render Budget

| Sub-component | Budget | Notes |
|--------------|:------:|-------|
| MessageHeader | < 2ms | Avatar + name + timestamp, pure presentational |
| TextContent (500 chars) | < 8ms | react-markdown + remark-gfm |
| ThinkingBlock (L1 collapsed) | < 1ms | Invisible content; toggle button only |
| ToolUseCard (L2 collapsed) | < 2ms | Header only (icon + toolName + param summary) |
| ToolResult (L2 expanded) | < 10ms | Diff/Bash/Read result decode + render |
| Subagent Sidechain (L3) | < 15ms | Recursive MessageNode, only when expanded |
| **Total L0 visible** | **< 12ms** | Header + TextContent |
| **Total L0+L1+L2 expanded** | **< 25ms** | Worst-case single-message expand |

Memo strategy: custom `areEqual` on MessageBubble (shallow compare id + content hash); no React `key` on streaming container; `useMemo` on markdown AST parse.

---

## 4. Go Service Benchmarks

### 4.1 SQLite (WAL mode, `?_busy_timeout=5000`, `SetMaxOpenConns(1)`)

| Operation | P50 | P95 |
|-----------|:---:|:---:|
| INSERT message | < 5ms | < 20ms |
| INSERT 100 batched | < 50ms | < 100ms |
| SELECT messages LIMIT 50 | < 3ms | < 10ms |
| FTS5 search (10K corpus) | < 10ms | < 25ms |
| UPDATE conversation | < 2ms | < 5ms |
| SELECT conversations (20) | < 2ms | < 5ms |
| Schema migration per step | < 500ms | < 1s |

### 4.2 WebSocket Hub (coder/websocket)

| Operation | P50 | Context |
|-----------|:---:|---------|
| Client register + room join | < 1ms | Channel send to hub.Register (buffer 256) |
| Broadcast 5 clients | < 5ms | Per-client SendCh append (buffer 64) |
| Broadcast 50 clients | < 20ms | Linear scaling |
| Write pump single send | < 1ms | conn.Write on loopback |
| Ping/pong RTT | < 2ms | 15s interval |
| Room cleanup | < 1ms | delete(h.rooms, roomID) |

### 4.3 Subprocess / Workspace

| Operation | P50 | P95 |
|-----------|:---:|:---:|
| git worktree add | < 100ms | < 300ms |
| Agent binary check | < 5ms | < 10ms |
| Agent start to first line | < 200ms | < 500ms |
| Agent graceful shutdown (SIGTERM) | < 2s | < 5s |
| Agent force kill (SIGKILL) | < 500ms | < 1s |
| Checkpoint SHA-256 + zstd | < 50ms | < 200ms |

---

## 5. Regression Detection Strategy

### 5.1 Pipeline

Go MetricsCollector (15s loop) exports to `/api/metrics` (Prometheus text format). Two consumers:
- **CI benchmark job**: `go test -bench . -count=5` + `benchstat` comparison against previous commit
- **Local dev**: `make bench-compare` for manual regression check before PR

### 5.2 CI Benchmarks (go test -bench)

```
BenchmarkSQLiteInsert          BenchmarkSQLiteInsertBatch100
BenchmarkSQLiteSelectHistory   BenchmarkSQLiteFTS5Search
BenchmarkWSBroadcast5          BenchmarkWSBroadcast50
BenchmarkWSRegister            BenchmarkGitWorktreeAdd
BenchmarkAgentStartup          BenchmarkMessageSerialize
BenchmarkAgentEventParse
```

### 5.3 Pass/Warn/Fail Thresholds

| Benchmark | Pass (P50) | Warn (P50) | Fail (P50) |
|-----------|:----------:|:----------:|:----------:|
| SQLite insert | < 5ms | 5-10ms | > 10ms |
| SQLite FTS5 search | < 10ms | 10-20ms | > 20ms |
| WS broadcast 5 clients | < 5ms | 5-10ms | > 10ms |
| Git worktree add | < 100ms | 100-200ms | > 200ms |
| Agent startup | < 200ms | 200-400ms | > 400ms |

`benchstat` detects significance at p < 0.05. Warn on >20% degradation; fail on >50%.

### 5.4 Frontend Regression

- **Vitest**: React Testing Library render budget assertions (MessageBubble < 12ms, expanded < 25ms)
- **Lighthouse CI**: FCP < 800ms (throttled), TTI < 1.5s, main chunk < 300KB gzipped
- **Runtime**: `/api/metrics` histogram comparison over rolling 5-min window

### 5.5 CI Failure Policy

- Warn: PR comment, non-blocking in P0 (becomes blocking at P1+)
- Fail: Block merge, require documented override reason
- Lighthouse FCP/TTI fail: Block merge for P0 pages

---

## 6. Observability Integration

Existing metrics (design-observability.md) directly support all budgets:

| Budget Metric | SystemMetrics Field | Type |
|--------------|---------------------|------|
| SQLite query latency | `DBQueryLatency` | Histogram (P50/P95/P99) |
| SQLite write latency | `DBWriteLatency` | Histogram |
| AgentRun queue latency | `QueueLatencyHist` | Histogram |
| AgentRun duration | `RunDurationHist` | Histogram (P50/P95/P99) |
| WS connections | `WSConnections` | Gauge (atomic.Int64) |
| Goroutine count | `Goroutines` | Gauge |
| Heap usage | `HeapInUseMB` | Gauge |

Health check budget bindings: `/readyz` SQLite < 10ms, Workspace < 50ms, WS ping < 2ms RTT.

---

## 7. Decision Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Budget scope | P0 desktop loopback only | WAN/Hub latency irrelevant |
| Measurement basis | P50 primary | P95 unstable on dev hardware |
| Frontend metrics | `web-vitals` + React Profiler | Standard, zero-config |
| Backend benchmarks | `go test -bench` + `benchstat` | No external deps |
| Regression detection | Statistical p < 0.05 | Avoids CI variance false positives |
| Histogram | Custom reservoir sampling (10K) | design-observability.md 6.3 |
| Alerting | Local dev only | P0 has no remote monitoring |
| CI blocking | Warn only in P0; block at P1+ | P0 is rapid iteration |
| Animation budget | Deferred to micro-interactions.md | CSS-only guardrails, separate concern |
