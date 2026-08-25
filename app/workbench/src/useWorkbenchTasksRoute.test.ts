import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  WORKBENCH_MOCK_PAGE_SIZE,
  WORKBENCH_MOCK_TASK_POOL,
} from './mockData';
import { flattenTaskGroups } from './workbenchTaskGroups';
import { useWorkbenchTasksRoute } from './useWorkbenchTasksRoute';
import {
  consumeWorkbenchTaskDeepLinkIntent,
  getWorkbenchTaskDeepLinkSnapshot,
  isActiveTaskStatus,
  openTaskDetailForConversation,
  publishWorkbenchTaskQueue,
  resetWorkbenchTaskDeepLinksForTest,
} from './workbenchTaskDeepLinks';

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

describe('useWorkbenchTasksRoute task deep-link integration (#1963)', () => {
  beforeEach(() => {
    resetWorkbenchTaskDeepLinksForTest();
  });

  it('publishes the active task inventory for the sidebar task queue', () => {
    renderHook(() => useWorkbenchTasksRoute({ realDataMode: false }));

    const queue = getWorkbenchTaskDeepLinkSnapshot().taskQueue;
    const activeInFirstPage = flattenTaskGroups(
      [{ label: '默认分组', tasks: WORKBENCH_MOCK_TASK_POOL.slice(0, WORKBENCH_MOCK_PAGE_SIZE) }],
    ).filter((task) => isActiveTaskStatus(task.status));
    expect(queue.map((task) => task.id)).toEqual(activeInFirstPage.map((task) => task.id));
    expect(queue.length).toBeGreaterThan(0);
  });

  it('publishes an empty queue in realDataMode and overwrites a stale demo queue', () => {
    publishWorkbenchTaskQueue([
      {
        id: 'stale-demo-task',
        title: '演示任务',
        project: '演示',
        assignee: 'Builder',
        startTime: '刚刚',
        dueDate: '今天 18:00',
        creator: 'demo-user',
        status: '进行中',
      },
    ]);

    renderHook(() => useWorkbenchTasksRoute({ realDataMode: true }));
    expect(getWorkbenchTaskDeepLinkSnapshot().taskQueue).toEqual([]);
  });

  it('adopts the task selection requested by a conversation→task deep link', () => {
    const target = WORKBENCH_MOCK_TASK_POOL.find((task) => task.id === 'sqlite-plan');
    if (!target) throw new Error('expected the sqlite-plan seed task');

    openTaskDetailForConversation(target);
    // The shell hook normally consumes the intent before the route remounts.
    consumeWorkbenchTaskDeepLinkIntent();

    const { result } = renderHook(() => useWorkbenchTasksRoute({ realDataMode: false }));
    expect(result.current.selectedTaskId).toBe('sqlite-plan');
    expect(result.current.selectedTask?.id).toBe('sqlite-plan');
  });

  it('re-adopts the focus when the same task is deep-linked twice', () => {
    const target = WORKBENCH_MOCK_TASK_POOL.find((task) => task.id === 'sqlite-plan');
    if (!target) throw new Error('expected the sqlite-plan seed task');
    const { result } = renderHook(() => useWorkbenchTasksRoute({ realDataMode: false }));

    act(() => {
      openTaskDetailForConversation(target);
      consumeWorkbenchTaskDeepLinkIntent();
    });
    expect(result.current.selectedTaskId).toBe('sqlite-plan');

    act(() => {
      result.current.handleTaskClick({ ...target, id: 'embedded-docs', title: '云文档内嵌子页对齐' });
    });
    expect(result.current.selectedTaskId).toBe('embedded-docs');

    act(() => {
      openTaskDetailForConversation(target);
      consumeWorkbenchTaskDeepLinkIntent();
    });
    expect(result.current.selectedTaskId).toBe('sqlite-plan');
  });
});
