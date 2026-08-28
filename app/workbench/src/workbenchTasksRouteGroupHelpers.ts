import type { TFunction } from 'i18next';
import type { TaskGroup, TaskItem, TaskStatus, TasksPane } from './pages';
import type { TaskEditDraft } from './pages/TasksPage';
import { WORKBENCH_MOCK_TASK_GROUPS } from './mockData';
import {
  TASK_STATUS_SEQUENCE,
  type TaskGroupMode,
  type TaskSortMode,
} from './workbenchTaskGroups';

/* ═══════════════════════════════════════════════════════════════════════
   workbenchTasksRouteGroupHelpers — pure residual group / draft / mode
   slices from workbenchTasksRouteHelpers (#769).

   Source-group resolution, edit drafts, immutable group mutations, status
   cycle, assignee resolution, sort/group mode toggles. No React hooks /
   no intentional UX change.
   exactOptionalPropertyTypes: only assign `?: T` fields when defined,
   unless the public field type explicitly allows `| undefined`.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Translator signature for pure helpers receiving the component's `t`
 * (#2015 pattern). Display-only feedback labels resolve through the
 * sharedWorkbench bundle; identifiers persisted into task state (group
 * labels, 未命名任务 title fallback, 当前用户 assignee fallback, TaskStatus
 * enum values) stay verbatim — data-plane per the #2023 decision.
 */
export type TasksTranslator = TFunction<'sharedWorkbench'>;

/** Resolve mock-backed or local task groups for the active data mode. */
export function resolveSourceTaskGroups(
  realDataMode: boolean,
  taskGroups: TaskGroup[],
  mockGroups: TaskGroup[] = WORKBENCH_MOCK_TASK_GROUPS,
): TaskGroup[] {
  return realDataMode ? taskGroups : (taskGroups.length > 0 ? taskGroups : mockGroups);
}

/** Build a row-edit draft from a task item. */
export function buildTaskEditDraft(task: TaskItem): TaskEditDraft {
  return {
    title: task.title,
    project: task.project,
    assignee: task.assignee,
    startTime: task.startTime,
    dueDate: task.dueDate,
    creator: task.creator,
  };
}

export function nextTaskSortMode(current: TaskSortMode): TaskSortMode {
  return current === 'custom' ? 'due' : 'custom';
}

export function nextTaskGroupMode(current: TaskGroupMode): TaskGroupMode {
  return current === 'custom' ? 'project' : current === 'project' ? 'status' : 'custom';
}

/** Patch one task inside every group (immutable). */
export function patchTaskInGroups(
  groups: TaskGroup[],
  taskId: string,
  patch: Partial<TaskItem>,
): TaskGroup[] {
  return groups.map((group) => ({
    ...group,
    tasks: group.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task)),
  }));
}

/** Remove a task; keep empty custom groups. */
export function removeTaskFromGroups(groups: TaskGroup[], taskId: string): TaskGroup[] {
  return groups
    .map((group) => ({
      ...group,
      tasks: group.tasks.filter((task) => task.id !== taskId),
    }))
    .filter((group) => group.tasks.length > 0 || group.label.startsWith('自定义分组'));
}

export function nextTaskStatus(status: TaskStatus | undefined): TaskStatus {
  const currentIndex = TASK_STATUS_SEQUENCE.indexOf(status ?? TASK_STATUS_SEQUENCE[0]!);
  return TASK_STATUS_SEQUENCE[(currentIndex + 1) % TASK_STATUS_SEQUENCE.length]
    ?? TASK_STATUS_SEQUENCE[0]!;
}

export function resolveTaskAssignee(
  userDisplayName?: string | undefined,
  currentUserId?: string | undefined,
): string {
  return userDisplayName ?? currentUserId ?? '当前用户';
}

export function resolveTaskAssigneeLabel(
  t: TasksTranslator,
  userDisplayName?: string | undefined,
): string {
  return userDisplayName ?? t('tasks.action.currentUser');
}

export function prependTaskToGroups(groups: TaskGroup[], task: TaskItem): TaskGroup[] {
  const [first, ...rest] = groups;
  if (!first) return [{ label: '默认分组', tasks: [task] }];
  return [{ ...first, tasks: [task, ...first.tasks] }, ...rest];
}

export function appendCustomTaskGroup(groups: TaskGroup[], nextIndex: number): TaskGroup[] {
  return [...groups, { label: `自定义分组 ${nextIndex}`, tasks: [] }];
}

export function prepareTaskEditSave(t: TasksTranslator, draft: TaskEditDraft): {
  title: string;
  patch: TaskEditDraft;
  taskActionLabel: string;
} {
  // 未命名任务 is the persisted task-title fallback (task data), not UI copy;
  // only the save feedback label resolves through the bundle.
  const title = draft.title.trim() || '未命名任务';
  const patch = { ...draft, title };
  return {
    title,
    patch,
    taskActionLabel: t('tasks.action.taskSaved', { title }),
  };
}

export function patchTaskEditDraft(
  current: TaskEditDraft | null,
  field: keyof TaskEditDraft,
  value: string,
): TaskEditDraft | null {
  return current ? { ...current, [field]: value } : current;
}

export function resolveFilterPaneForAssignee(
  assignee: string,
  currentUserId?: string | undefined,
): TasksPane {
  return assignee === currentUserId ? 'owned' : 'all';
}
