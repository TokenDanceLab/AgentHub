# AgentHub Performance Audit — 2026-06-10

> Scope: Backend Go code and frontend data-layer patterns only. No UI rendering analysis.
> Auditor: Automated static audit of hot paths, query patterns, and resource management.

---

## Executive Summary

The codebase is generally well-structured with proper indexes on critical paths (messages, sessions, session_members). SQLite WAL mode is enabled. WebSocket handling uses non-blocking channel sends. The main areas of concern are: (1) a write-amplification pattern in the Edge SQLite store where every state mutation triggers a full snapshot serialization, (2) aggressive frontend polling that should be replaced by WebSocket-driven invalidation, (3) a linear scan in the WS Manager SetAuth, and (4) missing pagination on session list endpoints.

---

## Findings

### HIGH Impact

#### H1. Edge SQLite: Full Snapshot Serialization on Every Write

**File:** `edge-server/internal/store/sqlite_store.go`
**Functions:** `persistAfterSQLiteWrite`, `syncPersist`, and all mutating methods (CreateRun, SetRunStatus, CreateItem, UpsertArtifact, ...)

**Problem:** Every single write operation (e.g., `SetRunStatus` called on every run state transition) calls `syncPersist()` which:
1. Takes a full in-memory snapshot via `s.store.snapshot()`
2. Marshals the **entire** snapshot to JSON
3. Begins a transaction, `DELETE`-s all rows from `agenthub_store_rows`, re-`INSERT`s everything, then rebuilds the entire relational projection

For a workspace with 50 runs and 500 items, a single status change serializes 500+ items and writes them all back. During active agent execution, `SetRunStatus` can be called multiple times per second (queued -> started -> finished), and `CreateItem` may be called for each transcript item.

**Evidence:**
- `sqlite_store.go:133` — `syncPersist` marshals full snapshot
- `sqlite_store.go:324` — `replaceSQLiteRows` does DELETE + bulk INSERT
- `sqlite_store.go:383` — `replaceSQLiteRelationalProjection` rebuilds all projections
- `sqlite_store.go:608` — `persistAfterSQLiteWrite` is called after every mutating operation

**Fix:** Replace full-snapshot persist with targeted row-level upsert. Only write the changed row kind (e.g., just the run row on `SetRunStatus`) instead of rewriting everything. Alternatively, batch writes with a debounce timer (e.g., 500ms) to coalesce rapid sequential mutations.

---

#### H2. Frontend: Aggressive 10-second Polling on Multiple Concurrent Queries

**Files:**
- `app/web/src/platform/useWebWorkbenchModel.ts:101` — sessions refetchInterval: 10_000
- `app/web/src/api/threadQueries.ts:26` — threads refetchInterval: 10_000
- `app/web/src/api/runQueries.ts:12` — runs refetchInterval: 10_000
- `app/web/src/api/agentQueries.ts:328` — agent tasks refetchInterval: 10_000
- `app/desktop/src/api/threadQueries.ts:24,36` — threads refetchInterval: 10_000
- `app/desktop/src/api/runQueries.ts:61` — runs refetchInterval: 10_000
- `app/desktop/src/api/teamRunQueries.ts:72` — team run state refetchInterval: 8_000

**Problem:** The web workbench opens ~10+ concurrent queries, many with `refetchInterval: 10_000` (10 seconds). Combined with the WebSocket already invalidating queries on real-time events (`webHubRealtime.ts:114`), this results in redundant double-fetching: both timer-triggered and WS-event-triggered refetches hit the server simultaneously.

The desktop workbench has the same pattern plus additional 10-second intervals on threads and run queries.

**Evidence:**
- `useWebWorkbenchModel.ts:97-103` — sessions query with 10s interval
- `useWebWorkbenchModel.ts:141-147` — messages with `staleTime: 5_000` (5s stale, then refetch on access)
- `useWebWorkbenchModel.ts:149-176` — 4 additional agent-task queries with 5s staleTime
- `webHubRealtime.ts:114` — WS events already invalidate the same `['web-v4', 'hub-sessions']` key

**Fix:** Remove `refetchInterval` from queries that already have WebSocket-driven invalidation. Keep `refetchInterval` only as a fallback for when WebSocket is disconnected. Increase `staleTime` to 30-60s since WS events invalidate immediately.

---

#### H3. Hub Session List: No Pagination, Full Table Scan Per User

**File:** `hub-server/internal/repository/session.go`
**Functions:** `ListUserSessions` (line 69), `ListWorkspaceSessions` (line 83)

**Problem:** Both functions return **all** sessions for a user with no pagination, limit, or cursor. The SQL uses a subquery `SELECT session_id, COUNT(*) as member_count FROM session_members WHERE left_at IS NULL GROUP BY session_id` that scans the entire `session_members` table on every call.

For a user with 100+ sessions (common after extended use), this generates a full scan each time the session list is loaded.

**Evidence:**
- `session.go:71` — subquery counting ALL session members globally
- `session.go:69` — `ListUserSessions` has no `LIMIT`
- `session.go:83` — `ListWorkspaceSessions` has no `LIMIT`

**Fix:**
1. Add `LIMIT` and cursor-based pagination (e.g., `WHERE COALESCE(s.last_message_at, s.created_at) < ? ORDER BY ... LIMIT 20`).
2. Replace the `LEFT JOIN (SELECT session_id, COUNT(*) ... GROUP BY session_id)` subquery with a pre-computed `member_count` column on the `sessions` table, or use a lateral join limited to the user's sessions.

---

### MEDIUM Impact

#### M1. Edge Process Executor: Repeated Mutex Lock/Unlock in Hot Path

**File:** `edge-server/internal/lifecycle/process_executor.go`

**Problem:** The `run()` method (line 355) and related methods (`fireHubStream`, `recordHubOutput`, `hubTaskID`, `finish`) acquire `e.mu.Lock()` multiple times per operation. During active streaming:
- `recordHubOutput` (line 1319) locks per chunk to look up `hubOutputs[runID]`
- `fireHubStream` (line 1357) calls `hubTaskID()` which locks, then spawns a goroutine per chunk
- Each goroutine in `fireHubStream` calls `e.hubCallback.TaskStream(...)` without batching

For a run producing rapid output, this creates many short-lived goroutines (one per `hubCallbackChunkMaxBytes` = 16KB chunk) each making an independent HTTP call.

**Evidence:**
- `process_executor.go:1319-1329` — lock per output chunk
- `process_executor.go:1365-1373` — one goroutine per chunk

**Fix:**
1. Cache `hubOutputs[runID]` in a local variable after initial lookup to avoid repeated locking.
2. Batch stream chunks into a single goroutine/call rather than spawning one per chunk.

---

#### M2. Hub WebSocket Manager: Linear Scan in SetAuth

**File:** `hub-server/internal/ws/manager.go:139-175`

**Problem:** `SetAuth` iterates all connections for a user to find existing same-device connections (`for _, existingCID := range m.byUser[userID]`). This is O(n) in the number of connections per user. While typically small, it's under a write lock that blocks all concurrent reads.

**Evidence:**
- `manager.go:152` — `for _, existingCID := range m.byUser[userID]` with full `m.mu.Lock()`

**Fix:** Add a secondary index `byUserDevice map[string]map[string]string` (key: `userID:deviceType:deviceID`) for O(1) lookup, or at minimum use `m.mu.RLock()` for the lookup phase and upgrade to write lock only for mutations.

---

#### M3. Hub Message Search: Full Table Scan Without Index on Content

**File:** `hub-server/internal/repository/message.go:188-205` (`SearchMessages`) and `message.go:207-235` (`SearchAllMessages`)

**Problem:** `SearchMessages` uses `ILIKE '%query%'` which cannot use B-tree indexes. While migration 0042 added a `tsvector` index for PostgreSQL full-text search, the ILIKE fallback is always executed alongside `plainto_tsquery`, meaning every search does both a full-text AND a pattern match scan.

`SearchAllMessages` joins `messages` with `session_members` and applies the same ILIKE condition. No `LIMIT` on `session_members` scan means it checks all user memberships first.

**Evidence:**
- `message.go:166-167` — `OR content->>'text' ILIKE ?` combined with tsquery
- `message.go:210-234` — `SearchAllMessages` raw SQL with ILIKE + join

**Fix:** Remove the ILIKE fallback when tsvector match succeeds (use `OR` only when tsquery returns 0 results in application code). For the global search, ensure the join is driven by an indexed `session_members` lookup (which it is via `(member_type, member_id)` index).

---

#### M4. Hub Auth Middleware: Dual JWT Parse on Every Request

**File:** `hub-server/internal/middleware/auth.go:80-109`

**Problem:** `validateToken` tries TokenDance ID RS256 JWT first (which involves JWKS fetch or cached key lookup + RSA signature verification), and only if that fails, falls through to local HS256 JWT parsing. Since most API calls use local Hub sessions (the common case), every request pays the cost of a failed RS256 attempt first.

**Evidence:**
- `auth.go:82-90` — always tries TokenDance ID JWT first even for Hub-local sessions

**Fix:** Add a prefix check: if the token starts with a recognizable pattern (e.g., Hub tokens have a specific structure), skip the TokenDance ID attempt. Alternatively, cache the last failed attempt or use a token-type hint in the header.

---

#### M5. Edge Server: No Read Timeout on WebSocket (Infinite Block)

**File:** `edge-server/internal/httpserver/server.go:155-157`

**Problem:** `WriteTimeout: 0` is correctly set for WebSocket, but `ReadTimeout: 15 * time.Second` applies to the initial WebSocket upgrade request. After upgrade, the Edge SSE/WebSocket event stream (`/v1/events`) depends on `restTimeoutMiddleware` which skips WebSocket upgrades. This is fine, but the Edge server has no max connection lifetime or idle timeout for long-lived event stream connections. A stuck client could hold a connection indefinitely.

**Evidence:**
- `server.go:155` — `ReadTimeout: 15 * time.Second` only covers initial request
- `server.go:156` — `WriteTimeout: 0` (correct for WebSocket)

**Fix:** Add a periodic sweep of idle event stream connections (e.g., connections with no active runs and no recent subscriber reads for >30 minutes).

---

### LOW Impact

#### L1. Hub `UpdateUser` Uses `db.Save` (Full Column Update)

**File:** `hub-server/internal/repository/user.go:37`

**Problem:** `UpdateUser` calls `db.Save(user)` which updates ALL columns including unchanged ones. For a simple nickname change, this writes `password_hash`, `tokendance_sub`, and all other fields unnecessarily.

**Fix:** Use `db.Model(&User{}).Where("id = ?", id).Updates(map[string]interface{}{...})` with only the changed fields. (This is a minor issue since user updates are infrequent.)

---

#### L2. Hub Message `AllocateSeqID` Uses Raw SQL RETURNING

**File:** `hub-server/internal/repository/message.go:64-71`

**Problem:** `AllocateSeqID` uses `UPDATE ... RETURNING next_seq` which is PostgreSQL-specific. This works correctly but means the SQLite test path uses a different code path (no RETURNING support). This is a correctness note, not a performance issue.

**Fix:** No action needed for performance; documented for awareness.

---

#### L3. Frontend `hubClient.ts`: No Request Deduplication

**File:** `app/web/src/api/hubClient.ts`

**Problem:** The `createHubClient` factory creates a thin fetch wrapper with no request deduplication. If two components call `listSessions()` simultaneously (e.g., sidebar + main panel), two identical HTTP requests are made.

React Query's `placeholderData: (previous) => previous` partially mitigates this by avoiding redundant renders, but the underlying fetch is not deduplicated at the network level.

**Fix:** React Query already deduplicates in-flight queries with the same key, so this is only an issue if the same endpoint is called with different query keys. Standardize query keys across components to prevent duplication.

---

#### L4. Edge `openSQLiteDatabase`: `SetMaxOpenConns(1)` Global Serialization

**File:** `edge-server/internal/store/sqlite_migrations.go:257`

**Problem:** `db.SetMaxOpenConns(1)` serializes ALL database access through a single connection. With WAL mode enabled, reads can proceed concurrently, but the connection pool of 1 means even reads wait for the current operation to complete.

Combined with H1 (full snapshot persist), this means reads block during the entire persist operation.

**Fix:** Increase `SetMaxOpenConns(2)` — one for reads, one for writes. WAL mode allows concurrent reads during writes. However, this must be coordinated with the snapshot persist fix (H1) since the current `syncPersist` assumes exclusive access.

---

#### L5. Frontend `useWebWorkbenchModel`: O(n) Filtering on Every Render

**File:** `app/web/src/platform/useWebWorkbenchModel.ts:334-338`

**Problem:** `onlineLocalEdgeTargets` filters the full execution targets list on every render to find local_edge targets with specific health states. This is O(n) but runs outside `useMemo`, so it recalculates every render.

**Evidence:**
- `useWebWorkbenchModel.ts:334-338` — inline `.filter()` without memoization

**Fix:** Wrap in `useMemo` keyed on `executionTargets.data`.

---

## Quick Wins

| # | Finding | Effort | Impact | Fix |
|---|---------|--------|--------|-----|
| Q1 | H2: Remove redundant `refetchInterval` | Small | High | Delete `refetchInterval: 10_000` from queries that have WS invalidation; add `enabled: wsConnected` guard |
| Q2 | M4: Auth middleware token-type hint | Small | Medium | Check token structure before attempting RS256 parse |
| Q3 | L5: Memoize target filtering | Trivial | Low | Wrap `onlineLocalEdgeTargets` in `useMemo` |
| Q4 | H3: Add LIMIT to session list | Small | High | Add `LIMIT 100` to `ListUserSessions` SQL |
| Q5 | M1: Cache hubOutputs lookup | Small | Medium | Read `hubOutputs[runID]` once, pass as parameter |

## Long-Term Architectural Improvements

| # | Finding | Description |
|---|---------|-------------|
| A1 | H1: Edge incremental persist | Replace full-snapshot SQLite persist with row-level upsert. Each `SetRunStatus` should UPDATE a single row, not rewrite 500+ rows. Consider a write-ahead log that flushes periodically. |
| A2 | H3: Hub session pagination | Implement cursor-based pagination for session listing with a denormalized `member_count` on the sessions table. |
| A3 | M3: Search architecture | Separate full-text search (PostgreSQL tsvector) from pattern search (ILIKE). Consider a dedicated search index (e.g., Elasticsearch/Meilisearch) if search traffic grows. |
| A4 | M1: Edge Hub callback batching | Replace per-chunk goroutine spawning with a batched stream buffer (e.g., accumulate chunks for 200ms or 64KB before sending a single HTTP call to Hub). |
| A5 | M2: WS Manager device index | Add `byUserDevice` composite key index for O(1) device-type lookup instead of linear scan. |
| A6 | Frontend data layer | Adopt a unified real-time strategy: WebSocket as the primary data source, React Query as cache layer with long staleTime, and polling only as connectivity fallback. |
