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

export function useHubSearchSessions() {
  return useMutation({
    mutationFn: (query: Parameters<ReturnType<typeof getHubClient>['searchSessions']>[0]) =>
      getHubClient().searchSessions(query),
  });
}

export function useHubCreatePrivateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: Parameters<ReturnType<typeof getHubClient>['createPrivateSession']>[0]) =>
      getHubClient().createPrivateSession(userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hub', 'sessions'] });
    },
  });
}

export function useHubCreateGroupSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<ReturnType<typeof getHubClient>['createGroupSession']>[0]) =>
      getHubClient().createGroupSession(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hub', 'sessions'] });
    },
  });
}

export function useHubAddSessionMembers() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, memberIds }: { sessionId: string; memberIds: string[] }) =>
      getHubClient().addSessionMembers(sessionId, memberIds),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hub', 'sessions'] });
    },
  });
}

export function useHubRemoveSessionMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, userId }: { sessionId: string; userId: string }) =>
      getHubClient().removeSessionMember(sessionId, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hub', 'sessions'] });
    },
  });
}

export function useHubLeaveSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => getHubClient().leaveSession(sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hub', 'sessions'] });
    },
  });
}

export function useHubTransferSessionOwnership() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, newOwnerId }: { sessionId: string; newOwnerId: string }) =>
      getHubClient().transferSessionOwnership(sessionId, newOwnerId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hub', 'sessions'] });
    },
  });
}

export function useHubDissolveSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => getHubClient().dissolveSession(sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hub', 'sessions'] });
    },
  });
}

export function useHubUpdateSessionInfo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, data }: { sessionId: string; data: Parameters<ReturnType<typeof getHubClient>['updateSessionInfo']>[1] }) =>
      getHubClient().updateSessionInfo(sessionId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hub', 'sessions'] });
    },
  });
}

export function useHubDeleteSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => getHubClient().deleteSession(sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hub', 'sessions'] });
    },
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

export function useHubSendMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, data }: { sessionId: string; data: Parameters<ReturnType<typeof getHubClient>['sendMessage']>[1] }) =>
      getHubClient().sendMessage(sessionId, data),
    onSuccess: (_result, { sessionId }) => {
      void queryClient.invalidateQueries({ queryKey: ['hub', 'sessions', sessionId, 'messages'] });
    },
  });
}

export function useHubSyncMessages() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, params }: { sessionId: string; params?: Parameters<ReturnType<typeof getHubClient>['syncMessages']>[1] }) =>
      getHubClient().syncMessages(sessionId, params),
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
    mutationFn: ({ messageId, data }: { messageId: string; data: Parameters<ReturnType<typeof getHubClient>['editMessage']>[1] }) =>
      getHubClient().editMessage(messageId, data),
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

export function useHubSearchMessages() {
  return useMutation({
    mutationFn: (query: Parameters<ReturnType<typeof getHubClient>['searchMessages']>[0]) =>
      getHubClient().searchMessages(query),
  });
}

export function useHubAddReaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, sessionId, emoji }: { messageId: string; sessionId: string; emoji: string }) =>
      getHubClient().addMessageReaction(messageId, sessionId, { emoji }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hub', 'sessions'] });
    },
  });
}

export function useHubRemoveReaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, sessionId, emoji }: { messageId: string; sessionId: string; emoji: string }) =>
      getHubClient().removeMessageReaction(messageId, sessionId, { emoji }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hub', 'sessions'] });
    },
  });
}

export function useHubListReactions() {
  return useMutation({
    mutationFn: ({ messageId, sessionId }: { messageId: string; sessionId: string }) =>
      getHubClient().listMessageReactions(messageId, sessionId),
  });
}

// ── Notifications ────────────────────────────────────────────────

export function useHubNotifications(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['hub', 'notifications'],
    queryFn: () => getHubClient().listNotifications(),
    enabled: opts?.enabled ?? false,
  });
}

export function useHubMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notifId: string) => getHubClient().markNotificationRead(notifId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hub', 'notifications'] });
    },
  });
}

export function useHubReadAllNotifications() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => getHubClient().readAllNotifications(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hub', 'notifications'] });
    },
  });
}
