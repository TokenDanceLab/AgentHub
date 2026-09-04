// Centralized query key factory for AgentHub frontend queries.
// Defines stable, documented query key patterns for both Hub (web/desktop)
// and Edge (desktop-local) data sources.
//
// Usage:
//   import { hubQueryKeys, edgeQueryKeys } from '@agenthub/shared/stores/queryKeys';
//   useQuery({ queryKey: hubQueryKeys.projects.list() });
//   queryClient.invalidateQueries({ queryKey: hubQueryKeys.threads.root });

// ── Hub query key factory ──────────────────────────────────────────

export const hubQueryKeys = {
  // Auth / user profile
  auth: {
    user: ['hub', 'auth', 'user'] as const,
    profile: (userId: string) => ['hub', 'auth', 'profile', userId] as const,
  },

  // Threads (sessions)
  // Canonical key shape (ADR-029 / #2261):
  //   - `root` is an INVALIDATION PREFIX ONLY. It must never be the queryKey of
  //     a live query: web used it as its session-list key while desktop used the
  //     same prefix for transcripts, so "refresh the session list" and "refresh
  //     one transcript" meant opposite things in the two shells.
  //   - the collection query uses `list`; a per-thread sub-resource uses
  //     `messages`/`pins` and always has a factory (no literal keys at call
  //     sites);
  //   - a factory with no consumer must not exist. `detail` was deleted for
  //     exactly that reason: 0 useQuery consumers against 9 production
  //     invalidation sites, and `['hub','threads','detail',id]` is not a prefix
  //     of `['hub',id,'messages']`, so all 9 matched no cache entry at all —
  //     the same failure mode as #2252, one key over. Do not reintroduce it
  //     without a real thread-detail query to consume it.
  threads: {
    root: ['hub', 'threads'] as const,
    list: ['hub', 'threads', 'list'] as const,
    messages: (threadId: string) => ['hub', 'threads', threadId, 'messages'] as const,
    pins: (threadId: string) => ['hub', 'threads', threadId, 'pins'] as const,
  },

  // Agents / profiles
  agents: {
    root: ['hub', 'agents'] as const,
    list: (context: 'hub' | 'signed-out' = 'hub') => ['hub', 'agents', context] as const,
    detail: (agentId: string) => ['hub', 'agents', 'detail', agentId] as const,
  },

  // Agent teams
  agentTeams: {
    root: ['hub', 'agent-teams'] as const,
    list: (context: 'hub' | 'signed-out' = 'hub') =>
      ['hub', 'agent-teams', context] as const,
    detail: (teamId: string) =>
      ['hub', 'agent-teams', 'detail', teamId] as const,
    runs: (teamId: string) =>
      ['hub', 'agent-teams', teamId, 'runs'] as const,
    runDetail: (teamId: string, runId: string) =>
      ['hub', 'agent-teams', teamId, 'runs', runId] as const,
    runState: (teamId: string, runId: string) =>
      ['hub', 'agent-teams', teamId, 'runs', runId, 'state'] as const,
    runEvents: (teamId: string, runId: string) =>
      ['hub', 'agent-teams', teamId, 'runs', runId, 'events'] as const,
    runTasks: (teamId: string, runId: string) =>
      ['hub', 'agent-teams', teamId, 'runs', runId, 'tasks'] as const,
    // Token/cost board (#1819): aggregates every team's runs client-side.
    usageBoard: ['hub', 'agent-teams', 'usage-board'] as const,
  },

  // Workspace projects
  projects: {
    root: ['hub', 'projects'] as const,
    list: (context: 'hub' | 'signed-out' = 'hub') =>
      ['hub', 'projects', context] as const,
    detail: (projectId: string) =>
      ['hub', 'projects', projectId] as const,
    threads: (projectId: string) =>
      ['hub', 'projects', projectId, 'threads'] as const,
    threadMessages: (projectId: string, threadId: string) =>
      ['hub', 'projects', projectId, 'threads', threadId, 'messages'] as const,
  },

  // Execution targets
  executionTargets: {
    root: ['hub', 'execution-targets'] as const,
    list: (context: 'hub' | 'signed-out' = 'hub') =>
      ['hub', 'execution-targets', context] as const,
    detail: (targetId: string) =>
      ['hub', 'execution-targets', 'detail', targetId] as const,
  },

  // Contacts / friends
  contacts: {
    root: ['hub', 'contacts'] as const,
    list: ['hub', 'contacts', 'list'] as const,
    friendRequests: ['hub', 'contacts', 'friend-requests'] as const,
  },

  // Notifications
  notifications: {
    root: ['hub', 'notifications'] as const,
    list: (unreadOnly?: boolean) =>
      unreadOnly
        ? (['hub', 'notifications', 'unread'] as const)
        : (['hub', 'notifications', 'all'] as const),
  },

  // Custom agents (shared between teams and profiles)
  customAgents: {
    root: ['hub', 'custom-agents'] as const,
    list: ['hub', 'custom-agents', 'list'] as const,
  },

  // Skills / MCP servers (catalog)
  catalog: {
    skills: ['hub', 'catalog', 'skills'] as const,
    mcpServers: ['hub', 'catalog', 'mcp-servers'] as const,
  },

  // Audit events
  auditEvents: {
    root: ['hub', 'audit-events'] as const,
  },

  // Relay commands
  relayCommands: {
    root: ['hub', 'relay-commands'] as const,
    detail: (commandId: string) => ['hub', 'relay-commands', commandId] as const,
  },

  // Runs (Hub-originated — web preview runs, workspace runs)
  runs: {
    root: ['hub', 'runs'] as const,
    all: (projectId?: string, threadId?: string) =>
      projectId || threadId
        ? (['hub', 'runs', projectId ?? '', threadId ?? ''] as const)
        : (['hub', 'runs'] as const),
    detail: (runId: string) => ['hub', 'runs', 'detail', runId] as const,
  },

} as const;

// ── Web app-scoped query key factory (`web-v4` namespace) ─────────
//
// Web does not cache Hub collections under `hubQueryKeys`: it versions its own
// cache namespace (`web-v4`) so a Web-only cache reset never has to touch the
// keys Desktop shares, and so `hubReady` can live *inside* the key — flipping
// it on logout yields a different key, so signed-out UI cannot keep showing
// signed-in data (a bare `enabled: false` would leave the old entry cached).
//
// Canonical rules (ADR-029 / #2261 residual, landed here):
//   - this factory is the ONLY producer of `web-v4` literals. Call sites must
//     not write the array by hand: a hand-written invalidation key is exactly
//     how `['web-v4','contacts']` / `['hub','contacts','list']` / `['agent-teams']`
//     came to invalidate caches that no query ever wrote (#2252 and #2310 are
//     the same failure mode on other platforms).
//   - `*.root` is an invalidation prefix only, never a live query's `queryKey`.
//   - a member with no query producer must not exist. Web has no notifications
//     query, no team-runs query and no `web-v4` execution-targets query, so
//     those keys are deliberately absent — the invalidations that used to name
//     them were dead and have been removed at the call site.
/**
 * A cache pointer that is legitimately *absent* while its query is disabled
 * (no active session / no active task). It is threaded through verbatim on
 * purpose: normalizing it to `''` would mint a string session id that
 * `webHubMessagesFamily.sessionIdOf` would then hand to the reconnect resync
 * as if it were a real session (#2252).
 */
export type QueryKeyPointer = string | null | undefined;

export const webQueryKeys = {
  authMe: ['web-v4', 'auth-me'] as const,
  publicSkills: (hubReady: boolean) => ['web-v4', 'public-skills', hubReady] as const,
  publicMcpServers: (hubReady: boolean) =>
    ['web-v4', 'public-mcp-servers', hubReady] as const,

  // Sessions (Web's session *list*; transcripts live under `messages` below so
  // that "refresh the list" and "refresh one transcript" stay distinguishable)
  sessions: {
    root: ['web-v4', 'hub-sessions'] as const,
    list: (hubReady: boolean) => ['web-v4', 'hub-sessions', hubReady] as const,
  },

  // Transcripts — see `webHubMessagesFamily` below for the resync contract.
  messages: {
    root: ['web-v4', 'hub-messages'] as const,
    of: (sessionId: QueryKeyPointer) => ['web-v4', 'hub-messages', sessionId] as const,
  },

  pins: {
    root: ['web-v4', 'hub-pins'] as const,
    of: (sessionId: QueryKeyPointer) => ['web-v4', 'hub-pins', sessionId] as const,
  },

  // Web's contact *list*. Friend requests stay under `hubQueryKeys.contacts`
  // because that is the key `useListFriendRequests` actually caches under.
  contacts: {
    root: ['web-v4', 'hub-contacts'] as const,
    list: (hubReady: boolean) => ['web-v4', 'hub-contacts', hubReady] as const,
  },

  documents: {
    root: ['web-v4', 'hub-documents'] as const,
    list: (hubReady: boolean) => ['web-v4', 'hub-documents', hubReady] as const,
  },

  // Agent task lifecycle. `active` is keyed by SESSION id, `index` by TASK id:
  // they are different identity domains (ADR-033) and both are written from
  // realtime frames, so neither may be derived from the other.
  agentTask: {
    active: (sessionId: QueryKeyPointer) => ['web-v4', 'active-agent-task', sessionId] as const,
    index: (taskId: QueryKeyPointer) => ['web-v4', 'agent-task-index', taskId] as const,
    events: (taskId: QueryKeyPointer) => ['web-v4', 'agent-task-events', taskId] as const,
    summary: (taskId: QueryKeyPointer) => ['web-v4', 'agent-task-summary', taskId] as const,
    approvals: (taskId: QueryKeyPointer) => ['web-v4', 'agent-task-approvals', taskId] as const,
    artifacts: (taskId: QueryKeyPointer) => ['web-v4', 'agent-task-artifacts', taskId] as const,
  },

  sessionAgentInstances: (sessionId: string) =>
    ['web-v4', 'session-agent-instances', sessionId] as const,
} as const;

// ── Hub transcript key family (#2252) ────────────────────────────
//
// `resyncMessagesAfterReconnect` must be able to find every cached transcript
// without hardcoding one key shape: Desktop caches transcripts under the SSOT
// threads family above, Web under its app-scoped `web-v4` namespace
// (app/web/src/platform/webPlatformMessageHelpers.ts). A family bundles the
// three things any transcript-cache consumer needs — the broad prefix to
// invalidate, the exact per-session key, and the reverse matcher that recovers
// the session id from a key found in the cache.
//
// Adding another transcript cache? Export a family next to the key factory
// that produces it and hand it to the resync helper. Do NOT teach the helper
// about literal key shapes: that is how #2101 G1/G4-② stayed a silent no-op on
// both platforms while every test using the literal shape passed.
export interface HubMessagesKeyFamily {
  /** Broad prefix covering every session's transcript — invalidation target. */
  readonly root: readonly unknown[];
  /** Exact query key holding one session's transcript array. */
  readonly of: (sessionId: string) => readonly unknown[];
  /** Session id a cached key holds a transcript for; null for any other key. */
  readonly sessionIdOf: (key: readonly unknown[]) => string | null;
}

/**
 * SSOT threads family: `['hub', 'threads', <sessionId>, 'messages']`.
 * Desktop's `useHubMessages` caches here and this is the resync default.
 */
export const hubThreadsMessagesFamily: HubMessagesKeyFamily = {
  root: hubQueryKeys.threads.root,
  of: (sessionId) => hubQueryKeys.threads.messages(sessionId),
  sessionIdOf: (key) =>
    key.length === 4 &&
    key[0] === 'hub' &&
    key[1] === 'threads' &&
    key[3] === 'messages' &&
    typeof key[2] === 'string'
      ? key[2]
      : null,
};

// ── Edge (local desktop) query key factory ─────────────────────────

export const edgeQueryKeys = {
  threads: {
    root: ['edge', 'threads'] as const,
    all: (projectId?: string) =>
      projectId
        ? (['edge', 'threads', projectId] as const)
        : (['edge', 'threads'] as const),
    items: (threadId?: string) => ['edge', 'threadItems', threadId] as const,
    pins: (threadId: string | null) => ['edge', 'threadPins', threadId] as const,
  },

  runs: {
    root: ['edge', 'runs'] as const,
    all: (projectId?: string, threadId?: string) =>
      (['edge', 'runs', projectId, threadId] as const),
  },

  agents: {
    root: ['edge', 'agents'] as const,
    list: ['edge', 'agents', 'list'] as const,
  },

  runners: {
    root: ['edge', 'runners'] as const,
    list: ['edge', 'runners', 'list'] as const,
    detail: (runnerId: string) => ['edge', 'runners', runnerId] as const,
  },

  // Health / connection
  health: {
    root: ['edge', 'health'] as const,
  },

  currentUser: {
    root: ['edge', 'currentUser'] as const,
  },
} as const;

// ── Helper: check if a query key matches a prefix ──────────────────

/** Check if `candidate` starts with `prefix` (deep prefix match). */
export function isQueryKeyPrefix(
  candidate: readonly unknown[],
  prefix: readonly unknown[],
): boolean {
  if (prefix.length > candidate.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (candidate[i] !== prefix[i]) return false;
  }
  return true;
}

/** Get a broad invalidation key (root prefix) from a specific query key. */
export function rootPrefix(key: readonly unknown[]): readonly unknown[] {
  // Return the first 2-3 segments as a broad invalidation target
  if (key.length <= 2) return key;
  return key.slice(0, 2);
}
