// Centralized query key factory for AgentHub frontend queries.
// Defines stable, documented query key patterns for both Hub (web/desktop)
// and Edge (desktop-local) data sources.
//
// Usage:
//   import { hubQueryKeys, edgeQueryKeys } from '@agenthub/shared/stores/queryKeys';
//   useQuery({ queryKey: hubQueryKeys.threads.all(projectId) });
//   queryClient.invalidateQueries({ queryKey: hubQueryKeys.threads.root });

// ── Hub query key factory ──────────────────────────────────────────

export const hubQueryKeys = {
  // Auth / user profile
  auth: {
    user: ['hub', 'auth', 'user'] as const,
    profile: (userId: string) => ['hub', 'auth', 'profile', userId] as const,
  },

  // Threads (sessions)
  threads: {
    root: ['hub', 'threads'] as const,
    all: (projectId?: string) =>
      projectId
        ? (['hub', 'threads', projectId] as const)
        : (['hub', 'threads'] as const),
    detail: (threadId: string) => ['hub', 'threads', 'detail', threadId] as const,
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
