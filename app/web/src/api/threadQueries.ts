import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createHubClient } from './hubClient';
import { getAccessToken } from '@/hooks/useAuth';
import { useHubStore } from '@/stores/hubStore';
import { hubQueryKeys } from '@shared/stores/queryKeys';
import { hubMessageToChatMessage, sessionToThreadInfo } from '@/utils/hubAdapters';
import type { ListResponse, ThreadInfo } from '@shared/types';

const hubClient = createHubClient({ getToken: getAccessToken });

function page<T>(items: T[]): ListResponse<T> {
  return { items, page: { hasMore: false } };
}

export function useThreads(projectId?: string) {
  const authenticated = useHubStore((s) => s.authenticated);
  return useQuery<ListResponse<ThreadInfo>>({
    queryKey: hubQueryKeys.threads.all(projectId),
    queryFn: async () => {
      if (!authenticated || !getAccessToken()) return page([]);
      const sessions = await hubClient.listSessions();
      const items = sessions
        .map(sessionToThreadInfo)
        .filter((thread) => !projectId || thread.projectId === projectId);
      return page(items);
    },
    refetchInterval: authenticated ? 10_000 : false,
    placeholderData: (prev) => prev,
  });
}

export function useRenameThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, title }: { threadId: string; title: string }) =>
      hubClient.updateSessionInfo(threadId, { name: title }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: hubQueryKeys.threads.root });
    },
  });
}

export function useDeleteThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) => hubClient.deleteSession(threadId),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: hubQueryKeys.threads.root });
    },
  });
}

export function useCreateThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ title }: { title?: string; threadId?: string }) => {
      const created = await hubClient.createGroupSession({
        name: title?.trim() || 'AgentHub workspace',
        member_ids: [],
      });
      const now = new Date().toISOString();
      return {
        threadId: created.session_id,
        projectId: 'hub',
        title: title?.trim() || 'AgentHub workspace',
        status: created.type,
        sessionType: created.type,
        createdAt: now,
        updatedAt: now,
      };
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: hubQueryKeys.threads.root });
      void qc.invalidateQueries({ queryKey: hubQueryKeys.contacts.root });
    },
  });
}

export function useThreadMessages(threadId: string | null) {
  return useQuery({
    queryKey: hubQueryKeys.threads.messages(threadId ?? ''),
    queryFn: async () => {
      const messages = await hubClient.getMessages(threadId!, { limit: 80 });
      return page(
        messages.map((message) => {
          const converted = hubMessageToChatMessage(message);
          return {
            id: converted.id,
            role: converted.role,
            content: converted.blocks
              .filter((block) => block.kind === 'text' || block.kind === 'code')
              .map((block) => block.content)
              .join('\n'),
            timestamp: converted.timestamp,
          };
        }),
      );
    },
    enabled: !!threadId && !!getAccessToken(),
    staleTime: 5_000,
  });
}
