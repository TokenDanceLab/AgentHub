// Contract tests for the Edge thread-transcript cache keys (#2274 A-12 / A-13,
// ADR-029).
//
// The assertion style is deliberate: every query is seeded by rendering the
// *production hook* so the cache entry carries the key the app really uses, and
// every invalidation is judged by an observable consequence (how many times the
// queryFn ran), never by comparing against a key the test invented. A test that
// seeds `['threadItems','x']` and then asserts `['threadItems','x']` was
// invalidated passes while the feature is a no-op — that is the original #2252
// lesson, and it is exactly how both defects below survived: the transcript
// still arrived, up to 5s late, via useThreadMessages' own refetchInterval.
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { edgeQueryKeys } from '@shared/stores/queryKeys';
import {
  invalidateEdgeThreadTranscript,
  useThreadMessages,
  useThreadPins,
  useThreads,
} from './threadQueries';
import { useDecideEdgePermission } from './runQueries';
import {
  createThread,
  decidePermission,
  fetchCurrentUser,
  fetchThreadItems,
  fetchThreadPins,
  fetchThreads,
} from './edgeClient';

vi.mock('./edgeClient', () => ({
  createThread: vi.fn(),
  decidePermission: vi.fn(),
  fetchCurrentUser: vi.fn(),
  fetchThreadItems: vi.fn(),
  fetchThreadPins: vi.fn(),
  fetchThreads: vi.fn(),
  // runQueries.ts imports these; the mock replaces the whole module.
  startRun: vi.fn(),
  cancelRun: vi.fn(),
  fetchRuns: vi.fn(),
}));

function emptyList<T>() {
  return { items: [] as T[], page: { hasMore: false } };
}

let queryClient: QueryClient;

function createWrapper(): React.FC<React.PropsWithChildren> {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: React.PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

/** Render the live transcript query and wait for its first fetch to land. */
async function seedTranscript(threadId: string) {
  const wrapper = createWrapper();
  renderHook(() => useThreadMessages(threadId), { wrapper });
  await waitFor(() => expect(vi.mocked(fetchThreadItems)).toHaveBeenCalledTimes(1));
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchThreadItems).mockResolvedValue(emptyList());
  vi.mocked(fetchThreadPins).mockResolvedValue(emptyList());
  vi.mocked(fetchThreads).mockResolvedValue(emptyList());
  vi.mocked(createThread).mockResolvedValue({ threadId: 'thread-1' } as never);
  vi.mocked(fetchCurrentUser).mockResolvedValue({} as never);
  vi.mocked(decidePermission).mockResolvedValue({} as never);
});

describe('the live transcript query key', () => {
  it('registers ["edge","threadItems",<id>] — the key every invalidation must match', async () => {
    await seedTranscript('thread-1');

    // Derived from the cache the production hook actually populated, not from a
    // literal the test wrote: this is the fact A-13's `['threadItems', id]`
    // and A-12's `threads.root` both got wrong.
    const keys = queryClient.getQueryCache().findAll().map((q) => q.queryKey);
    expect(keys).toContainEqual(['edge', 'threadItems', 'thread-1']);
    expect(keys).toContainEqual(edgeQueryKeys.threads.items('thread-1'));
  });
});

describe('invalidateEdgeThreadTranscript', () => {
  it('refetches the live transcript when given the thread id', async () => {
    await seedTranscript('thread-1');

    // Awaited directly: the helper returns the invalidateQueries promise, so
    // this is exactly one invalidation. (An earlier version of this test also
    // awaited a second invalidateQueries on the same key to "make it settle",
    // which refetched twice and proved nothing.)
    await act(async () => {
      await invalidateEdgeThreadTranscript(queryClient, 'thread-1');
    });

    await waitFor(() => expect(vi.mocked(fetchThreadItems)).toHaveBeenCalledTimes(2));
  });

  it('refetches the live transcript with no thread id (family-wide form)', async () => {
    await seedTranscript('thread-1');

    await act(async () => {
      await invalidateEdgeThreadTranscript(queryClient);
    });

    await waitFor(() => expect(vi.mocked(fetchThreadItems)).toHaveBeenCalledTimes(2));
  });

  it('does not over-invalidate the pins or thread-list queries', async () => {
    const wrapper = createWrapper();
    renderHook(() => useThreadMessages('thread-1'), { wrapper });
    renderHook(() => useThreadPins('thread-1'), { wrapper });
    renderHook(() => useThreads('project-1'), { wrapper });
    await waitFor(() => expect(vi.mocked(fetchThreadItems)).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(vi.mocked(fetchThreadPins)).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(vi.mocked(fetchThreads)).toHaveBeenCalledTimes(1));

    await act(async () => {
      await invalidateEdgeThreadTranscript(queryClient, 'thread-1');
    });

    await waitFor(() => expect(vi.mocked(fetchThreadItems)).toHaveBeenCalledTimes(2));
    // The helper is scoped to the transcript family on purpose: pins and the
    // thread list have their own invalidation sources, and widening this would
    // refetch the 10s-polled list on every run mutation.
    expect(vi.mocked(fetchThreadPins)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchThreads)).toHaveBeenCalledTimes(1);
  });
});

describe('the two dead keys this replaced (negative controls)', () => {
  it("App.tsx's old literal ['threadItems', id] invalidates nothing", async () => {
    await seedTranscript('thread-1');

    await act(async () => {
      // Missing the 'edge' segment of the real key, so it prefix-matches no
      // cache entry (#2274 A-13: three dead invalidations, two of them the
      // deliberate 2s/4s async-response compensations).
      await queryClient.invalidateQueries({ queryKey: ['threadItems', 'thread-1'] });
    });

    expect(vi.mocked(fetchThreadItems)).toHaveBeenCalledTimes(1);
  });

  it('edgeQueryKeys.threads.root reaches the thread list but NOT the transcript', async () => {
    const wrapper = createWrapper();
    renderHook(() => useThreadMessages('thread-1'), { wrapper });
    renderHook(() => useThreads('project-1'), { wrapper });
    await waitFor(() => expect(vi.mocked(fetchThreadItems)).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(vi.mocked(fetchThreads)).toHaveBeenCalledTimes(1));

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: edgeQueryKeys.threads.root });
    });

    // The list refetches — which is why threads.root stays at those call sites.
    await waitFor(() => expect(vi.mocked(fetchThreads)).toHaveBeenCalledTimes(2));
    // The transcript does not: ['edge','threads'] is not a prefix of
    // ['edge','threadItems',…] (#2274 A-12).
    expect(vi.mocked(fetchThreadItems)).toHaveBeenCalledTimes(1);
  });

  it('items() with no id is NOT a usable family-wide prefix (rootPrefix is load-bearing)', async () => {
    await seedTranscript('thread-1');

    await act(async () => {
      // ['edge','threadItems',undefined] — the naive "invalidate all transcripts"
      // spelling. It matches nothing, which is why the helper routes the
      // id-less case through rootPrefix().
      await queryClient.invalidateQueries({ queryKey: edgeQueryKeys.threads.items() });
    });

    expect(vi.mocked(fetchThreadItems)).toHaveBeenCalledTimes(1);
  });
});

describe('useDecideEdgePermission', () => {
  it('really does reload the persisted transcript, as its own doc comment claims', async () => {
    const wrapper = createWrapper();
    renderHook(() => useThreadMessages('thread-1'), { wrapper });
    const permission = renderHook(() => useDecideEdgePermission(), { wrapper });
    await waitFor(() => expect(vi.mocked(fetchThreadItems)).toHaveBeenCalledTimes(1));

    await act(async () => {
      await permission.result.current.mutateAsync({
        requestId: 'req-1',
        decision: 'allow',
      } as never);
    });

    // Before the fix this stayed at 1: onSettled invalidated threads.root only,
    // while the doc comment above it said the invalidation exists to close the
    // replay gap "when the persisted transcript is reloaded".
    await waitFor(() => expect(vi.mocked(fetchThreadItems)).toHaveBeenCalledTimes(2));
  });
});
