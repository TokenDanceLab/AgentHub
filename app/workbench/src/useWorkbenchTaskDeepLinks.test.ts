import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskItem } from './pages';
import {
  backFromTaskDeepLink,
  getWorkbenchTaskDeepLinkSnapshot,
  isActiveTaskStatus,
  openConversationForTask,
  openTaskDetailForConversation,
  publishWorkbenchTaskQueue,
  resetWorkbenchTaskDeepLinksForTest,
} from './workbenchTaskDeepLinks';
import { useWorkbenchTaskDeepLinks } from './useWorkbenchTaskDeepLinks';

function makeTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: 'sqlite-plan',
    title: 'B0 SQLite 迁移方案',
    project: '前端重构任务',
    assignee: 'Builder',
    startTime: '今天 14:49',
    dueDate: '明天 18:00',
    creator: 'demo-user',
    status: '进行中',
    ...overrides,
  };
}

function renderShellHook(options: { dataMode?: string } = {}) {
  const setActivePage = vi.fn();
  const onActiveConversationChange = vi.fn();
  renderHook(() => useWorkbenchTaskDeepLinks({
    setActivePage,
    onActiveConversationChange,
    dataMode: options.dataMode,
  }));
  return { setActivePage, onActiveConversationChange };
}

beforeEach(() => {
  resetWorkbenchTaskDeepLinksForTest();
});

describe('useWorkbenchTaskDeepLinks intent application (#1963)', () => {
  it('applies a task→conversation intent as chat page + hosting conversation', () => {
    const { setActivePage, onActiveConversationChange } = renderShellHook();
    act(() => {
      openConversationForTask(makeTask({ conversationId: 'builder' }));
    });
    expect(setActivePage).toHaveBeenCalledWith('chat');
    expect(onActiveConversationChange).toHaveBeenCalledWith('builder');
    expect(getWorkbenchTaskDeepLinkSnapshot().applied?.direction).toBe('task-to-conversation');
    expect(getWorkbenchTaskDeepLinkSnapshot().pending).toBeNull();
  });

  it('applies a conversation→task intent as tasks-page navigation without touching the conversation', () => {
    const { setActivePage, onActiveConversationChange } = renderShellHook();
    act(() => {
      openTaskDetailForConversation(makeTask(), 'c1');
    });
    expect(setActivePage).toHaveBeenCalledWith('runs');
    expect(onActiveConversationChange).not.toHaveBeenCalled();
    expect(getWorkbenchTaskDeepLinkSnapshot().applied?.direction).toBe('conversation-to-task');
    expect(getWorkbenchTaskDeepLinkSnapshot().taskFocus?.taskId).toBe('sqlite-plan');
  });

  it('back from the hosting conversation returns to the tasks page and clears the link', () => {
    const { setActivePage } = renderShellHook();
    act(() => {
      openConversationForTask(makeTask({ conversationId: 'builder' }));
    });
    setActivePage.mockClear();

    act(() => {
      backFromTaskDeepLink();
    });
    expect(setActivePage).toHaveBeenCalledWith('runs');
    expect(getWorkbenchTaskDeepLinkSnapshot().applied).toBeNull();
    // The tasks route remounts on return — the focus request restores the selection.
    expect(getWorkbenchTaskDeepLinkSnapshot().taskFocus?.taskId).toBe('sqlite-plan');
  });

  it('back from the task detail restores the conversation that opened it', () => {
    const { setActivePage, onActiveConversationChange } = renderShellHook();
    act(() => {
      openTaskDetailForConversation(makeTask(), 'c1');
    });
    setActivePage.mockClear();

    act(() => {
      backFromTaskDeepLink();
    });
    expect(setActivePage).toHaveBeenCalledWith('chat');
    expect(onActiveConversationChange).toHaveBeenCalledWith('c1');
    expect(getWorkbenchTaskDeepLinkSnapshot().applied).toBeNull();
  });
});

describe('useWorkbenchTaskDeepLinks sidebar queue seed (#1963)', () => {
  it('seeds and labels the queue only in explicit mock/fixture modes', () => {
    const mock = renderShellHook({ dataMode: 'mock' });
    let snapshot = getWorkbenchTaskDeepLinkSnapshot();
    expect(snapshot.taskQueue.length).toBeGreaterThan(0);
    expect(snapshot.taskQueueSource).toBe('demo');
    for (const task of snapshot.taskQueue) expect(isActiveTaskStatus(task.status)).toBe(true);

    mock.setActivePage.mockClear();
    renderShellHook({ dataMode: 'fixture' });
    snapshot = getWorkbenchTaskDeepLinkSnapshot();
    expect(snapshot.taskQueue.length).toBeGreaterThan(0);
    expect(snapshot.taskQueueSource).toBe('fixture');
  });

  it.each(['auto', 'observed', 'approved-real'])(
    'keeps %s free of local demo tasks without an explicit task source',
    (dataMode) => {
      publishWorkbenchTaskQueue([makeTask()], 'demo');
      renderShellHook({ dataMode });
      expect(getWorkbenchTaskDeepLinkSnapshot().taskQueue).toEqual([]);
      expect(getWorkbenchTaskDeepLinkSnapshot().taskQueueSource).toBeNull();
    },
  );
});
