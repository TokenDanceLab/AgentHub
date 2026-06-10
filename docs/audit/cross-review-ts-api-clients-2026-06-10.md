# Cross-Review: TypeScript API Clients & React Query Hooks
## Web vs Desktop Consistency Audit
**Date**: 2026-06-10 | **Scope**: `D:\Code\TokenDance\AgentHub\app`

---

## 1. hubClient.ts Method Comparison

### 1.1 Methods present on BOTH sides (signature identical)

| # | Method | Web Return | Desktop Return | Path |
|---|--------|-----------|---------------|------|
| 1 | `refresh` | `AuthResponse` | `AuthResponse` | `/client/auth/refresh` |
| 2 | `logout` | `undefined` | `EmptyHubResponse` | `/client/auth/logout` |
| 3 | `me` | `UserProfile` | `UserProfile` | `/client/auth/me` |
| 4 | `updateProfile` | `UserProfile` | `UserProfile` | `/client/auth/profile` |
| 5 | `oidcAuthorize` | `OIDCAuthorizeResponse` | `OIDCAuthorizeResponse` | `/client/auth/oidc/authorize` |
| 6 | `oidcCallback` | `OIDCCallbackResponse` | `OIDCCallbackResponse` | `/client/auth/oidc/callback` |
| 7 | `searchUser` | `SearchResult` | `SearchResult` | `/client/contacts/search` |
| 8 | `listContacts` | `ContactInfo[]` | `ContactInfo[]` | `/client/contacts` |
| 9 | `sendFriendRequest` | `undefined` | `EmptyHubResponse` | `/client/contacts/friend-requests` |
| 10 | `listFriendRequests` | `FriendRequestInfo[]` | `FriendRequestInfo[]` | `/client/contacts/friend-requests` |
| 11 | `acceptFriendRequest` | `undefined` | `EmptyHubResponse` | `.../accept` |
| 12 | `rejectFriendRequest` | `undefined` | `EmptyHubResponse` | `.../reject` |
| 13 | `removeContact` | `undefined` | `EmptyHubResponse` | `/client/contacts/{id}` |
| 14 | `blockContact` | `undefined` | `EmptyHubResponse` | `.../block` |
| 15 | `unblockContact` | `undefined` | `EmptyHubResponse` | `.../unblock` |
| 16 | `updateContactRemark` | `undefined` | `EmptyHubResponse` | `.../remark` |
| 17 | `listSessions` | `Session[]` | `Session[]` | `/client/sessions` |
| 18 | `searchSessions` | `Session[]` | `Session[]` | `/client/sessions/search` |
| 19 | `addSessionMembers` | `undefined` | `EmptyHubResponse` | `.../members` |
| 20 | `removeSessionMember` | `undefined` | `EmptyHubResponse` | `.../members/{userId}` |
| 21 | `leaveSession` | `undefined` | `EmptyHubResponse` | `.../leave` |
| 22 | `transferSessionOwnership` | `undefined` | `EmptyHubResponse` | `.../transfer-owner` |
| 23 | `dissolveSession` | `undefined` | `EmptyHubResponse` | `.../dissolve` |
| 24 | `updateSessionInfo` | `undefined` | `EmptyHubResponse` | `.../info` |
| 25 | `updateSessionSettings` | `undefined` | `EmptyHubResponse` | `.../settings` |
| 26 | `deleteSession` | `undefined` | `EmptyHubResponse` | `.../{id}` |
| 27 | `sendMessage` | `SendMessageResponse` | `SendMessageResponse` | `.../messages` |
| 28 | `getMessages` | `MessageResponse[]` | `MessageResponse[]` | `.../messages` |
| 29 | `syncMessages` | `MessageResponse[]` | `MessageResponse[]` | `.../messages/sync` |
| 30 | `markRead` | `undefined` | `EmptyHubResponse` | `.../read` |
| 31 | `recallMessage` | `undefined` | `EmptyHubResponse` | `.../recall` |
| 32 | `pinMessage` | `undefined` | `EmptyHubResponse` | `.../pin` |
| 33 | `unpinMessage` | `undefined` | `EmptyHubResponse` | `.../pin` |
| 34 | `forwardMessage` | `undefined` | `EmptyHubResponse` | `.../forward` |
| 35 | `listPinnedMessages` | `MessageResponse[]` | `MessageResponse[]` | `.../pins` |
| 36 | `searchMessages` | `MessageResponse[]` | `MessageResponse[]` | `/client/messages/search` |
| 37 | `searchSessionMessages` | `MessageResponse[]` | `MessageResponse[]` | `.../messages/search` |
| 38 | `editMessage` | `MessageResponse` | `MessageResponse` | `.../{id}` |
| 39 | `addMessageReaction` | `undefined` | `EmptyHubResponse` | `.../reactions` |
| 40 | `removeMessageReaction` | `undefined` | `EmptyHubResponse` | `.../reactions` |
| 41 | `listMessageReactions` | `Record<string,unknown>[]` | `Record<string,unknown>[]` | `.../reactions` |
| 42 | `listNotifications` | `Record<string,unknown>[]` | `Record<string,unknown>[]` | `/client/notifications` |
| 43 | `markNotificationRead` | `undefined` | `EmptyHubResponse` | `.../read` |
| 44 | `readAllNotifications` | `undefined` | `EmptyHubResponse` | `.../read-all` |
| 45 | `registerDevice` | `Device` | `Device` | `/edge/devices/register` |
| 46 | `ackTask` | `undefined` | `EmptyHubResponse` | `.../ack` |
| 47 | `streamTask` | `undefined` | `EmptyHubResponse` | `.../stream` |
| 48 | `doneTask` | `undefined` | `EmptyHubResponse` | `.../done` |
| 49 | `failTask` | `undefined` | `EmptyHubResponse` | `.../fail` |
| 50 | `triggerAgentTask` | `PendingAgentTask` | `PendingAgentTask` | `/web/agent-tasks` |
| 51 | `cancelAgentTask` | `undefined` | `EmptyHubResponse` | `.../cancel` |
| 52 | `listAgentProfiles` | `AgentProfileListResponse` | `AgentProfileListResponse` | `/web/agent-profiles` |
| 53 | `createAgentProfile` | `AgentProfile` | `AgentProfile` | `/web/agent-profiles` |
| 54 | `updateAgentProfile` | `AgentProfile` | `AgentProfile` | `.../{id}` |
| 55 | `deleteAgentProfile` | `undefined` | `EmptyHubResponse` | `.../{id}` |
| 56 | `listExecutionTargets` | `ExecutionTargetListResponse` | `ExecutionTargetListResponse` | `/web/execution-targets` |
| 57 | `pingExecutionTarget` | `undefined` | `EmptyHubResponse` | `.../ping` |
| 58 | `listWorkspaceProjects` | `WorkspaceProjectListResponse` | `WorkspaceProjectListResponse` | `/web/projects` |
| 59 | `getWorkspaceProject` | `WorkspaceProject` | `WorkspaceProject` | `.../{id}` |
| 60 | `createWorkspaceProject` | `WorkspaceProject` | `WorkspaceProject` | `/web/projects` |
| 61 | `updateWorkspaceProject` | `WorkspaceProject` | `WorkspaceProject` | `.../{id}` |
| 62 | `listWorkspaceProjectThreads` | `WorkspaceProjectThread[]` | `WorkspaceProjectThread[]` | `.../threads` |
| 63 | `createWorkspaceProjectThread` | `WorkspaceProjectThread` | `WorkspaceProjectThread` | `.../threads` |
| 64 | `listWorkspaceProjectThreadMessages` | `WorkspaceProjectThreadMessage[]` | `WorkspaceProjectThreadMessage[]` | `.../messages` |
| 65 | `sendWorkspaceProjectThreadMessage` | `WorkspaceProjectThreadMessage` | `WorkspaceProjectThreadMessage` | `.../messages` |
| 66 | `listAgentTeams` | `AgentTeam[]` | `AgentTeam[]` | `/web/agent-teams` |
| 67 | `getAgentTeam` | `AgentTeamDetail` | `AgentTeamDetail` | `.../{id}` |
| 68 | `createAgentTeam` | `AgentTeam` | `AgentTeam` | `/web/agent-teams` |
| 69 | `addAgentTeamMember` | `undefined` | `void` | `.../members` |
| 70 | `listTeamRuns` | `AgentTeamRun[]` | `AgentTeamRun[]` | `.../runs` |
| 71 | `startTeamRun` | `AgentTeamRun` | `AgentTeamRun` | `.../runs` |
| 72 | `getTeamRun` | `AgentTeamRun` | `AgentTeamRun` | `.../runs/{runId}` |
| 73 | `getTeamRunState` | `TeamRunState` | `TeamRunState` | `.../runs/{runId}/state` |
| 74 | `listTeamTasks` | `AgentTeamTask[]` | `AgentTeamTask[]` | `.../runs/{runId}/tasks` |
| 75 | `listTeamEvents` | `AgentTeamEvent[]` | `AgentTeamEvent[]` | `.../runs/{runId}/events` |
| 76 | `listCustomAgents` | `Record<string,unknown>[]` | **`CustomAgent[]`** | `/web/custom-agents` |
| 77 | `createCustomAgent` | `Record<string,unknown>` | `Record<string,unknown>` | `/web/custom-agents` |
| 78 | `updateCustomAgent` | `Record<string,unknown>` | `Record<string,unknown>` | `.../{id}` |
| 79 | `deleteCustomAgent` | `undefined` | `EmptyHubResponse` | `.../{id}` |

**Note on `undefined` vs `EmptyHubResponse` vs `void`**: All three are semantically identical (the endpoint returns 204 No Content). Web uses bare `undefined`, Desktop uses `EmptyHubResponse` (aliased to `undefined`) and sometimes `void`. This is a cosmetic difference, not a behavioral contract issue.

### 1.2 Methods with return type divergence (same endpoint, different types)

| Method | Web Return | Desktop Return | Risk |
|--------|-----------|---------------|------|
| `createPrivateSession` | `CreateSessionResponse` | `Session` | **Medium** -- callers in web use `.session_id`; desktop callers treat as `Session` object |
| `createGroupSession` | `CreateSessionResponse` | `Session` | **Medium** -- same as above |
| `addAgentToSession` | `AgentInstance` | `EmptyHubResponse` | **High** -- web depends on `id` from return; desktop treats as fire-and-forget |
| `updateAgentTeam` | `AgentTeam` | `void` | **Low** -- web returns typed result; desktop discards |
| `decideTeamApproval` | `undefined` | `TeamApprovalState` | **Low** -- web discards; desktop returns structured state |
| `resolveTeamConflict` | `undefined` | `TeamConflictState` | **Low** -- web discards; desktop returns structured state |
| `deleteAgentTeam` | `undefined` | `void` | **Trivial** |
| `removeAgentTeamMember` | (missing in web) | `void` | **See missing methods** |

### 1.3 URL path divergence

| Method | Web Path | Desktop Path | Notes |
|--------|---------|--------------|-------|
| `getTaskRunEventSummary` | `/web/agent-tasks/{id}/summary` | `/web/agent-tasks/{id}/events/summary` | **Inconsistent** -- server likely supports only one path |

### 1.4 Methods missing from Web hubClient (present in Desktop)

| # | Method | Desktop Path | Category |
|---|--------|-------------|----------|
| 1 | `streamTaskEvent` | `/edge/agent-tasks/{id}/stream` | Edge (desktop-only scope) |
| 2 | `removeAgentTeamMember` | `/web/agent-teams/{teamId}/members/{memberId}` (DELETE) | **Missing API** |
| 3 | `postTeamRouteDecision` | `/web/agent-teams/{teamId}/runs/{runId}/route-decisions` (POST) | **Missing API** |
| 4 | `createExecutionTarget` | `/web/execution-targets` (POST) | Management API |
| 5 | `updateExecutionTarget` | `/web/execution-targets/{id}` (PATCH) | Management API |
| 6 | `getAgentProfile` | `/web/agent-profiles/{id}` (GET) | **Missing API** |
| 7 | `listDocuments` | `/web/documents` (GET) | Document API |
| 8 | `getDocument` | `/web/documents/{id}` (GET) | Document API |
| 9 | `createDocument` | `/web/documents` (POST) | Document API |
| 10 | `updateDocument` | `/web/documents/{id}` (PATCH) | Document API |
| 11 | `deleteDocument` | `/web/documents/{id}` (DELETE) | Document API |
| 12 | `fetchSettings` | `/client/settings` (GET) | Settings API |
| 13 | `patchSettings` | `/client/settings` (PATCH) | Settings API |

### 1.5 Methods missing from Desktop hubClient (present in Web)

| # | Method | Web Path | Category |
|---|--------|---------|----------|
| 1 | `listTaskRunEvents` | `/web/agent-tasks/{id}/events` (GET) | **Task replay** |
| 2 | `listTaskApprovals` | `/web/agent-tasks/{id}/approvals` (GET) | **Task approvals** |
| 3 | `decideTaskApproval` | `/web/agent-tasks/{id}/approvals/{id}/decide` (POST) | **Task approvals** |
| 4 | `listTaskArtifacts` | `/web/agent-tasks/{id}/artifacts` (GET) | **Task artifacts** |

**Rationale**: Desktop handles agent task lifecycle through Edge device locally (ack/stream/done/fail). Web needs these endpoints because it is a thin client that must query Hub for task history.

---

## 2. React Query Hook Comparison

### 2.1 Query Key Consistency

| Domain | Web Query Keys | Desktop Query Keys | Conflict? |
|--------|---------------|-------------------|-----------|
| Agent profiles | `['agents', 'hub'\|'preview']` | `['agent-profiles']` (Edge), `['hub', 'agent-profiles']` (Hub fallback) | **No** -- different key spaces |
| Agent teams | `['agent-teams', 'hub'\|'signed-out', baseUrl, selectedTeamId, selectedRunId]` | `['agent-teams', 'hub'\|'signed-out', baseUrl, selectedTeamId, selectedRunId]` | **Identical** (good) |
| Contacts | `['web-v4', 'hub-contacts']` | `['hub', 'contacts']` | **Different prefixes** -- safe but inconsistent |
| Friend requests | `['web-v4', 'hub-friend-requests']` | (embedded in hubQueries as `['hub', 'contacts']`) | **Different granularity** -- Desktop lumps contacts+friend-requests together |
| Sessions | `['web-v4', 'hub-sessions']` | `['hub', 'sessions']` | **Different prefixes** |
| Messages | `['web-v4', 'hub-messages', sessionId]` | `['hub', 'sessions', sessionId, 'messages']` | **Different prefixes** |
| Notifications | (via inline hubClient call) | `['hub', 'notifications']` | **Different prefixes** |
| Projects | `['web-v4', 'hub-projects']` | `['hub', 'workspace-projects']` | **Different prefixes** |
| Project threads | `['web-v4', 'hub-project-threads', projectId]` | `['hub', 'projects', projectId, 'threads']` | **Different prefixes** |
| Thread messages | `['web-v4', 'hub-project-thread-messages', projectId, threadId]` | `['hub', 'projects', projectId, 'threads', threadId, 'messages']` | **Different prefixes** |
| Execution targets | `['execution-targets', 'hub'\|'signed-out']` | (not used as queries in desktop) | N/A |

**Finding**: Web uses `['web-v4', ...]` prefix consistently. Desktop uses `['hub', ...]` prefix consistently. These are different QueryClient instances (different app processes), so there is NO collision risk. However, the inconsistency makes it harder to share cache normalization utilities.

### 2.2 Mutation Invalidation Coverage

**Contacts (Web -- contactsQueries.ts)**:
- `useSendFriendRequest` invalidates `['web-v4', 'hub-contacts']` AND `['web-v4', 'hub-friend-requests']` -- **correct**
- `useAcceptFriendRequest` invalidates both contacts AND friend-requests -- **correct**
- `useRejectFriendRequest` invalidates only `friendRequestsQueryKey` -- **correct** (no contact was created)
- `useRemoveContact` invalidates only `contactsQueryKey` -- **correct**
- `useCreateGroupSession` invalidates only `sessionsQueryKey` -- **correct**

**Contacts (Desktop -- hubQueries.ts)**:
- `useHubSendFriendRequest` invalidates only `['hub', 'contacts']` -- **misses friend-requests invalidation** (Web invalidates both)
- `useHubAcceptFriendRequest` invalidates only `['hub', 'contacts']` -- same issue
- `useHubRejectFriendRequest` invalidates only `['hub', 'contacts']` -- Web-only invalidates `friendRequestsQueryKey`; Desktop has no separate friend-requests query

**Sessions (Desktop -- sessionQueries.ts)**:
- `useHubMarkRead` invalidates `['hub', 'sessions']` -- **correct**
- `useHubRecallMessage` invalidates `['hub', 'sessions']` -- **should also invalidate messages for the affected session** (the message content changed)
- `useHubEditMessage` invalidates `['hub', 'sessions']` -- same issue as recall
- `useHubPinMessage` / `useHubUnpinMessage` invalidates `['hub', 'sessions']` -- should also invalidate pins query

**Threads (Web -- threadQueries.ts)**:
- `useRenameThread` invalidates `['threads']` -- **correct**
- `useDeleteThread` invalidates `['threads']` -- **correct, but should also invalidate `['threadItems']` to avoid stale child data**
- `useCreateThread` invalidates `['threads']` -- **correct**

**Runs**:
- Web `useCreateRun` invalidates `['runs']` + `['threads']` -- **correct** but uses stubs
- Desktop `useCreateRun` invalidates `['runs']` + `['threads']` + `['threadItems']` -- **more complete**; Desktop additionally uses optimistic updates with rollback
- Desktop `useCancelRun` has optimistic update with rollback -- **better pattern** than Web's stub

**Agent profiles (Web -- agentQueries.ts)**:
- All mutations invalidate `['agents']` -- **correct**
- Desktop `useCreateAgentProfile` / `useUpdateAgentProfile` / `useDeleteAgentProfile` invalidate `['agent-profiles']` -- **correct** for Edge

**Agent teams**:
- Both Web and Desktop invalidate `['agent-teams']` on all team mutations -- **correct but coarse** (should consider invalidating more specific keys for better performance)

### 2.3 Enabled Condition Analysis

| Hook | Web | Desktop | Issue? |
|------|-----|---------|--------|
| Agent profiles list | `enabled` (boolean param) | `enabled` (boolean param) | **Consistent** |
| Hub sessions | `hubReady` (derived from `authenticated && getAccessToken()`) | `opts?.enabled ?? false` | **Different patterns** -- Web auto-derives; Desktop expects explicit opt-in |
| Hub contacts | `hubReady` | `opts?.enabled ?? false` | Same pattern difference |
| Friend requests | `options.enabled` | (no separate query; part of contact flow) | Desktop lacks a dedicated friend-requests query |
| Messages | `!!threadId && !!getAccessToken()` | `opts?.enabled ?? false` | Web auto-enables when threadId is truthy |
| Projects | `options.enabled` | `opts?.enabled ?? false` | **Consistent** |
| Execution targets | `options.enabled` | N/A | Web-only |
| Agent teams | `options.enabled` | `options.enabled` | **Consistent** |
| Runs | `options.enabled ?? true` | `options.enabled ?? true` | Desktop enables by default |

**Finding**: Web's `useThreadMessages` has a subtle bug -- it checks `!!getAccessToken()` for enabled, but `getAccessToken()` is evaluated ONCE at component mount (it's a function call, not a reactive getter). If the token becomes available after mount, the query won't auto-enable.

### 2.4 Refetch Interval & Stale Time Configuration

| Hook | Web | Desktop |
|------|-----|---------|
| Agent list | `refetchInterval: 10_000` | `refetchInterval: 10_000` (Edge) |
| Hub agent teams | `refetchInterval: preferHub ? 10_000 : false` | `refetchInterval: preferHub ? 10_000 : false` |
| Hub execution targets | `refetchInterval: preferHub ? 10_000 : false` | N/A |
| Sessions (Web) | `refetchInterval: hubReady ? 10_000 : false` | No refetchInterval (Desktop sessions query) |
| Messages (Web) | `staleTime: 5_000` | No staleTime (Desktop messages query) |
| Threads (Web) | `refetchInterval: authenticated ? 10_000 : false` | N/A (Desktop uses threadQueries) |
| Runs | `refetchInterval: 10_000` | `refetchInterval: 10_000` |
| Projects (Web) | `staleTime: 10_000` | No staleTime |
| Project threads (Web) | `staleTime: 10_000` | No staleTime |

**Finding**: Desktop sessionQueries.ts hooks (`useHubSessions`, `useHubMessages`, `useHubNotifications`) lack `staleTime` and `refetchInterval` configuration. The Desktop model relies on WebSocket invalidation (in `useDesktopWorkbenchModel.ts`) to trigger refetches, which is a valid but different strategy.

### 2.5 Promise Handling Issues

**No unhandled promise rejections found** -- all async helpers in both codebases properly catch or use `.catch()`.

However, one pattern worth noting:

- **Web `contactQueries.ts`** uses `void queryClient.invalidateQueries(...)` (the `void` prefix) inside `onSettled` throughout.
- **Desktop** uses `void queryClient.invalidateQueries(...)` inside `onSuccess` in `projectQueries.ts`, `hubQueries.ts`, `sessionQueries.ts`, `documentQueries.ts`.

Both are fine -- `void` prevents floating promise lint warnings. `onSettled` is more defensive than `onSuccess` because it runs even on error (useful for optimistic updates). Web's mutations correctly use `onSettled`; Desktop uses `onSuccess` which will NOT invalidate on mutation failure.

---

## 3. Platform Adapter Interface Comparison

### 3.1 chatActions Interface

| Action | Web (`useWebWorkbenchModel`) | Desktop (`useDesktopWorkbenchModel`) |
|--------|------|---------|
| `sendMessage` | (not exposed as `chatActions`; goes through composer run pipeline) | `(sessionId, content, contentType?) => Promise<unknown>` |
| `recallMessage` | `(messageId) => void` (via `onRecallMessage`) | `(messageId) => Promise<unknown>` (via `recallMessage`) |
| `editMessage` | `(messageId, content) => void` (via `onEditMessage`) | `(messageId, content) => Promise<unknown>` (via `editMessage`) |
| `pinMessage` | `(messageId, sessionId) => void` (via `onPinMessage`) | `(messageId, sessionId) => Promise<unknown>` (via `pinMessage`) |
| `unpinMessage` | `(messageId, sessionId) => void` (via `onUnpinMessage`) | `(messageId, sessionId) => Promise<unknown>` (via `unpinMessage`) |
| `forwardMessage` | `(messageId, targetSessionIds) => void` (via `onForwardMessage`) | **Missing in Desktop** |
| `searchMessages` | `(params) => void` (via `onSearchMessages`) | **Missing in Desktop** |
| `searchSessionMessages` | `(sessionId, params) => void` (via `onSearchSessionMessages`) | **Missing in Desktop** |
| `markRead` | `(sessionId, lastReadSeq) => void` (via `onMarkRead`) | `(sessionId, lastReadSeq) => Promise<unknown>` (via `markRead`) |
| `addReaction` | `(messageId, sessionId, emoji) => void` (via `onAddReaction`) | **Missing in Desktop** |
| `removeReaction` | `(messageId, sessionId, emoji) => void` (via `onRemoveReaction`) | **Missing in Desktop** |

**Key difference**: Web's `chatActions` is a flat object with named handlers; Desktop's `DesktopChatActions` is a typed interface. Web's `chatActions.sendMessage` is NOT part of `chatActions` -- it goes through the built-in composer, which is a fundamentally different architecture.

**Missing in Desktop `chatActions`**: `forwardMessage`, `searchMessages`, `searchSessionMessages`, `addReaction`, `removeReaction`. These are present in Desktop's `sessionQueries.ts` as individual hooks but are not wired into the `chatActions` interface.

### 3.2 contactsActions Interface

Both platforms expose nearly identical `WorkbenchContactsActions`:
- `onSearchUser`, `onSendFriendRequest`, `onAcceptRequest`, `onRejectRequest`, `onRemoveContact`, `onBlockContact`, `onUnblockContact`, `onUpdateRemark`, `onCreateGroup`

**Identical** -- good. Both use the same `@shared/workbench/WorkbenchRoutes` type.

### 3.3 documentsActions

**Web**: No `documentsActions` exposed (documents are not part of the Web workbench model).
**Desktop**: `documentQueries.ts` has `useCreateDocument` and `useDocumentList` but does NOT wire them into the workbench model's `documentsActions`. These are standalone hooks used directly by components.

### 3.4 projectsActions Interface

| Action | Web | Desktop |
|--------|-----|---------|
| `create` | `(draft: ProjectDraft) => Promise<ProjectInfo>` | `(draft: ProjectDraft) => Promise<ProjectInfo>` |
| `update` | `(projectId: string, draft: ProjectDraft) => Promise<ProjectInfo>` | `(projectId: string, draft: ProjectDraft) => Promise<ProjectInfo>` |

**Identical** -- good. Both convert through `workspaceProjectToProjectInfo`.

---

## 4. WebSocket Handling Comparison

### 4.1 Event Types Supported

| Event Type | `hubEvents.ts` (shared) | Web `hubWS.ts` | Desktop `useHubWebSocket.ts` |
|-----------|------------------------|---------------|-----------------------------|
| `auth` | YES | YES | YES |
| `auth.ok` | YES | YES | YES (silently dropped) |
| `auth.fail` | YES | YES | **NOT in type union** |
| `message.new` | YES | (via onAny) | YES |
| `message.recall` | YES | (via onAny) | YES |
| `message.pin` | YES | (via onAny) | YES |
| `message.unpin` | YES | (via onAny) | YES |
| `message.read` | YES | (via onAny) | YES |
| `session.created` | YES | (via onAny) | YES |
| `session.dissolved` | YES | (via onAny) | YES |
| `session.member_joined` | YES | (via onAny) | YES |
| `session.member_left` | YES | (via onAny) | YES |
| `session.info_updated` | YES | (via onAny) | YES |
| `device.online` | YES | (via onAny) | YES |
| `device.offline` | YES | (via onAny) | YES |
| `device.kicked` | YES | (via onAny) | YES |
| `agent.dispatch` | YES | (via onAny) | YES |
| `agent.stream` | YES | (via onAny) | YES |
| `agent.done` | YES | (via onAny) | YES |
| `agent.failed` | YES | (via onAny) | YES |
| `agent.cancel` | YES | (via onAny) | YES |
| `agent.control` | YES | (via onAny) | YES |
| `notification.new` | YES | (via onAny) | YES |
| `friend.request` | YES | (via onAny) | YES |
| `friend.accepted` | YES | (via onAny) | YES |
| **`typing`** | **NO** | YES (as `sendTyping`) | **YES** |
| **`message.edited`** | **NO** | (via onAny) | **YES** |
| **`message.reaction_added`** | **NO** | (via onAny) | **YES** |
| **`message.reaction_removed`** | **NO** | (via onAny) | **YES** |
| **`team.run.started`** | **NO** | (via onAny) | **YES** |
| **`team.run.event`** | **NO** | (via onAny) | **YES** |
| **`team.assignment.done`** | **NO** | (via onAny) | **YES** |
| **`team.assignment.failed`** | **NO** | (via onAny) | **YES** |

**Count**: `hubEvents.ts` defines **26** event type constants. Desktop's type union has **36** event types (includes team events, typing, edited, reactions). The shared `hubEvents.ts` is missing 10 event types that Desktop already handles and Web can route via `onAny`.

### 4.2 Reconnection Logic

| Aspect | Web `hubWS.ts` | Desktop `useHubWebSocket.ts` |
|--------|---------------|-----------------------------|
| Transport layer | `WebSocketTransport` class (separate file) | Direct `WebSocket` in useEffect |
| Backoff strategy | Via `WebSocketTransport` (not inspected) | Exponential: 1s base, 2x multiplier, 30s max |
| Reconnect trigger | Transport automatically reconnects on close | `setTimeout` in `onclose` handler |
| Auth re-execution | Yes (new `access_token` query param on reconnect) | No explicit re-auth on reconnect (token from `getAccessToken()` at time of `useEffect` re-run) |
| Max retries | 10 (via Transport) | **Unlimited** |
| Normal closure handling | Close with reason | `ev.code === 1000` skip reconnect |
| Cleanup on disable | `close()` permanently | `intentionalCloseRef = true` |

**Key Issue**: Desktop's `useHubWebSocket` reconnects with exponential backoff but has no max retry limit. It will retry forever, which could cause issues if the token is invalid or the server is permanently down.

**Key Issue**: Desktop's reconnection relies on React re-rendering the `useEffect` (via state change), which means a reconnect is triggered by `setConnected(false)` in the timeout callback. This is fragile -- if the component doesn't re-render for some reason, reconnection will stall.

### 4.3 Event Handling Architecture

- **Web**: Sophisticated typed handler system with `on(type, handler)` subscriptions, `onAny` catch-all, and per-event-type routing. Auth-protected (drops application events before auth).
- **Desktop**: Simpler model -- exposes `lastEvent` state + `connected` boolean. The parent component (`useDesktopWorkbenchModel`) uses a `useEffect` with a switch statement on `lastEvent.type` to invalidate React Query caches. Much less granular -- no per-type subscription support.

---

## 5. Missing Methods Inventory (Summary)

### Web is missing these hubClient methods (present in Desktop):

| Priority | Method | Impact |
|----------|--------|--------|
| **HIGH** | `removeAgentTeamMember` | Web cannot remove members from agent teams |
| **HIGH** | `getAgentProfile` | Web cannot fetch a single agent profile by ID |
| **MEDIUM** | `postTeamRouteDecision` | Web cannot participate in team coordinator routing |
| **MEDIUM** | `createExecutionTarget` | Web cannot create execution targets |
| **MEDIUM** | `updateExecutionTarget` | Web cannot update execution targets |
| **LOW** | `listDocuments` / `getDocument` / `createDocument` / `updateDocument` / `deleteDocument` | Web has no Document CRUD -- intentional design gap (Documents are desktop-oriented) |
| **LOW** | `fetchSettings` / `patchSettings` | Web has no settings API |
| **N/A** | `streamTaskEvent` | Edge-specific, desktop-only by design |

### Desktop is missing these hubClient methods (present in Web):

| Priority | Method | Impact |
|----------|--------|--------|
| **MEDIUM** | `listTaskRunEvents` | Desktop cannot replay individual task events from Hub |
| **MEDIUM** | `listTaskApprovals` | Desktop cannot list task approvals from Hub |
| **MEDIUM** | `decideTaskApproval` | Desktop cannot decide on task approvals via Hub |
| **MEDIUM** | `listTaskArtifacts` | Desktop cannot list task artifacts from Hub |

**Verdict**: Desktop's missing methods are by design -- it handles tasks through local Edge. However, if Desktop ever needs to review tasks that ran on another device, these endpoints become necessary.

---

## 6. Recommendations for Code Sharing (moving to `@shared/`)

### 6.1 Strong candidates for `@shared/api/`

| Item | Current Location(s) | Rationale |
|------|-------------------|-----------|
| **Type definitions** (90% of both `hubClient.ts` files) | `web/src/api/hubClient.ts` lines 1-797, `desktop/src/api/hubClient.ts` lines 1-803 | ~700 lines of identical interfaces. Move to `@shared/api/hubTypes.ts` |
| **Error classes** (`HubError`) | Both `hubClient.ts` files | Identical. Move to `@shared/api/hubError.ts` |
| **Response envelope logic** (`isHubEnvelope`, `isSharedErrorBody`, `readJsonBody`) | Both `hubClient.ts` files | Identical. Move to `@shared/api/hubResponse.ts` |
| **Query string helper** (`qs`) | Both `hubClient.ts` files | Identical. Move to `@shared/api/queryParams.ts` |

### 6.2 Moderate candidates (need API shape design)

| Item | Notes |
|------|-------|
| **Core `createHubClient` factory skeleton** | The `request()` function, error handling, and envelope unwrapping are identical. Only the returned method list differs. Could share a base factory that each platform extends. |
| **Agent team queries share ~80% logic** | Both `agentTeamQueries.ts` files have the same `fetchAgentTeamOverview`, `newestRun`, `detailFallback` functions. The `AgentTeamOverview` type differs slightly (Desktop adds `customAgents`). |
| **Contact/workspace-project queries** | Desktop's `hubQueries.ts` is essentially a superset of Web's `contactQueries.ts` pattern. Could share a base query-key factory. |

### 6.3 Should remain platform-specific

| Item | Why |
|------|-----|
| **`streamTaskEvent`** (Desktop) | Edge-specific lifecycle |
| **`listDocuments`** CRUD (Desktop) | Document management is Desktop-only for now |
| **`listTaskRunEvents`** / approvals / artifacts (Web) | Web-specific task replay |
| **`hubWS.ts`** (Web) | Typed subscription model differs from Desktop's `lastEvent` pattern |
| **`useHubWebSocket.ts`** (Desktop) | Tightly coupled to React state model |
| **Platform adapters** | Different runtime environments (browser vs Tauri) |

### 6.4 Quick Wins (low effort, high impact)

1. **Create `@shared/api/hubTypes.ts`**: Extract all 60+ interfaces from both hubClient files into one shared types file. Both platforms import from the same source. Eliminates ~1400 lines of duplicate type definitions.

2. **Create `@shared/api/hubEvents.ts` update**: Add the 10 missing event types (`typing`, `message.edited`, `message.reaction_added`, `message.reaction_removed`, `team.run.started`, `team.run.event`, `team.assignment.done`, `team.assignment.failed`, `auth.fail`) that Desktop already uses but shared constants don't include.

3. **Standardize query key prefixes**: Currently Web uses `['web-v4', ...]` and Desktop uses `['hub', ...]`. These should use a shared prefix like `['agenthub', ...]` with platform suffixes: `['agenthub', 'web-v4', 'contacts']` and `['agenthub', 'desktop', 'contacts']`.

4. **Add `removeAgentTeamMember` to Web hubClient**: Missing API that blocks team member removal from the Web UI.

5. **Fix `getTaskRunEventSummary` URL path**: Desktop uses `/events/summary`, Web uses `/summary`. Verify which one the server expects and align.

6. **Add `staleTime` to Desktop session queries**: Desktop session/message/notification queries lack `staleTime` configuration, relying solely on WebSocket invalidation. Adding a `staleTime: 10_000` would provide a backup freshness guarantee.

7. **Fix Web `useThreadMessages` enabled condition**: `!!getAccessToken()` is evaluated once at mount. Should use a reactive value (like `useHubStore` selector) to enable when token becomes available.

---

## 7. Risk Assessment

| Risk | Severity | Description |
|------|----------|-------------|
| **Return type mismatch for `createPrivateSession` / `createGroupSession`** | **Medium** | Web's `contactQueries.ts` line 118 does `res.session_id`; if server returns a full `Session` object, `session_id` may be `undefined` (Desktop's `Session` type has `session_id?: string` while `id: string`). Web is reading `.session_id` but maybe should read `.id` or the response wrapper. |
| **`addAgentToSession` return type divergence** | **Medium** | Web depends on `agentInstance.id` from the response. Desktop treats as fire-and-forget. If the server stops returning `AgentInstance`, Web's `ensureMentionedAgentInstance` will break. |
| **`searchUser` param handling** | **Low** | Web uses `?id=`, Desktop uses `?id=`. Both identical. OK. |
| **Missing WebSocket reconnection cap (Desktop)** | **Low** | Desktop retries indefinitely. If server is permanently down, this wastes resources. Web caps at 10 retries via Transport. |
| **Desktop mutations use `onSuccess` not `onSettled`** | **Low** | Desktop hooks use `onSuccess` for invalidation. If a mutation fails, stale data won't be refetched (already correct -- there was no change). This is fine but differs from Web's defensive `onSettled`. |
