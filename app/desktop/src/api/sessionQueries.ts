// React Query hooks for Hub sessions, messages, and notifications.
// Thin wrappers around hubClient methods.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createHubClient } from '@/api/hubClient';
import { getAccessToken } from '@/hooks/useAuth';

// Lazy singleton — avoids creating the client on module load when Hub is not needed.
let _hubClient: ReturnType<typeof createHubClient> | null = null;
function getHubClient() {
  if (!_hubClient) _hubClient = createHubClient({ getToken: getAccessToken });
  return _hubClient;
}

// ── Sessions ─────────────────────────────────────────────────────

export function useHubSessions(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['hub', 'sessions'],
    queryFn: () => getHubClient().listSessions(),
    enabled: opts?.enabled ?? false,
  });
}

// ── Messages ─────────────────────────────────────────────────────

export function useHubMessages(sessionId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['hub', 'sessions', sessionId, 'messages'],
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
      void queryClient.invalidateQueries({ queryKey: ['hub', 'sessions', sessionId, 'messages'] });
    },
  });
}

export function useHubMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, lastReadSeq }: { sessionId: string; lastReadSeq: number }) =>
      getHubClient().markRead(sessionId, lastReadSeq),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hub', 'sessions'] });
    },
  });
}

export function useHubRecallMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => getHubClient().recallMessage(messageId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hub', 'sessions'] });
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
      void queryClient.invalidateQueries({ queryKey: ['hub', 'sessions'] });
    },
  });
}

export function useHubPinMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, sessionId }: { messageId: string; sessionId: string }) =>
      getHubClient().pinMessage(messageId, sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hub', 'sessions'] });
    },
  });
}

export function useHubUnpinMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, sessionId }: { messageId: string; sessionId: string }) =>
      getHubClient().unpinMessage(messageId, sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hub', 'sessions'] });
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
      void queryClient.invalidateQueries({ queryKey: ['hub', 'sessions'] });
    },
  });
}
