// React Query hooks for workspace project threads and messages.
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

// ── Project Threads ───────────────────────────────────────────────

export function useHubProjectThreads(projectId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['hub', 'projects', projectId, 'threads'],
    queryFn: () => getHubClient().listWorkspaceProjectThreads(projectId),
    enabled: opts?.enabled ?? false,
  });
}

export function useHubCreateProjectThread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      data,
    }: {
      projectId: string;
      data: Parameters<ReturnType<typeof getHubClient>['createWorkspaceProjectThread']>[1];
    }) => getHubClient().createWorkspaceProjectThread(projectId, data),
    onSuccess: (_result, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: ['hub', 'projects', projectId, 'threads'] });
    },
  });
}

// ── Project Thread Messages ───────────────────────────────────────

export function useHubProjectThreadMessages(
  projectId: string,
  threadId: string,
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['hub', 'projects', projectId, 'threads', threadId, 'messages'],
    queryFn: () =>
      getHubClient().listWorkspaceProjectThreadMessages(projectId, threadId),
    enabled: opts?.enabled ?? false,
  });
}

export function useHubSendProjectThreadMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      threadId,
      data,
    }: {
      projectId: string;
      threadId: string;
      data: Parameters<ReturnType<typeof getHubClient>['sendWorkspaceProjectThreadMessage']>[2];
    }) => getHubClient().sendWorkspaceProjectThreadMessage(projectId, threadId, data),
    onSuccess: (_result, { projectId, threadId }) => {
      void queryClient.invalidateQueries({
        queryKey: ['hub', 'projects', projectId, 'threads', threadId, 'messages'],
      });
    },
  });
}
