// TanStack Query hooks for thread CRUD.
// Replaces Zustand threadStore server-state reads and setInterval polling.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchThreads,
  fetchThreadItems,
  createThread,
  renameThread,
  deleteThread,
} from './edgeClient';
import type { ListResponse, ThreadInfo } from '@shared/types';

export function useThreads(projectId?: string) {
  return useQuery<ListResponse<ThreadInfo>>({
    queryKey: ['threads', projectId],
    queryFn: () => fetchThreads(projectId),
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
      const prev = qc.getQueryData<ListResponse<ThreadInfo>>(['threads']);
      if (prev) {
        qc.setQueryData<ListResponse<ThreadInfo>>(['threads'], {
          ...prev,
          items: prev.items.map((t) =>
            t.threadId === threadId ? { ...t, title } : t,
          ),
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['threads'], ctx.prev);
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
      const prev = qc.getQueryData<ListResponse<ThreadInfo>>(['threads']);
      if (prev) {
        qc.setQueryData<ListResponse<ThreadInfo>>(['threads'], {
          ...prev,
          items: prev.items.filter((t) => t.threadId !== threadId),
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['threads'], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['threads'] });
    },
  });
}

export function useCreateThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ title, threadId }: { title?: string; threadId?: string }) =>
      createThread(title, threadId),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['threads'] });
    },
  });
}

export function useThreadMessages(threadId: string | null) {
  return useQuery({
    queryKey: ['threadItems', threadId],
    queryFn: () => fetchThreadItems(threadId!),
    enabled: !!threadId,
    staleTime: 5_000,
  });
}
