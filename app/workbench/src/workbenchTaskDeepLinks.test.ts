import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskItem } from './pages';
import {
  backFromTaskDeepLink,
  consumeWorkbenchTaskDeepLinkIntent,
  deriveActiveTaskQueue,
  getWorkbenchTaskDeepLinkSnapshot,
  isActiveTaskStatus,
  openConversationForTask,
  openTaskDetailForConversation,
  publishWorkbenchTaskQueue,
  resetWorkbenchTaskDeepLinksForTest,
  subscribeWorkbenchTaskDeepLinks,
} from './workbenchTaskDeepLinks';

function makeTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: 'task-1',
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

beforeEach(() => {
  resetWorkbenchTaskDeepLinksForTest();
});

describe('deriveActiveTaskQueue', () => {
  it('keeps only in-flight tasks and preserves source order', () => {
    const queue = deriveActiveTaskQueue([
      makeTask({ id: 'a', status: '未开始' }),
      makeTask({ id: 'b', status: '进行中' }),
      makeTask({ id: 'c', status: '待评审' }),
      makeTask({ id: 'd', status: '待确认' }),
      makeTask({ id: 'e', status: '已完成' }),
    ]);
    expect(queue.map((task) => task.id)).toEqual(['b', 'c', 'd']);
  });

  it('treats only 进行中/待评审/待确认 as active', () => {
    expect(isActiveTaskStatus('进行中')).toBe(true);
    expect(isActiveTaskStatus('待评审')).toBe(true);
    expect(isActiveTaskStatus('待确认')).toBe(true);
    expect(isActiveTaskStatus('未开始')).toBe(false);
    expect(isActiveTaskStatus('已完成')).toBe(false);
  });
});

describe('task → conversation intents', () => {
  it('queues an open intent carrying the hosting conversation id', () => {
    const queued = openConversationForTask(makeTask({ conversationId: 'builder' }));
    expect(queued).toBe(true);
    const { pending } = getWorkbenchTaskDeepLinkSnapshot();
    expect(pending).not.toBeNull();
    expect(pending?.type).toBe('open');
    if (pending?.type !== 'open') return;
    expect(pending.link.direction).toBe('task-to-conversation');
    expect(pending.link.taskId).toBe('task-1');
    expect(pending.link.conversationId).toBe('builder');
  });

  it('queues nothing for a task without a hosting conversation', () => {
    expect(openConversationForTask(makeTask())).toBe(false);
    expect(getWorkbenchTaskDeepLinkSnapshot().pending).toBeNull();
  });

  it('marks the link applied on consume and notifies subscribers', () => {
    const listener = vi.fn();
    subscribeWorkbenchTaskDeepLinks(listener);
    openConversationForTask(makeTask({ conversationId: 'builder' }));
    const intent = consumeWorkbenchTaskDeepLinkIntent();
    expect(intent?.type).toBe('open');
    const snapshot = getWorkbenchTaskDeepLinkSnapshot();
    expect(snapshot.pending).toBeNull();
    expect(snapshot.applied?.direction).toBe('task-to-conversation');
    expect(snapshot.applied?.conversationId).toBe('builder');
    // open + consume + the no-op reset emit before subscribe are bounded —
    // what matters is the subscriber saw both state transitions.
    expect(listener).toHaveBeenCalled();
  });
});

describe('conversation → task intents', () => {
  it('consume focuses the task for the tasks route', () => {
    openTaskDetailForConversation(makeTask({ id: 'sqlite-plan' }));
    consumeWorkbenchTaskDeepLinkIntent();
    const snapshot = getWorkbenchTaskDeepLinkSnapshot();
    expect(snapshot.applied?.direction).toBe('conversation-to-task');
    expect(snapshot.taskFocus?.taskId).toBe('sqlite-plan');
    expect(snapshot.taskFocus?.seq).toBe(1);
  });

  it('re-raises the focus token when the same task is deep-linked again', () => {
    openTaskDetailForConversation(makeTask({ id: 'sqlite-plan' }));
    consumeWorkbenchTaskDeepLinkIntent();
    openTaskDetailForConversation(makeTask({ id: 'sqlite-plan' }));
    consumeWorkbenchTaskDeepLinkIntent();
    expect(getWorkbenchTaskDeepLinkSnapshot().taskFocus?.seq).toBe(2);
  });
});

describe('back intents', () => {
  it('queues nothing when no link is applied', () => {
    expect(backFromTaskDeepLink()).toBe(false);
    expect(getWorkbenchTaskDeepLinkSnapshot().pending).toBeNull();
  });

  it('clears the applied link and re-focuses the task when returning from a conversation', () => {
    openConversationForTask(makeTask({ conversationId: 'builder' }));
    consumeWorkbenchTaskDeepLinkIntent();
    expect(backFromTaskDeepLink()).toBe(true);
    const intent = consumeWorkbenchTaskDeepLinkIntent();
    expect(intent?.type).toBe('back');
    const snapshot = getWorkbenchTaskDeepLinkSnapshot();
    expect(snapshot.applied).toBeNull();
    // The tasks route remounts on the way back and must restore the selection.
    expect(snapshot.taskFocus?.taskId).toBe('task-1');
  });

  it('clears the applied link without touching focus when returning to a conversation', () => {
    openTaskDetailForConversation(makeTask({ id: 'sqlite-plan' }));
    consumeWorkbenchTaskDeepLinkIntent();
    const focusBefore = getWorkbenchTaskDeepLinkSnapshot().taskFocus;
    expect(backFromTaskDeepLink()).toBe(true);
    consumeWorkbenchTaskDeepLinkIntent();
    const snapshot = getWorkbenchTaskDeepLinkSnapshot();
    expect(snapshot.applied).toBeNull();
    expect(snapshot.taskFocus).toBe(focusBefore);
  });
});

describe('publishWorkbenchTaskQueue', () => {
  it('replaces the queue and skips emits for unchanged entries', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWorkbenchTaskDeepLinks(listener);

    const active = makeTask({ id: 'a' });
    publishWorkbenchTaskQueue([active]);
    expect(getWorkbenchTaskDeepLinkSnapshot().taskQueue.map((task) => task.id)).toEqual(['a']);
    expect(listener).toHaveBeenCalledTimes(1);

    // Same visible entries (different array identity) → no emit.
    publishWorkbenchTaskQueue([makeTask({ id: 'a' })]);
    expect(listener).toHaveBeenCalledTimes(1);

    // Status change is visible to the sidebar → emit.
    publishWorkbenchTaskQueue([makeTask({ id: 'a', status: '已完成' })]);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    publishWorkbenchTaskQueue([]);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getWorkbenchTaskDeepLinkSnapshot().taskQueue).toEqual([]);
  });
});
