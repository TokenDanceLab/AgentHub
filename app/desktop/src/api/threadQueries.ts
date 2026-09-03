// TanStack Query hooks for thread CRUD.
// Replaces Zustand threadStore server-state reads and setInterval polling.
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  createThread,
  fetchThreadItems,
  fetchThreadPins,
  fetchThreads,
  fetchCurrentUser,
  type CreateThreadRequest,
} from './edgeClient';
import { edgeQueryKeys, rootPrefix } from '@shared/stores/queryKeys';
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
    mutationFn: (request: CreateThreadRequest | undefined) => createThread(request),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: edgeQueryKeys.threads.root });
    },
  });
}

/**
 * Invalidate the Edge thread-transcript cache that `useThreadMessages` fills.
 *
 * This helper exists because `edgeQueryKeys.threads.root` (`['edge','threads']`)
 * is **not** a prefix of the transcript key (`['edge','threadItems',<id>]`) or of
 * the pins key (`['edge','threadPins',<id>]`): the Edge family keeps its
 * sub-resources in their own top-level namespaces, unlike the hub family where
 * `['hub','threads']` really does prefix everything. So
 * `invalidateQueries({ queryKey: edgeQueryKeys.threads.root })` refreshes the
 * thread *list* and nothing else, and every call site that also meant "the
 * transcript changed" was a silent partial no-op (#2274 A-12) — including
 * `useDecideEdgePermission`, whose own doc comment says the invalidation exists
 * to close the replay gap "when the persisted transcript is reloaded".
 *
 * The bare literal `['threadItems', <id>]` that App.tsx used was worse: it is
 * missing the `'edge'` segment, so it matched no cache entry at all — three
 * dead invalidations, two of which were deliberate 2s/4s compensations written
 * specifically to pick up an agent's async response (#2274 A-13). Both defects
 * are bounded in production by `useThreadMessages`' `refetchInterval: 5_000`,
 * which is exactly why neither was ever reported: the transcript arrived up to
 * 5s late instead of never, and the code that was supposed to make it arrive
 * immediately did nothing.
 *
 * ADR-029: invalidation sites reference the factory, never a literal key.
 *
 * @param threadId when known, target exactly that thread's transcript. When
 *   omitted, target the whole `threadItems` family — for call sites (cancel run,
 *   decide permission) that do not know which thread moved. `rootPrefix` is what
 *   makes the family-wide form work: `items()` with no id is
 *   `['edge','threadItems',undefined]`, which prefix-matches nothing, while
 *   `rootPrefix(items())` is `['edge','threadItems']`, which matches every
 *   thread. At most one transcript query is active at a time
 *   (`useDesktopWorkbenchModel` mounts `useThreadMessages` once for the active
 *   thread), so the family-wide form costs one refetch, not N.
 * @returns the `invalidateQueries` promise, which settles once the triggered
 *   refetches have completed. Production call sites `void` it.
 */
export function invalidateEdgeThreadTranscript(qc: QueryClient, threadId?: string | null): Promise<void> {
  const queryKey = threadId
    ? edgeQueryKeys.threads.items(threadId)
    : rootPrefix(edgeQueryKeys.threads.items());
  // Returned, not swallowed: `invalidateQueries` resolves once the refetches it
  // triggered have settled, so a caller that needs to know the transcript is
  // back (and every test that asserts on it) can await this instead of racing
  // it with a second invalidation.
  return qc.invalidateQueries({ queryKey });
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
