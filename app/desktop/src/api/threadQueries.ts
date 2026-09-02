// TanStack Query hooks for thread CRUD.
// Replaces Zustand threadStore server-state reads and setInterval polling.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createThread,
  fetchThreadItems,
  fetchThreadPins,
  fetchThreads,
  fetchCurrentUser,
  type CreateThreadRequest,
} from './edgeClient';
import { edgeQueryKeys } from '@shared/stores/queryKeys';
import type { ListResponse, ThreadInfo, ThreadPinInfo, UserProfileInfo } from '@shared/types';

export function useThreads(projectId?: string, options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  return useQuery<ListResponse<ThreadInfo>>({
    queryKey: edgeQueryKeys.threads.all(projectId),
    queryFn: () => fetchThreads(projectId),
    enabled,
    refetchInterval: enabled ? 10_000 : false,
  });
}

export function useCreateThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateThreadRequest | undefined) =>
      createThread(request),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: edgeQueryKeys.threads.root });
    },
  });
}

export function useThreadMessages(threadId: string | null) {
  return useQuery({
    queryKey: edgeQueryKeys.threads.items(threadId ?? undefined),
    queryFn: () => {
      if (!threadId) throw new Error('threadId is required');
      return fetchThreadItems(threadId);
    },
    enabled: !!threadId,
    staleTime: 5_000,
    refetchInterval: 5_000,
  });
}

export function useThreadPins(threadId: string | null) {
  return useQuery<ListResponse<ThreadPinInfo>>({
    queryKey: edgeQueryKeys.threads.pins(threadId),
    queryFn: () => {
      if (!threadId) throw new Error('threadId is required');
      return fetchThreadPins(threadId);
    },
    enabled: !!threadId && threadId !== 'thread_local',
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
}

export function useCurrentUser(enabled = true) {
  return useQuery<UserProfileInfo>({
    queryKey: edgeQueryKeys.currentUser.root,
    queryFn: () => fetchCurrentUser(),
    enabled,
    staleTime: 60_000,
    retry: 1,
  });
}
