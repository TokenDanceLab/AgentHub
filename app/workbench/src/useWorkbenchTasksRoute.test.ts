import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  WORKBENCH_MOCK_PAGE_SIZE,
  WORKBENCH_MOCK_TASK_POOL,
} from './mockData';
import { flattenTaskGroups } from './workbenchTaskGroups';
import { useWorkbenchTasksRoute } from './useWorkbenchTasksRoute';

/** Loaded task rows at the data layer (before pane/filter projection). */
function loadedTaskCount(route: ReturnType<typeof useWorkbenchTasksRoute>): number {
  return flattenTaskGroups(route.sourceTaskGroups).length;
}

describe('useWorkbenchTasksRoute mock cursor pagination (#1510)', () => {
  it('loads the first page (PAGE_SIZE) and reports hasMore when the pool is larger', () => {
    const { result } = renderHook(() => useWorkbenchTasksRoute({ realDataMode: false }));

    expect(loadedTaskCount(result.current)).toBe(WORKBENCH_MOCK_PAGE_SIZE);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.loadingMore).toBe(false);
    expect(typeof result.current.onLoadMore).toBe('function');
  });

  it('appends the next page on loadMore and flips hasMore=false when the pool is exhausted', async () => {
    const { result } = renderHook(() => useWorkbenchTasksRoute({ realDataMode: false }));

    await act(async () => {
      result.current.onLoadMore?.();
    });
    expect(loadedTaskCount(result.current)).toBe(WORKBENCH_MOCK_TASK_POOL.length);
    expect(result.current.hasMore).toBe(false);

    // A further loadMore is a no-op once exhausted.
    const lengthAfterExhaustion = loadedTaskCount(result.current);
    await act(async () => {
      result.current.onLoadMore?.();
    });
    expect(loadedTaskCount(result.current)).toBe(lengthAfterExhaustion);
    expect(result.current.hasMore).toBe(false);
  });

  it('guards against concurrent loadMore reentry (one page per call)', async () => {
    const { result } = renderHook(() => useWorkbenchTasksRoute({ realDataMode: false }));
    const before = loadedTaskCount(result.current);

    await act(async () => {
      // Two synchronous calls while the first page fetch is in flight.
      result.current.onLoadMore?.();
      result.current.onLoadMore?.();
    });

    expect(loadedTaskCount(result.current)).toBe(
      Math.min(before + WORKBENCH_MOCK_PAGE_SIZE, WORKBENCH_MOCK_TASK_POOL.length),
    );
  });

  it('keeps pagination inert in realDataMode where the parent owns taskGroups', async () => {
    const { result } = renderHook(() => useWorkbenchTasksRoute({ realDataMode: true }));

    expect(loadedTaskCount(result.current)).toBe(0);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.loadingMore).toBe(false);
    expect(result.current.onLoadMore).toBeUndefined();

    await act(async () => {
      result.current.onLoadMore?.();
    });
    expect(loadedTaskCount(result.current)).toBe(0);
  });
});
