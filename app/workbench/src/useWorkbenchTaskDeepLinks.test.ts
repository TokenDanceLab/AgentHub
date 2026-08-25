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
      openTaskDetailForConversation(makeTask());
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

  it('back from the task detail returns to the chat page without changing the conversation', () => {
    const { setActivePage, onActiveConversationChange } = renderShellHook();
    act(() => {
      openTaskDetailForConversation(makeTask());
    });
    setActivePage.mockClear();

    act(() => {
      backFromTaskDeepLink();
    });
    expect(setActivePage).toHaveBeenCalledWith('chat');
    expect(onActiveConversationChange).not.toHaveBeenCalled();
    expect(getWorkbenchTaskDeepLinkSnapshot().applied).toBeNull();
  });
});

describe('useWorkbenchTaskDeepLinks sidebar queue seed (#1963)', () => {
  it('seeds the demo queue with active mock tasks outside real data mode', () => {
    renderShellHook({ dataMode: 'mock' });
    const queue = getWorkbenchTaskDeepLinkSnapshot().taskQueue;
    expect(queue.length).toBeGreaterThan(0);
    for (const task of queue) expect(isActiveTaskStatus(task.status)).toBe(true);
  });

  it('keeps the queue empty in real data mode (no task backend yet, #1818)', () => {
    // Pre-fill to prove the seed overwrites a stale demo queue on mode switch.
    publishWorkbenchTaskQueue([makeTask()]);
    expect(getWorkbenchTaskDeepLinkSnapshot().taskQueue).toHaveLength(1);
    renderShellHook({ dataMode: 'observed' });
    expect(getWorkbenchTaskDeepLinkSnapshot().taskQueue).toEqual([]);
  });
});
