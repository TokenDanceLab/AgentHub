# Code Review: AgentHub TypeScript Frontend (Non-UI)

> **Date**: 2026-06-10
> **Reviewer**: Claude Code (automated audit)
> **Scope**: API clients, React Query hooks, platform adapters, custom hooks, Zustand stores, shared workbench, transcript normalizers

---

## Summary

**Overall Grade: B+**

The codebase is well-structured with strong conventions, consistent patterns, and comprehensive API coverage. The main issues are: duplicated code between Web and Desktop (transport, hubWS, hubClient), several orphaned hooks, inconsistent `any`-adjacent typing in a few places, and drift between the Web and Desktop hubClient type definitions.

| Dimension | Score | Notes |
|-----------|-------|-------|
| Type safety | B | Good overall; `any` casts in transport emit, `Record<string, unknown>[]` for notifications/reactions |
| React Query patterns | A- | Proper invalidation, optimistic updates in desktop; web has stubs |
| API client correctness | A | Good error handling, envelope unwrapping, token injection |
| WebSocket handling | B+ | Solid reconnection, but web vs desktop inconsistency in error logging |
| Code quality | B+ | Clean, well-documented; duplicated files between web/desktop |
| Orphaned code | B | Several hooks never imported from non-test code |

---

## Issue Inventory

### CRITICAL

*(None found)*

### HIGH

#### H-01: Web and Desktop `hubClient.ts` Session types diverged
- **File**: `app/web/src/api/hubClient.ts:81-99` vs `app/desktop/src/api/hubClient.ts:83-98`
- **Severity**: High
- **Description**: Web `Session` has `id?: string` (optional) with fields `pinned`, `archived`, `muted`, `role` that Desktop lacks. Desktop `Session` has `owner_user_id: string` (required), `last_read_seq`, `unread_count` that Web also has but with different optionality. `createPrivateSession` returns `CreateSessionResponse` on Web but `Session` on Desktop. `UpdateAgentTeamRequest.name` is required on Desktop but optional on Web.
- **Fix**: Extract shared types to `@shared` or create a shared `hubTypes.ts`. Keep platform-specific extensions in each client.

#### H-02: Web and Desktop `hubWS.ts` are near-identical copies
- **File**: `app/web/src/api/hubWS.ts` vs `app/desktop/src/api/hubWS.ts`
- **Severity**: High
- **Description**: 220+ lines duplicated. Only difference: Web logs handler errors with `console.error`, Desktop silently swallows them (`catch (_e) {}`). Both should log for debuggability.
- **Fix**: Extract to `@shared/hubWS` or a shared internal package. Parameterize error handling behavior.

#### H-03: Web and Desktop `transport.ts` are near-identical copies
- **File**: `app/web/src/api/transport.ts` vs `app/desktop/src/api/transport.ts`
- **Severity**: High
- **Description**: 270+ lines duplicated. Desktop has a minor improvement: explicit `TransportHandler` type alias and typed emit dispatch (`status` vs `message`). Web casts all handlers to `(value: unknown) => void` unconditionally.
- **Fix**: Extract to shared module. The desktop typed-emit approach is strictly better; adopt it as the canonical version.

#### H-04: Desktop `useHubWebSocket` bypasses the Transport abstraction
- **File**: `app/desktop/src/hooks/useHubWebSocket.ts`
- **Severity**: High
- **Description**: Desktop has two WS implementations: the Transport-based `hubWS.ts` (used by `useHubEventStream`) and a raw-WebSocket `useHubWebSocket` hook. The raw version re-implements exponential backoff, auth URL construction, and reconnection from scratch. It also uses `?token=` query param (not `?access_token=` like the Transport version). This creates two different auth URL conventions for the same backend.
- **Fix**: Consolidate desktop to use the Transport-based `createHubWS` consistently. If both are needed, extract a shared reconnection hook.

### MEDIUM

#### M-01: `any`-adjacent casts in transport emit
- **File**: `app/web/src/api/transport.ts:177`
- **Severity**: Medium
- **Description**: `emit` casts all handlers to `(value: unknown) => void` regardless of event type, losing type safety. Desktop version does slightly better with explicit `status` vs `message` dispatch.
- **Fix**: Use the desktop approach with type-narrowing dispatch.

#### M-02: Notification and reaction types use `Record<string, unknown>[]`
- **File**: `app/web/src/api/hubClient.ts:1132,1137` and `app/desktop/src/api/hubClient.ts:1127,1132,1137`
- **Severity**: Medium
- **Description**: `listNotifications` and `listMessageReactions` return `Record<string, unknown>[]` instead of typed interfaces. Desktop defines `HubNotification` with `[key: string]: unknown` index signature but still returns `Record<string, unknown>[]` from the client method.
- **Fix**: Define proper `NotificationResponse` and `MessageReactionResponse` types and use them.

#### M-03: Web `useHubWSConnection` hook is unused
- **File**: `app/web/src/hooks/useHubWSConnection.ts:1`
- **Severity**: Medium
- **Description**: The file itself has a comment `NOTE: This hook is currently unused in the active workbench code path.` No component imports it. It creates a HubWS instance, manages connection lifecycle, toast notifications, and reconnection detection. If truly unused, it should be removed or gated behind a feature flag.
- **Fix**: Delete or move to an archived directory. Re-evaluate if the WS connection pattern is needed.

#### M-04: Desktop `useAuth` useCallback deps differ from Web
- **File**: `app/desktop/src/hooks/useAuth.ts:23-26` vs `app/web/src/hooks/useAuth.ts:23-26`
- **Severity**: Medium
- **Description**: Desktop includes `auth` in useCallback deps `[auth]`; Web uses `[]` (empty). Both use a module-level singleton so the deps should be identical. The Web version is technically correct (singleton never changes) but the Desktop version is safer.
- **Fix**: Standardize to `[auth]` in both, since `auth` is the actual dependency even if stable.

#### M-05: Web `readTokenSource` corrupts localStorage
- **File**: `app/web/src/api/hubAuth.ts:117-128`
- **Severity**: Medium
- **Description**: `readTokenSource()` calls `localStorage.removeItem(TOKEN_SOURCE_KEY)` then reads from `sessionStorage`. This destroys the localStorage key on every read, which is presumably intentional (migration), but the function name is misleading and the side effect is undocumented.
- **Fix**: Rename to `migrateAndReadTokenSource` or add a clear comment explaining the migration intent.

#### M-06: `hubEvents.ts` duplicated between Web and Desktop
- **File**: `app/web/src/api/hubEvents.ts` vs `app/desktop/src/api/hubEvents.ts`
- **Severity**: Medium
- **Description**: Both files are 100% identical. They re-export from `@shared/hubEvents` and add legacy per-constant aliases (`TYPE_AUTH`, `TYPE_MESSAGE_NEW`, etc.) plus wire-type interfaces (`HubFrame`, `HubMessage`, etc.).
- **Fix**: Move the legacy aliases and wire types to `@shared/hubEvents.ts` or a shared `hubWireTypes.ts`.

#### M-07: Desktop `useHubWebSocket` reconnect doesn't actually reconnect
- **File**: `app/desktop/src/hooks/useHubWebSocket.ts:175-184`
- **Severity**: Medium
- **Description**: After `onclose`, the reconnect timer fires and calls `setConnected(false)`, which triggers a re-render. But the effect re-runs only if `enabled` or the cleanup functions change -- `setConnected(false)` alone won't cause the effect to re-execute because `connected` isn't in the dependency array. The comment even acknowledges this: "we just call the connect logic again through state change" but the state change isn't wired to reconnect.
- **Fix**: Add a reconnect counter to deps, or use a ref-based reconnect approach like the Transport abstraction already does.

#### M-08: Web threadQueries creates module-level hubClient with potentially stale token
- **File**: `app/web/src/api/threadQueries.ts:8`
- **Severity**: Medium
- **Description**: `const hubClient = createHubClient({ getToken: getAccessToken })` is created at module load time. The `getAccessToken` function reads from the auth singleton, so it returns the current token at call time -- this is fine. However, the pattern is inconsistent with Desktop, which uses lazy singletons (`getHubClient()`).
- **Fix**: Adopt the Desktop lazy-singleton pattern for consistency and testability.

#### M-09: Desktop `EdgeAgentProfile` type diverges from `AgentInfo`
- **File**: `app/desktop/src/api/edgeClient.ts:368-386`
- **Severity**: Medium
- **Description**: `EdgeAgentProfile` is a Desktop-specific agent type with different fields than `AgentInfo` from `@shared/types`. Both exist and are used in different contexts. This can cause confusion when mapping between Hub and Edge agent profiles.
- **Fix**: Document the relationship clearly or create a unified type with platform-specific extensions.

#### M-10: `safeParse` returns `data as T` on schema failure
- **File**: `app/desktop/src/api/schemas.ts:215-222`
- **Severity**: Medium
- **Description**: When Zod validation fails, `safeParse` logs a warning and returns the raw `data as T`. This is intentional (schema drift shouldn't crash the UI) but the cast is unsafe. If the actual shape differs significantly from `T`, downstream code will get runtime errors anyway, but with less clear diagnostics.
- **Fix**: Consider returning a branded "potentially drifted" type or adding a `[__drifted]` marker for debugging.

### LOW

#### L-01: Desktop `startAgentTeamRunRequest` missing `target_id`
- **File**: `app/desktop/src/api/hubClient.ts:467-469` vs `app/web/src/api/hubClient.ts:775-778`
- **Severity**: Low
- **Description**: Web's `StartAgentTeamRunRequest` includes optional `target_id` field; Desktop's does not.
- **Fix**: Add `target_id?: string` to Desktop type.

#### L-02: Desktop `ExecutionTargetHealthState` missing values
- **File**: `app/desktop/src/api/hubClient.ts:559` vs `app/web/src/api/hubClient.ts:389-396`
- **Severity**: Low
- **Description**: Desktop defines `'unknown' | 'healthy' | 'degraded' | 'offline'`; Web also includes `'online' | 'mismatch' | 'stale'`.
- **Fix**: Align Desktop with Web's fuller definition.

#### L-03: Desktop `hubClient` missing `auth_method` on `ExecutionTarget`
- **File**: `app/desktop/src/api/hubClient.ts:561-580` vs `app/web/src/api/hubClient.ts:398-418`
- **Severity**: Low
- **Description**: Web has `auth_method?: string` on `ExecutionTarget`; Desktop does not.
- **Fix**: Add `auth_method?: string` to Desktop `ExecutionTarget`.

#### L-04: Web `runQueries.ts` uses stub implementations
- **File**: `app/web/src/api/runQueries.ts:4-46`
- **Severity**: Low
- **Description**: All three hooks (`useRuns`, `useCreateRun`, `useCancelRun`) return hardcoded fake data. No real Hub API calls. The stubs are clearly intentional (Web doesn't have a local Edge) but should be clearly marked.
- **Fix**: Add `@deprecated` or `// STUB` annotations. If Web will never have real runs, consider removing these.

#### L-05: Desktop `projectQueries.ts` duplicated with Web `projectQueries.ts`
- **File**: `app/desktop/src/api/projectQueries.ts` vs `app/web/src/api/projectQueries.ts`
- **Severity**: Low
- **Description**: Both implement workspace project query hooks but with different query key structures (`['hub', 'projects', ...]` vs `['web-v4', 'hub-projects', ...]`) and different patterns (lazy singleton vs direct client creation).
- **Fix**: Standardize query key naming. Consider extracting shared query key constants.

#### L-06: `contactQueries.ts` (Web) and `hubQueries.ts` (Desktop) overlap
- **File**: `app/web/src/api/contactQueries.ts` vs `app/desktop/src/api/hubQueries.ts`
- **Severity**: Low
- **Description**: Both implement contact/friend-request mutations but with different query keys and patterns. Desktop has session/message/notification hooks in `hubQueries.ts` that Web spreads across multiple files.
- **Fix**: Consider aligning file organization between platforms.

#### L-07: Missing `AGENT_CONTROL` in Desktop `HubWSFrameType`
- **File**: `app/desktop/src/hooks/useHubWebSocket.ts:13-44`
- **Severity**: Low
- **Description**: `HubWSFrameType` includes `team.run.started`, `team.run.event`, etc. but is missing `agent.control` which exists in `HUB_EVENTS`. Also `message.edited`, `message.reaction_added`, `message.reaction_removed` are in this enum but not in `HUB_EVENTS` constants.
- **Fix**: Align with canonical `HUB_EVENTS` or make the type a superset with documentation.

#### L-08: `localStorage.removeItem` called defensively but inconsistently
- **File**: `app/web/src/api/hubAuth.ts:119-120`, `app/web/src/stores/hubStore.ts:16-17`, `app/web/src/stores/hubStore.ts:33-34`
- **Severity**: Low
- **Description**: Multiple places call `localStorage.removeItem` to clear legacy keys, but these calls happen on every read/write cycle rather than once during migration.
- **Fix**: Add a one-time migration check (e.g., `localStorage.getItem('agenthub_migrated_v2')`) to avoid redundant removeItem calls.

#### L-09: Web `agentQueries.ts` module-level hubClient
- **File**: `app/web/src/api/agentQueries.ts:9`
- **Severity**: Low
- **Description**: Same as M-08. `const hubClient = createHubClient({ getToken: getAccessToken })` at module scope. Works correctly because `getAccessToken` reads fresh each call, but inconsistent with Desktop's lazy singleton pattern.
- **Fix**: Adopt lazy singleton for consistency.

#### L-10: Desktop `HubNotification` has index signature `[key: string]: unknown`
- **File**: `app/desktop/src/api/hubClient.ts:554`
- **Severity**: Low
- **Description**: The index signature allows any property, weakening type checking on notification objects.
- **Fix**: Remove the index signature and explicitly define known fields.

---

## Orphaned Code Inventory

The following hooks/functions exist but are **never imported by non-test application code**:

| ID | File | Export | Notes |
|----|------|--------|-------|
| O-01 | `app/web/src/hooks/useHubWSConnection.ts` | `useHubWSConnection` | File comment says "unused". Not imported by any component. |
| O-02 | `app/web/src/hooks/useStreamRecovery.ts` | `useStreamRecovery` | Not imported anywhere outside stats.html. |
| O-03 | `app/web/src/hooks/useHubMainChat.ts` | `useHubMainChat` | Not imported anywhere outside stats.html. |
| O-04 | `app/web/src/hooks/useHubIMSnapshot.ts` | `useHubIMSnapshot` | Imported only by `useHubCustomAgents.ts` (which itself may be lightly used). |
| O-05 | `app/web/src/hooks/useHubSession.ts` | `useHubSession` | Imported only by `useHubIMSnapshot.ts` and `useHubCustomAgents.ts`. |
| O-06 | `app/web/src/hooks/useWorkbenchProjection.ts` | `useWorkbenchProjection` | Not imported by any non-test code. |
| O-07 | `app/desktop/src/hooks/useRunners.ts` | `useRunners` | Only imported in `__tests__/useRunners.test.ts`. |
| O-08 | `app/desktop/src/hooks/useSendRun.ts` | `useSendRun` | Only imported in `hooks/useSendRun.test.tsx`. |
| O-09 | `app/desktop/src/hooks/useMediaQuery.ts` | `useMediaQuery` | Not imported outside stats.html. Web version used by components. |
| O-10 | `app/desktop/src/hooks/useStreamingText.ts` | `useStreamingText` | Not imported outside stats.html. |
| O-11 | `app/desktop/src/hooks/useFocusSourceTracking.ts` | `useFocusSourceTracking` | Not imported by any code at all. |
| O-12 | `app/desktop/src/hooks/useEdgeStatus.ts` | `useEdgeStatus` | Only imported by itself (self-referential). |
| O-13 | `app/web/src/api/hubClient.ts` | `HubError` class | Only imported in `__tests__/hubClient.test.ts`. Error handling uses `AppError`. |
| O-14 | `app/desktop/src/api/hubClient.ts` | `HubError` class | Same as O-13. |
| O-15 | `app/desktop/src/hooks/useEventStream.ts` | `useEventStream` | Imported by `DesktopHubTaskBridge.tsx` (used). **Not orphaned** -- listed for verification. |

**Recommendation**: Do NOT delete orphaned code. Mark each with a `// @orphaned — last verified 2026-06-10` comment. Re-evaluate in next sprint.

---

## Quick Wins

1. **Unify query keys** (1-2 hours): Define shared query key constants in `@shared` so Web and Desktop don't use different key structures for the same data.

2. **Extract shared transport** (2-3 hours): Move `transport.ts` from both platforms to `@shared/transport`. Adopt Desktop's typed-emit pattern. This eliminates ~270 lines of duplication.

3. **Extract shared hubWS** (2-3 hours): Move `hubWS.ts` to `@shared/hubWS`. Parameterize error logging. This eliminates ~220 lines of duplication.

4. **Delete or annotate `useHubWSConnection`** (15 min): It's explicitly marked unused. Either delete it or add an `@orphaned` annotation.

5. **Fix Desktop reconnect bug** (30 min): `useHubWebSocket.ts` reconnect timer doesn't actually trigger reconnection. Add a reconnect counter to effect dependencies.

6. **Align Session types** (1 hour): Extract shared `Session` interface to a types file. Both platforms extend it for their specific needs.

7. **Standardize hubClient creation pattern** (1 hour): Web uses module-level `createHubClient()` calls; Desktop uses lazy singletons. Standardize to lazy singleton pattern for testability.

8. **Add `agent.control` to Desktop HubWSFrameType** (5 min): Missing event type that exists in HUB_EVENTS.

---

## Detailed Findings by Dimension

### 1. Type Safety

**Positive**:
- Strong use of branded types (`ExecutionTargetType`, `ExecutionTargetTrustLevel`, `ExecutionTargetHealthState`)
- Proper const assertions on `HUB_EVENTS`
- Good use of `as const` for query keys
- `HubEventType` derived from `typeof HUB_EVENTS[keyof typeof HUB_EVENTS]` is correct

**Issues**:
- `request<T>()` in hubClient returns `undefined as T` for 204 responses -- technically unsafe but acceptable
- `isHubEnvelope<T>` type guard casts through `as { code?: unknown }` -- correct but verbose
- `Record<string, unknown>` used as escape hatch for `last_message`, `metadata`, `edge_control`
- No `exactOptionalPropertyTypes` enforcement -- many fields are `field?: string | undefined` which accepts explicit `undefined`

### 2. React Query Patterns

**Positive**:
- Consistent `onSettled` invalidation (not just `onSuccess`)
- Desktop has proper optimistic updates with snapshot/restore in `runQueries.ts` and `threadQueries.ts`
- Good use of `placeholderData: (prev) => prev` for smooth UX
- Query keys are hierarchical and specific
- `refetchInterval: 10_000` used consistently for active data

**Issues**:
- Web `threadQueries.ts` uses `authenticated` as part of query key (`['threads', projectId, authenticated]`) which causes unnecessary refetch on auth state changes
- Web `agentQueries.ts` switches query key between `['agents', 'hub']` and `['agents', 'preview']` based on auth state -- causes cache miss on auth change
- Desktop `threadQueries.ts` `useCreateThread` lacks optimistic update (Web has one, but it's also not optimistic)

### 3. API Client Correctness

**Positive**:
- Proper envelope unwrapping (`isHubEnvelope`, `isSharedErrorBody`)
- JWT token injection through `getToken()` callback
- Query string builder handles null/undefined correctly
- `encodeURIComponent` used consistently for path parameters
- Desktop edgeClient has 401 retry with token refresh
- Zod schema validation on Desktop with safeParse fallback

**Issues**:
- Web `hubClient` has no request timeout
- Desktop `edgeClient.fetchCurrentUser` does manual `as Record<string, unknown>` casts instead of using Zod
- Both hubClients set `Content-Type: application/json` even for DELETE requests with no body

### 4. WebSocket Handling

**Positive**:
- Clean Transport abstraction with offline queue and localStorage persistence
- Proper exponential backoff with jitter
- Auth handshake happens on every (re)connect
- Typed event routing with per-type handler sets
- Catch-all `onAny` handler for logging/debugging

**Issues**:
- Desktop `useHubWebSocket` (the raw WS hook) uses `?token=` while Transport uses `?access_token=` -- backend must accept both
- Web hubWS logs handler errors; Desktop silently swallows them
- No heartbeat/ping-pong mechanism in either implementation
- `typedHandlers.clear()` in `close()` means any subscriber holding an `unsubscribe` fn after close gets a no-op, which is fine but undocumented

### 5. Code Quality

**Positive**:
- Consistent file organization and naming conventions
- Good JSDoc comments on public APIs
- Clean separation of concerns (API client / queries / hooks / stores)
- Zustand stores use `subscribeWithSelector` middleware consistently
- `useSyncExternalStore` used correctly for auth state

**Issues**:
- Web `useHubWSConnection` captures `status` (state variable) in the `onStatus` callback closure via `prevStatusRef.current = status` -- this reads the stale closure value, not the latest state. Should use `setJustReconnected` callback pattern instead.
- Multiple files define `formatDocTime` function identically (`documentQueries.ts` Desktop and `hubDataMapping.ts` shared)
- `AgentTaskStreamEventOptions` defined in Desktop hubClient but not in Web

### 6. Consistency Between Web and Desktop

| Feature | Web | Desktop | Status |
|---------|-----|---------|--------|
| hubClient types | Extended Session, workspace projects | Extended Session (different), documents, profiles | **Diverged** |
| Transport | Duplicated | Duplicated (with typed emit) | **Duplicated** |
| hubWS | Duplicated (with error logging) | Duplicated (silent errors) | **Duplicated** |
| Query keys | `['web-v4', ...]` or `['threads', ...]` | `['hub', ...]` or `['threads', ...]` | **Inconsistent** |
| hubClient creation | Module-level | Lazy singleton | **Inconsistent** |
| Auth storage | sessionStorage | localStorage + Tauri secure store | **By design** |
| Run queries | Stubs | Real Edge API | **By design** |
| Thread queries | Hub sessions | Edge threads | **By design** |
