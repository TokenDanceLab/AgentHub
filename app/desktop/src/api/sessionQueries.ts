// React Query hooks for Hub sessions, messages, and notifications.
// Thin wrappers around hubClient methods.

import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { hubQueryKeys } from '@shared/stores/queryKeys';
import { createHubClient } from '@/api/hubClient';
import { getAccessToken } from '@/hooks/useAuth';

// ── Cache keys (#2252) ───────────────────────────────────────────
//
// Transcripts live in the shared SSOT threads family
// (`hubQueryKeys.threads.messages`), which is what `hubEventBridge` invalidates
// on every MESSAGE_* frame and what `resyncMessagesAfterReconnect` scans after
// a reconnect/gap. They used to live under the `['hub','sessions']` prefix
// below, so all six bridge invalidations and the resync discovery missed them
// — peer messages never refreshed and reconnect resync was a silent no-op.
//
// `hubSessionsListKey` is the *session list* only (`useHubSessions`); it is not
// a transcript key and no longer covers transcripts by prefix.
const hubSessionsListKey = ['hub', 'sessions'] as const;

/**
 * Broad invalidation for the message-mutating wrappers below. They only know a
 * messageId (recall/edit) or a set of *target* sessions (forward), so they
 * cannot build a per-session transcript key. One prefix no longer covers both
 * caches: the session list (unread counts, ordering) lives under
 * `hubSessionsListKey` while transcripts live under `hubQueryKeys.threads.root`
 * — invalidating only the former would leave the transcript stale after the
 * user's own recall/edit/pin/forward.
 */
function invalidateSessionsAndTranscripts(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: hubSessionsListKey }).catch(() => {
    /* non-fatal */
  });
  void queryClient.invalidateQueries({ queryKey: hubQueryKeys.threads.root }).catch(() => {
    /* non-fatal */
  });
}

// Lazy singleton — avoids creating the client on module load when Hub is not needed.
let _hubClient: ReturnType<typeof createHubClient> | null = null;
function getHubClient() {
  if (!_hubClient) _hubClient = createHubClient({ getToken: getAccessToken });
  return _hubClient;
}

// ── Sessions ─────────────────────────────────────────────────────

export function useHubSessions(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: hubSessionsListKey,
    queryFn: () => getHubClient().listSessions(),
    enabled: opts?.enabled ?? false,
  });
}

// ── Messages ─────────────────────────────────────────────────────

export function useHubMessages(sessionId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    // SSOT key (#2252): matches hubEventBridge's MESSAGE_* invalidations, the
    // useHubEventStream reconnect backfill and the shared resync discovery.
    queryKey: hubQueryKeys.threads.messages(sessionId),
    queryFn: () => getHubClient().getMessages(sessionId),
    enabled: opts?.enabled ?? false,
  });
}

/**
 * Pinned messages for a session — GET /client/sessions/{id}/pins.
 * Query key matches the invalidation hubEventBridge fires on
 * MESSAGE_PIN / MESSAGE_UNPIN (hubQueryKeys.threads.pins).
 * The returned message list is the server-authoritative pin set and is used
 * to seed the pinMap store (useDesktopWorkbenchModel).
 */
export function useHubPinnedMessages(sessionId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['hub', 'threads', sessionId, 'pins'],
    queryFn: () => getHubClient().listPinnedMessages(sessionId),
    enabled: opts?.enabled ?? false,
  });
}

export function useHubSendMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      data,
    }: {
      sessionId: string;
      data: Parameters<ReturnType<typeof getHubClient>['sendMessage']>[1];
    }) => getHubClient().sendMessage(sessionId, data),
    onSuccess: (_result, { sessionId }) => {
      void queryClient.invalidateQueries({
        queryKey: hubQueryKeys.threads.messages(sessionId),
      });
    },
  });
}

export function useHubMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, lastReadSeq }: { sessionId: string; lastReadSeq: number }) =>
      getHubClient().markRead(sessionId, lastReadSeq),
    onSuccess: () => {
      invalidateSessionsAndTranscripts(queryClient);
    },
  });
}

export function useHubRecallMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => getHubClient().recallMessage(messageId),
    onSuccess: () => {
      invalidateSessionsAndTranscripts(queryClient);
    },
  });
}

export function useHubEditMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      messageId,
      data,
    }: {
      messageId: string;
      data: Parameters<ReturnType<typeof getHubClient>['editMessage']>[1];
    }) => getHubClient().editMessage(messageId, data),
    onSuccess: () => {
      invalidateSessionsAndTranscripts(queryClient);
    },
  });
}

export function useHubPinMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, sessionId }: { messageId: string; sessionId: string }) =>
      getHubClient().pinMessage(messageId, sessionId),
    onSuccess: () => {
      invalidateSessionsAndTranscripts(queryClient);
    },
  });
}

export function useHubUnpinMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, sessionId }: { messageId: string; sessionId: string }) =>
      getHubClient().unpinMessage(messageId, sessionId),
    onSuccess: () => {
      invalidateSessionsAndTranscripts(queryClient);
    },
  });
}

/**
 * Forward a message into other Hub sessions (#2241).
 *
 * Thin wrapper over the shared `hubClient.forwardMessage(messageId,
 * targetSessionIds)` — the REST call already existed, only the Desktop query
 * wrapper was missing, which is why the transcript menu's forward entry had to
 * stay hidden after #2154 made the menu fail-closed per handler.
 *
 * Same shape as the pin/unpin/recall wrappers above: the caller passes the
 * bare Hub message id (App.tsx strips the `hub-message-` transcript block
 * prefix) and success invalidates the session list so the forwarded message
 * shows up in the target conversations. Web does the same through its own
 * mutation (`useWebWorkbenchModel.forwardMessageMut`) — one shared REST
 * contract, no per-client fork.
 */
export function useHubForwardMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, targetSessionIds }: { messageId: string; targetSessionIds: string[] }) =>
      getHubClient().forwardMessage(messageId, targetSessionIds),
    onSuccess: () => {
      invalidateSessionsAndTranscripts(queryClient);
    },
  });
}
