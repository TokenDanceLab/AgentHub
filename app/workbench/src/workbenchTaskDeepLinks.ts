import {
  createContext,
  createElement,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { TaskItem, TaskStatus } from './pages';

/* Task ↔ conversation deep links (#1963).
 *
 * Production state is scoped by WorkbenchTaskDeepLinkProvider: every
 * AgentHubWorkbench mount gets an isolated store, so logout/account switch or
 * a full shell remount cannot inherit pending/applied/focus state.
 */

export type WorkbenchTaskDeepLinkDirection = 'task-to-conversation' | 'conversation-to-task';
export type WorkbenchTaskQueueSource = 'demo' | 'fixture' | 'runtime' | null;

export interface WorkbenchTaskDeepLink {
  direction: WorkbenchTaskDeepLinkDirection;
  taskId: string;
  taskTitle: string;
  /** Full payload keeps a deep-linked row available while paged data loads. */
  task: TaskItem;
  /** Hosting conversation for task→conversation; origin for conversation→task. */
  conversationId?: string | undefined;
}

export type WorkbenchTaskDeepLinkIntent =
  | { type: 'open'; link: WorkbenchTaskDeepLink }
  | { type: 'back'; link: WorkbenchTaskDeepLink };

export interface WorkbenchTaskFocusRequest {
  taskId: string;
  task: TaskItem;
  /** Monotonic token so consumers re-adopt a focus request for the same id. */
  seq: number;
}

export interface WorkbenchTaskDeepLinkSnapshot {
  applied: WorkbenchTaskDeepLink | null;
  pending: WorkbenchTaskDeepLinkIntent | null;
  taskQueue: TaskItem[];
  taskQueueSource: WorkbenchTaskQueueSource;
  taskFocus: WorkbenchTaskFocusRequest | null;
}

export interface WorkbenchTaskDeepLinkStore {
  getSnapshot: () => WorkbenchTaskDeepLinkSnapshot;
  subscribe: (listener: () => void) => () => void;
  openConversationForTask: (task: TaskItem) => boolean;
  openTaskDetailForConversation: (task: TaskItem, conversationId: string) => boolean;
  back: () => boolean;
  consume: () => WorkbenchTaskDeepLinkIntent | null;
  publishTaskQueue: (tasks: TaskItem[], source: WorkbenchTaskQueueSource) => void;
  reset: () => void;
}

const ACTIVE_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  '进行中',
  '待评审',
  '待确认',
]);

export function isActiveTaskStatus(status: TaskStatus): boolean {
  return ACTIVE_TASK_STATUSES.has(status);
}

export function deriveActiveTaskQueue(tasks: readonly TaskItem[]): TaskItem[] {
  return tasks.filter((task) => isActiveTaskStatus(task.status));
}

function createInitialSnapshot(): WorkbenchTaskDeepLinkSnapshot {
  return {
    applied: null,
    pending: null,
    taskQueue: [],
    taskQueueSource: null,
    taskFocus: null,
  };
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

/** Create one isolated store. Production creates exactly one per Workbench mount. */
function createWorkbenchTaskDeepLinkStore(): WorkbenchTaskDeepLinkStore {
  let snapshot = createInitialSnapshot();
  let focusSeq = 0;
  const listeners = new Set<() => void>();

  function emit(): void {
    for (const listener of [...listeners]) listener();
  }

  function update(next: WorkbenchTaskDeepLinkSnapshot): void {
    snapshot = next;
    emit();
  }

  function nextTaskFocus(task: TaskItem): WorkbenchTaskFocusRequest {
    focusSeq += 1;
    return { taskId: task.id, task, seq: focusSeq };
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    openConversationForTask(task) {
      if (!task.conversationId) return false;
      update({
        ...snapshot,
        pending: {
          type: 'open',
          link: {
            direction: 'task-to-conversation',
            taskId: task.id,
            taskTitle: task.title,
            task,
            conversationId: task.conversationId,
          },
        },
      });
      return true;
    },
    openTaskDetailForConversation(task, conversationId) {
      update({
        ...snapshot,
        pending: {
          type: 'open',
          link: {
            direction: 'conversation-to-task',
            taskId: task.id,
            taskTitle: task.title,
            task,
            conversationId,
          },
        },
      });
      return true;
    },
    back() {
      const applied = snapshot.applied;
      if (!applied) return false;
      update({ ...snapshot, pending: { type: 'back', link: applied } });
      return true;
    },
    consume() {
      const intent = snapshot.pending;
      if (!intent) return null;
      if (intent.type === 'open') {
        const taskFocus = intent.link.direction === 'conversation-to-task'
          ? nextTaskFocus(intent.link.task)
          : snapshot.taskFocus;
        update({ ...snapshot, pending: null, applied: intent.link, taskFocus });
      } else {
        const taskFocus = intent.link.direction === 'task-to-conversation'
          ? nextTaskFocus(intent.link.task)
          : snapshot.taskFocus;
        update({ ...snapshot, pending: null, applied: null, taskFocus });
      }
      return intent;
    },
    publishTaskQueue(tasks, source) {
      const effectiveSource = tasks.length > 0 ? source : null;
      if (sameTaskQueue(snapshot.taskQueue, tasks) && snapshot.taskQueueSource === effectiveSource) return;
      update({
        ...snapshot,
        taskQueue: tasks,
        taskQueueSource: effectiveSource,
      });
    },
    reset() {
      snapshot = createInitialSnapshot();
      focusSeq = 0;
      emit();
    },
  };
}

const defaultWorkbenchTaskDeepLinkStore = createWorkbenchTaskDeepLinkStore();
const WorkbenchTaskDeepLinkContext = createContext(defaultWorkbenchTaskDeepLinkStore);

/** Lifecycle boundary: state is discarded on Workbench unmount/account shell replacement. */
export function WorkbenchTaskDeepLinkProvider({ children }: { children: ReactNode }): ReactElement {
  const [store] = useState(createWorkbenchTaskDeepLinkStore);
  return createElement(WorkbenchTaskDeepLinkContext.Provider, { value: store }, children);
}

export function useWorkbenchTaskDeepLinkStore(): WorkbenchTaskDeepLinkStore {
  return useContext(WorkbenchTaskDeepLinkContext);
}

export function useWorkbenchTaskDeepLinkActions(): Pick<
  WorkbenchTaskDeepLinkStore,
  'openConversationForTask' | 'openTaskDetailForConversation' | 'back' | 'publishTaskQueue'
> {
  const store = useWorkbenchTaskDeepLinkStore();
  return useMemo(() => ({
    openConversationForTask: store.openConversationForTask,
    openTaskDetailForConversation: store.openTaskDetailForConversation,
    back: store.back,
    publishTaskQueue: store.publishTaskQueue,
  }), [store]);
}

export function useWorkbenchTaskDeepLinkSnapshot(): WorkbenchTaskDeepLinkSnapshot {
  const store = useWorkbenchTaskDeepLinkStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/* Default-store helpers remain for focused unit tests and non-React callers. */
export function getWorkbenchTaskDeepLinkSnapshot(): WorkbenchTaskDeepLinkSnapshot {
  return defaultWorkbenchTaskDeepLinkStore.getSnapshot();
}

export function subscribeWorkbenchTaskDeepLinks(listener: () => void): () => void {
  return defaultWorkbenchTaskDeepLinkStore.subscribe(listener);
}

export function openConversationForTask(task: TaskItem): boolean {
  return defaultWorkbenchTaskDeepLinkStore.openConversationForTask(task);
}

export function openTaskDetailForConversation(task: TaskItem, conversationId = 'unknown'): boolean {
  return defaultWorkbenchTaskDeepLinkStore.openTaskDetailForConversation(task, conversationId);
}

export function backFromTaskDeepLink(): boolean {
  return defaultWorkbenchTaskDeepLinkStore.back();
}

export function consumeWorkbenchTaskDeepLinkIntent(): WorkbenchTaskDeepLinkIntent | null {
  return defaultWorkbenchTaskDeepLinkStore.consume();
}

export function publishWorkbenchTaskQueue(
  tasks: TaskItem[],
  source: WorkbenchTaskQueueSource = 'runtime',
): void {
  defaultWorkbenchTaskDeepLinkStore.publishTaskQueue(tasks, source);
}

/** Unit-test cleanup for the default store; production isolation uses the provider. */
export function resetWorkbenchTaskDeepLinksForTest(): void {
  defaultWorkbenchTaskDeepLinkStore.reset();
}
