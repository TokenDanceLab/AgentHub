# AgentHub Graceful Degradation & Resilience Strategy

> Synthesized from: `design-error-handling.md` (37 ErrorCode + retry), `design-observability.md` (health checks + heartbeats),
> `roadmap-research-to-implementation.md` (P0-P4 topology), `architecture.md` (Hub-Edge-Runner offline design)
> Date: 2026-05-21

---

## 1. Resilience Goals

AgentHub's Hub-Edge-Runner topology is designed for partial-connectivity operation. The guiding principle: **no single component failure should block local execution**.

| Goal | Target | Measured By |
|------|--------|-------------|
| Local execution availability | P0 Desktop mode works with Hub unreachable | `/readyz` on Edge returns "degraded" not "unavailable" |
| Graceful reconnect | All WebSocket connections auto-recover | Reconnect success rate within 30s |
| Data durability | No message loss on transient failures | EventStore write-chain + local SQLite |
| User awareness | Degradation visible but not blocking | Connection dot + inline banners, never modal for network issues |

---

## 2. Failure Modes & Degradation Behaviors

### 2.1 Hub Unavailability

Hub is the central IM server. It is **optional** for local execution.

| Affected Component | Behavior When Hub Offline | Recovery |
|--------------------|--------------------------|----------|
| **Edge -> Hub sync** | Sync pauses. Edge queues outbound events in `sync_outbox` (ring buffer, max 10K entries). | Replay in `seq` order on reconnect. Hub deduplicates by `(edge_id, seq)`. |
| **Cloud group chat** | Unavailable. Local-only conversations continue. UI banner: "Cloud chat unavailable". | Hub sends `conversation.snapshot` on reconnect. |
| **Friend list / contacts** | Read from Edge local cache. Cannot add/remove. | `contact.sync` full re-sync on reconnect. |
| **Mobile / Web client** | Full-screen "Connecting..." with retry button. Cannot reach Edge (P3 except same LAN). | Auto-reconnect: 1s, 2s, 4s, 8s, max 30s exponential backoff. |
| **Remote command relay** | Mobile cannot send commands. "Edge unreachable -- Hub offline" error. | Queued commands delivered on reconnect. |
| **Agent contact registry** | Read from cache. New registration deferred. | Re-sync on reconnect. |
| **Cloud artifact sync** | Artifacts stay local. No cross-device access. | Push on reconnect. |

**Edge local autonomy**: All P0 functions (local chat, @mention dispatch, Runner execution, Diff cards, workspace) operate normally without Hub. Edge `/readyz` returns `"degraded"` with `hub_connection: "degraded"` -- never `"unavailable"`.

### 2.2 Edge Unavailability

Edge is the local control node. Its failure is more severe than Hub failure for Desktop users.

| Affected Component | Behavior When Edge Offline | Recovery |
|--------------------|---------------------------|----------|
| **UI (Desktop)** | WS drops. Red connection dot + "Edge disconnected" banner. Runs show "reconnecting...". | Auto-reconnect: 1-30s backoff, infinite retries. On reconnect, Edge pushes full state snapshot. |
| **Runner processes** | Detect heartbeat loss (3 missed = 30s). Continue executing autonomously, buffer results locally. | Push buffered results on Edge reconnect. Edge reconstructs run state. |
| **Context building** | Unavailable for new dispatches. Active runs continue with built context. | Resume from last snapshot on Edge restart. |
| **Hub sync (remote)** | Hub detects heartbeat loss (3 missed = 90s), marks Edge `offline`. Mobile: "Desktop offline". | Hub marks `online` on next heartbeat. Mobile receives `edge.status_change`. |
| **Local SQLite** | WAL ensures crash safety. On restart, Edge replays WAL and reconstructs: conversations, runners, sync_outbox, ws_rooms. | Automatic on restart. |

### 2.3 Runner Crash / Unavailability

Runner is the Agent execution process manager. Failure is scoped to managed runs.

| Affected Component | Behavior When Runner Crashes | Recovery |
|--------------------|------------------------------|----------|
| **Active runs** | Agent subprocesses orphaned. Edge marks Runner unhealthy (30s) then offline (60s). Run status -> `failed` with `ErrRunnerUnavailable`. | Edge restart (max 3 attempts, 2s spacing). On restart: SIGTERM orphans, preserve checkpoints. |
| **Pending runs** | Queued in Edge. Not dispatched until Runner re-registers. | Auto-dispatched on reconnect. |
| **Workspace files** | Git worktrees intact on disk. Uncommitted changes may be lost if mid-write. | Validate via `git status`. Corrupted workspaces recreated from base commit. |
| **Diff generation** | In-progress diffs lost. Completed diffs in workspace survive. | Edge re-requests on run resume. |

**Runner restart protocol**: (1) Edge detects timeout. (2) Marks unhealthy, pushes status to UI. (3) Edge restarts Runner. (4) Runner loads checkpoint registry, SIGTERMs orphans. (5) Runner sends `runner.register` with `recovery: true`. (6) Edge replays last-known run states; Runner reconciles (completed report, in-progress resume from checkpoint). (7) Edge marks healthy.

### 2.4 SQLite Database Corruption / Lock

| Component | Corruption Behavior | Recovery |
|-----------|--------------------|----------|
| **Edge SQLite** | `integrity_check` fails on startup -> refuses to start, exits code 2. | Replace from backup, or rebuild from Hub sync. P0 offline: fresh DB (data loss accepted for dev). |
| **Edge SQLite locked** | Write contention retries with 50ms backoff (5 attempts). Persistent -> `ErrDatabaseLocked`. | WAL mode enables concurrent readers. `busy_timeout=5000` set. |
| **Runner SQLite** | Corruption on startup -> fresh DB. Lost checkpoints = runs restart from scratch. | Acceptable: Runner DB is cache-like. Source of truth is Edge EventStore. |
| **Hub SQLite** | SEVERE. Authority for accounts & cloud conversations. Full restore from backup. | Daily `VACUUM INTO 'backup.db'`. Restore latest + replay WAL. |

**Mandatory SQLite PRAGMAs (all services)**: `journal_mode=WAL`, `synchronous=NORMAL` (FULL for Hub), `foreign_keys=ON`, `busy_timeout=5000`, `integrity_check` on startup.

### 2.5 WebSocket Connection Failures

| Pair | Impact | Reconnect Strategy |
|------|--------|-------------------|
| **UI <-> Edge (localhost)** | UI loses real-time. Active runs invisible. Message send fails. | Backoff: 500ms, 1s, 2s, 4s, max 10s. Infinite retries. On reconnect: Edge pushes `edge.state_snapshot`. |
| **Edge <-> Hub (WAN)** | Cloud sync paused. Mobile unreachable. Local OK. | Backoff: 1s, 2s, 4s, 8s, max 30s. Infinite retries. Edge queues events. |
| **Runner -> Edge (localhost)** | New runs blocked. Active runs continue autonomously. | Heartbeat-based detection. Edge reconnects via local HTTP. |
| **Hub internal WS gateway** | Mobile/Web disconnect. Hub REST continues. | Ping/Pong 15s interval. 3 missed -> close, client reconnects. |

---

## 3. Function Degradation Matrix

What works when each component is unavailable:

| Function | Hub Offline | Edge Offline | Runner Offline | DB Corrupted |
|----------|:-----------:|:------------:|:--------------:|:------------:|
| Local chat (single & multi-agent) | Full | -- | -- | -- |
| Agent execution (CC/Codex/OpenCode) | Full | -- | -- | -- |
| Diff cards (display + apply/discard) | Full | -- | Read-only (cached) | -- |
| Workspace file browsing | Full | -- | Read-only (disk) | -- |
| Preview server | Full | -- | -- | -- |
| Security approval flow | Full | -- | -- | Read-only (cached rules) |
| Context building | Full | -- | -- | -- |
| Checkpoint create/restore | Full | -- | -- | -- |
| Cloud group chat | -- | Full | Full | -- |
| Mobile remote control | -- | -- | Full | -- |
| Cross-device artifact access | -- | Full | Full | -- |
| Friend/contact management | -- | Full | Full | -- |
| Budget tracking (cloud) | -- | Full | Full | -- |
| Cost aggregation (cross-Edge) | -- | See note | Full | -- |

Legend: **Full** = normal operation; **--** = unavailable; **Read-only** = existing data visible, no new writes.

---

## 4. Auto-Recovery Strategies

### 4.1 Reconnection Hierarchy

```
Tier 1: UI <-> Edge (localhost WS)     infinite retry,  500ms-10s backoff
Tier 2: Edge <-> Hub (WAN reverse WSS) infinite retry,    1s-30s backoff
Tier 3: Runner -> Edge (heartbeat)     restart after 60s,  max 3 attempts
Tier 4: Agent subprocess -> Runner     restart after crash, max 3 attempts, 2s spacing
```

### 4.2 Backoff Configuration

```go
// packages/resilience/backoff.go
type BackoffConfig struct {
    Initial, Max time.Duration; Multiplier, Jitter float64; MaxRetries int // -1 = infinite
}

var (
    UIBackoff          = BackoffConfig{500*time.Millisecond, 10*time.Second, 2.0, 0.1, -1}
    EdgeHubBackoff     = BackoffConfig{1*time.Second, 30*time.Second, 2.0, 0.2, -1}
    RunnerRestart      = BackoffConfig{2*time.Second, 10*time.Second, 1.5, 0.1, 3}
    LLMRetry           = BackoffConfig{500*time.Millisecond, 10*time.Second, 2.0, 0.1, 2}
)
```

### 4.3 State Reconciliation on Reconnect

**Edge -> Hub**: (1) Edge connects, sends `edge.register` with `last_seq`. (2) Hub computes diff: events with `seq > last_seq`. (3) Hub sends `sync.catchup` batches (max 500/batch). (4) Edge applies, updates cursor. (5) Edge flushes `sync_outbox` queue. (6) Hub deduplicates by `(edge_id, seq)`. (7) Steady-state streaming.

**UI -> Edge**: (1) UI sends `client.connect` with `last_event_id`. (2) Edge replays missed ServerEvents from EventStore. (3) Edge sends `edge.state_snapshot` (active runs, connections, runners). (4) UI reconstructs all store states. (5) Normal streaming.

**Runner -> Edge**: (1) Runner sends `runner.register` with `recovery: true` + active run IDs. (2) Edge compares with known state: completed runs report, orphans terminated. (3) In-progress runs: Edge sends `run.resume` with checkpoint ID. (4) Runner restores workspace, restarts Agent. (5) Stream from resume point.

### 4.4 Circuit Breaker (Remote Calls Only)

Three-state breaker (Closed -> Open -> HalfOpen) guards WAN/external calls:
- **Edge -> Hub** WebSocket connect (threshold: 5 failures, reset: 30s)
- **Edge -> external MCP server** connect
- **Hub -> external OAuth provider**

Not used for localhost connections (UI->Edge, Runner->Edge) -- those use simple retry with backoff.

---

## 5. User-Visible Degradation Indicators

### 5.1 Connection Status (Sidebar Footer, Always Visible)

```
Green  + "Local"           All local components healthy (P0, no Hub)
Green  + "Hub connected"   Hub connected (P1+)
Yellow + "Connecting..."   Reconnect attempt N in progress
Yellow + "Hub offline"     Hub unreachable, local OK
Red    + "Edge disconnected"  Local Edge unreachable, UI cannot function
Red banner (full-width)    "Runner crashed -- restarting..." (temporary, auto-resolves)
```

### 5.2 Degradation Banners (Contextual, Never Modal)

| Condition | Banner | Actions |
|-----------|--------|---------|
| Hub offline, local OK | "Cloud sync paused. Local execution unaffected." | [Dismiss] |
| Hub offline > 5min | "Hub unreachable for 5 min. Messages sync on reconnect." | [Dismiss] [Status] |
| Runner unhealthy | "Runner not responding. Active runs may be interrupted." | [View Runs] |
| Edge DB near capacity | "Local storage running low (85%)." | [Manage Storage] |
| Sync outbox near limit | "9,500/10,000 pending events. Connect to Hub soon." | [Connect Now] |

### 5.3 Run Status During Degradation

| Component State | Run Display | User Action |
|-----------------|-------------|-------------|
| All healthy | Normal streaming | Full control |
| Hub offline | Normal + "Offline" badge | Full local control |
| Edge reconnecting | "Reconnecting..." spinner | Cannot start new runs |
| Runner unhealthy | "Runner unavailable" + last output | Cancel run / wait |
| Runner restarting | "Restarting runner (attempt 2/3)..." | Wait or force cancel |
| Agent crashed | "Agent stopped unexpectedly" + detail | Retry from checkpoint / new run |

### 5.4 Toasts (4s Auto-Dismiss Unless Noted)

- "Hub connection lost -- retrying in 3s..." (warning, updates per retry)
- "Hub connection restored" (success, 3s)
- "Runner restarted successfully" (success, 3s)
- "Edge reconnected -- 12 events synced" (info, 4s)
- "Sync outbox at 80% capacity" (warning, 6s)
- "Agent process recovered from checkpoint" (info, 4s)

### 5.5 Mobile-Specific (P2+)

| State | Mobile Display |
|-------|---------------|
| Hub unreachable | Full-screen "No connection" + [Retry]. Cached conversations read-only. |
| Desktop Edge offline | "Desktop offline" badge. Input disabled, placeholder "Desktop is offline". |
| Both offline | Full-screen error. Only cached data. |

---

## 6. Implementation Checklist

**P0 (Now)**: UI-Edge WS auto-reconnect; Edge SQLite WAL + `busy_timeout` + `integrity_check` on startup; Runner heartbeat to Edge (10s); Edge RunnerManager: detect + auto-restart (max 3x); connection dot component (green/yellow/red).

**P1 (Strongly Recommended)**: Edge-Hub reverse WSS reconnect + sync replay; Edge `sync_outbox` table; Hub-side Edge offline detection (90s timeout); circuit breaker for Edge-Hub; degradation banners; daily `VACUUM INTO` backup for Edge + Hub.

**P2 (Enhanced)**: Mobile offline/online UX; Hub DB corruption auto-recovery; run recovery from checkpoint on Runner restart; resilience metrics (reconnect success rate, degradation duration histogram).

---

## 7. Design Decisions

1. **Hub is optional, not required**. P0 local execution must work without Hub. Edge `/readyz` returns `degraded` (not `unavailable`) when Hub is unreachable. This is the single most important resilience decision.

2. **Runners buffer autonomously**. When Edge is temporarily unreachable, Runners continue executing and buffer results to local EventStore. No work lost during brief Edge restarts or network flaps.

3. **WebSocket reconnect is infinite**. Unlike API call retries (max 2), WebSocket reconnection retries forever at 30s max interval. Connection downtime should never require manual user intervention.

4. **Degradation is ambient, not modal**. Connection issues show as banners and status dots, never blocking modals. The only blocking error is a completely crashed local Edge (app not running).

5. **SQLite WAL is mandatory everywhere**. Enables concurrent reads during writes and ensures crash safety without application-level locking. All services run `integrity_check` on startup and fail fast on corruption.

6. **Circuit breakers only for remote calls**. Localhost connections use simple retry. Circuit breakers guard only WAN/external calls where rapid retries waste resources.

7. **State reconciliation on every reconnect**. Full state replay (missed EventStore events + state snapshot) ensures UI and downstream components never have stale or inconsistent state after disconnection.

8. **No silent degradation**. Every component state change produces a toast + log event. Persistent states change the connection dot. Users always know system health.

---

## A. References

- `design-error-handling.md` -- Connection status (Sec 2.4), auto-retry patterns (Sec 3.2), layer responsibilities (Sec 4.1)
- `design-observability.md` -- Health checks (Sec 3), heartbeat intervals + offline thresholds (Sec 3.6)
- `roadmap-research-to-implementation.md` -- P0-P4 topology (Sec 1), offline-first P0 decision (Sec 4)
- `architecture.md` -- Hub optional / Edge autonomous / Runner execution-only principles, Authority Model, Data Ownership
