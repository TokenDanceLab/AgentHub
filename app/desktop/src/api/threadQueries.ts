// TanStack Query hooks for thread CRUD.
// Replaces Zustand threadStore server-state reads and setInterval polling.
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  createThread,
  fetchThreadItems,
  fetchThreads,
  renameThread,
  deleteThread,
  type CreateThreadRequest,
} from './edgeClient';
import type { ListResponse, ThreadInfo, ThreadItemInfo } from '@shared/types';

export function useThreads(projectId?: string) {
  return useQuery<ListResponse<ThreadInfo>>({
    queryKey: ['threads', projectId],
    queryFn: () => fetchThreads(projectId),
    refetchInterval: 10_000,
  });
}

export function useThreadItems(threadId?: string) {
  return useQuery<ListResponse<ThreadItemInfo>>({
    enabled: Boolean(threadId),
    queryKey: ['threadItems', threadId],
    queryFn: () => {
      if (!threadId) throw new Error('threadId is required');
      return fetchThreadItems(threadId);
    },
    refetchInterval: 10_000,
  });
}

export function useRenameThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, title }: { threadId: string; title: string }) =>
      renameThread(threadId, title),
    onMutate: async ({ threadId, title }) => {
      await qc.cancelQueries({ queryKey: ['threads'] });
      const prev = snapshotThreadQueries(qc);
      updateThreadsInCache(qc, (thread) =>
        thread.threadId === threadId ? { ...thread, title } : thread,
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) restoreThreadQueries(qc, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['threads'] });
    },
  });
}

export function useDeleteThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) => deleteThread(threadId),
    onMutate: async (threadId) => {
      await qc.cancelQueries({ queryKey: ['threads'] });
      const prev = snapshotThreadQueries(qc);
      setThreadStatusInCache(qc, threadId, 'archived');
      return { prev };
    },
    onSuccess: (result, threadId) => {
      if (result !== 'deleted') return;
      updateThreadsInCache(qc, (thread) =>
        thread.threadId === threadId ? null : thread,
      );
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) restoreThreadQueries(qc, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['threads'] });
    },
  });
}

type ThreadQuerySnapshot = Array<[readonly unknown[], ListResponse<ThreadInfo> | undefined]>;

function snapshotThreadQueries(qc: QueryClient): ThreadQuerySnapshot {
  return qc.getQueriesData<ListResponse<ThreadInfo>>({ queryKey: ['threads'] });
}

function restoreThreadQueries(qc: QueryClient, snapshot: ThreadQuerySnapshot) {
  for (const [queryKey, value] of snapshot) {
    qc.setQueryData(queryKey, value);
  }
}

function updateThreadsInCache(
  qc: QueryClient,
  update: (thread: ThreadInfo) => ThreadInfo | null,
) {
  qc.setQueriesData<ListResponse<ThreadInfo>>({ queryKey: ['threads'] }, (current) => {
    if (!current) return current;
    return {
      ...current,
      items: current.items.flatMap((thread) => {
        const next = update(thread);
        return next ? [next] : [];
      }),
    };
  });
}

function setThreadStatusInCache(
  qc: QueryClient,
  threadId: string,
  status: 'active' | 'archived',
) {
  updateThreadsInCache(qc, (thread) =>
    thread.threadId === threadId ? { ...thread, status } : thread,
  );
}

export function useArchiveThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) => archiveThread(threadId),
    onMutate: async (threadId) => {
      await qc.cancelQueries({ queryKey: ['threads'] });
      const prev = snapshotThreadQueries(qc);
      setThreadStatusInCache(qc, threadId, 'archived');
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) restoreThreadQueries(qc, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['threads'] });
    },
  });
}

export function useRestoreThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) => updateThreadStatus(threadId, 'active'),
    onMutate: async (threadId) => {
      await qc.cancelQueries({ queryKey: ['threads'] });
      const prev = snapshotThreadQueries(qc);
      setThreadStatusInCache(qc, threadId, 'active');
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) restoreThreadQueries(qc, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['threads'] });
    },
  });
}

export function useCreateThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateThreadRequest | undefined) =>
      createThread(request),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['threads'] });
    },
  });
}

export function useThreadMessages(threadId: string | null) {
  return useQuery({
    queryKey: ['threadItems', threadId],
    queryFn: () => {
      if (!threadId) throw new Error('threadId is required');
      return fetchThreadItems(threadId);
    },
    enabled: !!threadId,
    staleTime: 5_000,
  });
}
