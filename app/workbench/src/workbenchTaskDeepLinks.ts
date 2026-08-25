import { useSyncExternalStore } from 'react';
import type { TaskItem, TaskStatus } from './pages';

/* ═══════════════════════════════════════════════════════════════════════
   Task ↔ conversation deep links (#1963).

   Workbench pages are state-driven (no URL router), so a deep link is an
   intent queued in this module store; the shell hook
   (`useWorkbenchTaskDeepLinks`) consumes pending intents and applies them
   through `setActivePage` / `onActiveConversationChange`. The applied link
   stays in the snapshot so both surfaces can render a back affordance:

   - task card → hosting conversation: lands on the chat page with the
     hosting conversation active; the sidebar shows "back to task".
   - conversation sidebar task queue → task detail: lands on the tasks page
     with the task selected; the tasks route view shows "back to
     conversation".

   Back navigation re-queues a `back` intent through the same store, so the
   shell stays the single place that mutates page/conversation state.

   The sidebar task queue also lives here: the tasks route publishes its
   active tasks (and the shell hook seeds the demo queue on the chat page,
   where the tasks route is unmounted) so the ConversationSidebar can render
   the 任务队列 collapsible group without any prop threading through the
   frame.
   ═══════════════════════════════════════════════════════════════════════ */

export type WorkbenchTaskDeepLinkDirection = 'task-to-conversation' | 'conversation-to-task';

export interface WorkbenchTaskDeepLink {
  direction: WorkbenchTaskDeepLinkDirection;
  taskId: string;
  taskTitle: string;
  /** task-to-conversation only: the hosting conversation to open. */
  conversationId?: string | undefined;
}

export type WorkbenchTaskDeepLinkIntent =
  | { type: 'open'; link: WorkbenchTaskDeepLink }
  | { type: 'back'; link: WorkbenchTaskDeepLink };

export interface WorkbenchTaskFocusRequest {
  taskId: string;
  /** Monotonic token so consumers re-adopt a focus request for the same id. */
  seq: number;
}

export interface WorkbenchTaskDeepLinkSnapshot {
  /** Currently applied link; drives back affordances until back is consumed. */
  applied: WorkbenchTaskDeepLink | null;
  /** Intent awaiting shell application; null when idle. */
  pending: WorkbenchTaskDeepLinkIntent | null;
  /** Active tasks for the sidebar 任务队列 group (list order = queue order). */
  taskQueue: TaskItem[];
  /** Latest task-selection request for the tasks route; null when none. */
  taskFocus: WorkbenchTaskFocusRequest | null;
}

/** In-flight statuses: the queue shows work the user is actively tracking. */
const ACTIVE_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  '进行中',
  '待评审',
  '待确认',
]);

/** Whether a task status counts as active for the sidebar task queue. */
export function isActiveTaskStatus(status: TaskStatus): boolean {
  return ACTIVE_TASK_STATUSES.has(status);
}

/** Filter a task inventory down to the active queue entries, keeping order. */
export function deriveActiveTaskQueue(tasks: readonly TaskItem[]): TaskItem[] {
  return tasks.filter((task) => isActiveTaskStatus(task.status));
}

let snapshot: WorkbenchTaskDeepLinkSnapshot = {
  applied: null,
  pending: null,
  taskQueue: [],
  taskFocus: null,
};
let focusSeq = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

function nextTaskFocus(taskId: string): WorkbenchTaskFocusRequest {
  focusSeq += 1;
  return { taskId, seq: focusSeq };
}

export function getWorkbenchTaskDeepLinkSnapshot(): WorkbenchTaskDeepLinkSnapshot {
  return snapshot;
}

export function subscribeWorkbenchTaskDeepLinks(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React subscription to the deep-link snapshot. */
export function useWorkbenchTaskDeepLinkSnapshot(): WorkbenchTaskDeepLinkSnapshot {
  return useSyncExternalStore(subscribeWorkbenchTaskDeepLinks, getWorkbenchTaskDeepLinkSnapshot);
}

/**
 * Queue a task-card → hosting-conversation jump. Returns false and queues
 * nothing when the task has no hosting conversation bound.
 */
export function openConversationForTask(task: TaskItem): boolean {
  if (!task.conversationId) return false;
  snapshot = {
    ...snapshot,
    pending: {
      type: 'open',
      link: {
        direction: 'task-to-conversation',
        taskId: task.id,
        taskTitle: task.title,
        conversationId: task.conversationId,
      },
    },
  };
  emit();
  return true;
}

/** Queue a sidebar-task-queue → task-detail jump. */
export function openTaskDetailForConversation(task: TaskItem): boolean {
  snapshot = {
    ...snapshot,
    pending: {
      type: 'open',
      link: {
        direction: 'conversation-to-task',
        taskId: task.id,
        taskTitle: task.title,
      },
    },
  };
  emit();
  return true;
}

/** Queue the return trip of the applied link; no-op when nothing is applied. */
export function backFromTaskDeepLink(): boolean {
  const applied = snapshot.applied;
  if (!applied) return false;
  snapshot = { ...snapshot, pending: { type: 'back', link: applied } };
  emit();
  return true;
}

/**
 * Shell-hook only: pop the pending intent and fold its state effects into
 * the snapshot (applied link, task focus). The caller performs the actual
 * page/conversation navigation for the returned intent.
 */
export function consumeWorkbenchTaskDeepLinkIntent(): WorkbenchTaskDeepLinkIntent | null {
  const intent = snapshot.pending;
  if (!intent) return null;
  if (intent.type === 'open') {
    // conversation→task focuses the task on the tasks page; task→conversation
    // leaves any prior focus untouched so back lands on the same selection.
    const taskFocus = intent.link.direction === 'conversation-to-task'
      ? nextTaskFocus(intent.link.taskId)
      : snapshot.taskFocus;
    snapshot = { ...snapshot, pending: null, applied: intent.link, taskFocus };
  } else {
    // Back from task→conversation returns to the tasks page; the route state
    // was dropped while the chat page rendered, so re-request the selection.
    const taskFocus = intent.link.direction === 'task-to-conversation'
      ? nextTaskFocus(intent.link.taskId)
      : snapshot.taskFocus;
    snapshot = { ...snapshot, pending: null, applied: null, taskFocus };
  }
  emit();
  return intent;
}

function sameTaskQueue(a: readonly TaskItem[], b: readonly TaskItem[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (!left || !right) return false;
    if (left.id !== right.id || left.title !== right.title || left.status !== right.status) {
      return false;
    }
  }
  return true;
}

/**
 * Publish the sidebar task queue. Skips the emit when the visible entries
 * (id/title/status) are unchanged so render-time publishers stay cheap.
 */
export function publishWorkbenchTaskQueue(tasks: TaskItem[]): void {
  if (sameTaskQueue(snapshot.taskQueue, tasks)) return;
  snapshot = { ...snapshot, taskQueue: tasks };
  emit();
}

/** Test-only: restore the idle empty state (also resets the focus token). */
export function resetWorkbenchTaskDeepLinksForTest(): void {
  snapshot = { applied: null, pending: null, taskQueue: [], taskFocus: null };
  focusSeq = 0;
  emit();
}
