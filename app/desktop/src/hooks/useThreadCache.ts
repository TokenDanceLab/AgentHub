import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ListResponse, ThreadInfo } from '@shared/types';

export function useThreadCache() {
  const queryClient = useQueryClient();
  const pendingCreatedThreadIdsRef = useRef<Set<string>>(new Set());
  const emptyCreatedThreadIdsRef = useRef<Set<string>>(new Set());
  const manuallyNamedThreadIdsRef = useRef<Set<string>>(new Set());
  const silentCreatedThreadToastIdsRef = useRef<Set<string>>(new Set());

  const addThreadToCache = useCallback(
    (thread: ThreadInfo, opts?: { suppressCreatedToast?: boolean; empty?: boolean }) => {
      pendingCreatedThreadIdsRef.current.add(thread.threadId);
      if (opts?.empty) {
        emptyCreatedThreadIdsRef.current.add(thread.threadId);
      }
      if (opts?.suppressCreatedToast) {
        silentCreatedThreadToastIdsRef.current.add(thread.threadId);
      }
      queryClient.setQueriesData<ListResponse<ThreadInfo>>(
        { queryKey: ['threads'] },
        (current) => {
          if (!current) return current;
          if (current.items.some((item) => item.threadId === thread.threadId)) return current;
          return { ...current, items: [thread, ...current.items] };
        },
      );
    },
    [queryClient],
  );

  const updateThreadInCache = useCallback(
    (thread: ThreadInfo) => {
      queryClient.setQueriesData<ListResponse<ThreadInfo>>(
        { queryKey: ['threads'] },
        (current) => {
          if (!current) return current;
          let found = false;
          const items = current.items.map((item) => {
            if (item.threadId !== thread.threadId) return item;
            found = true;
            return { ...item, ...thread };
          });
          return { ...current, items: found ? items : [thread, ...items] };
        },
      );
    },
    [queryClient],
  );

  const setThreadTitleInCache = useCallback(
    (threadId: string, title: string) => {
      queryClient.setQueriesData<ListResponse<ThreadInfo>>(
        { queryKey: ['threads'] },
        (current) => {
          if (!current) return current;
          return {
            ...current,
            items: current.items.map((thread) =>
              thread.threadId === threadId ? { ...thread, title } : thread,
            ),
          };
        },
      );
    },
    [queryClient],
  );

  return {
    addThreadToCache,
    updateThreadInCache,
    setThreadTitleInCache,
    pendingCreatedThreadIdsRef,
    emptyCreatedThreadIdsRef,
    manuallyNamedThreadIdsRef,
    silentCreatedThreadToastIdsRef,
  } as const;
}
