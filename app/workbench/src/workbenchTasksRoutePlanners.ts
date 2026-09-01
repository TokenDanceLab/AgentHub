import type { TaskItem, TaskStatus, TasksPane } from './pages';
import type { TaskEditDraft } from './pages/TasksPage';
import {
  type TaskSortMode,
  createLocalTask,
} from './workbenchTaskGroups';
import {
  type TasksTranslator,
  buildTaskEditDraft,
  nextTaskSortMode,
  nextTaskStatus,
  prepareTaskEditSave,
  resolveFilterPaneForAssignee,
  resolveTaskAssignee,
  resolveTaskAssigneeLabel,
} from './workbenchTasksRouteGroupHelpers';

/* ═══════════════════════════════════════════════════════════════════════
   workbenchTasksRoutePlanners — pure residual action-plan / label slices
   from workbenchTasksRouteHelpers (#769).

   Pane/sort/group labels, create/edit/delete/cycle/assign/filter plans,
   toolbar toggles. No React hooks / no intentional UX change.

   i18n note (#2023): action feedback labels resolve through the
   sharedWorkbench bundle via a passed-in translator (component `t`);
   TaskStatus enum identifiers interpolated into copy stay verbatim
   (data-plane per the #2023 decision).
   exactOptionalPropertyTypes: only assign `?: T` fields when defined,
   unless the public field type explicitly allows `| undefined`.
   ═══════════════════════════════════════════════════════════════════════ */

function taskPaneLabel(t: TasksTranslator, pane: TasksPane): string {
  switch (pane) {
    case 'owned':
      return t('tasks.action.panes.owned');
    case 'watching':
      return t('tasks.action.panes.watching');
    case 'activity':
      return t('tasks.action.panes.activity');
    case 'done':
      return t('tasks.action.panes.done');
    default:
      return t('tasks.action.panes.view');
  }
}

export interface TaskSelectionReset {
  selectedTaskId: null;
  editingTaskId: null;
  editingTaskDraft: null;
}

export interface TaskPaneChangePlan extends TaskSelectionReset {
  tasksPane: TasksPane;
  taskActionLabel: string;
}

export interface CreateTaskPlan {
  nextTask: TaskItem;
  tasksPane: 'owned';
  taskViewMode: 'list';
  selectedTaskId: string;
  editingTaskId: string;
  editingTaskDraft: TaskEditDraft;
  taskActionLabel: string;
}

export interface NewTaskGroupPlan {
  nextIndex: number;
  taskGroupMode: 'custom';
  taskViewMode: 'list';
  taskActionLabel: string;
}

export interface TaskListResetPlan {
  taskViewMode: 'list';
  taskGroupMode: 'custom';
  taskActionLabel: string;
}

export interface TaskSortTogglePlan {
  next: TaskSortMode;
  taskActionLabel: string;
}

export interface StartTaskEditPlan {
  selectedTaskId: string;
  editingTaskId: string;
  editingTaskDraft: TaskEditDraft;
  taskViewMode: 'list';
  taskActionLabel: string;
}

export interface SaveTaskEditPlan {
  kind: 'save';
  taskId: string;
  patch: TaskEditDraft;
  taskActionLabel: string;
}

export interface TaskActionFeedbackPlan {
  kind: 'feedback';
  taskActionLabel: string;
}

export type SelectedTaskGuardPlan = TaskActionFeedbackPlan;

export interface DeleteSelectedTaskPlan extends TaskSelectionReset {
  kind: 'delete';
  taskId: string;
  taskActionLabel: string;
}

export interface CycleSelectedTaskStatusPlan {
  kind: 'cycle';
  taskId: string;
  status: TaskStatus;
  taskActionLabel: string;
}

export interface AssignSelectedTaskPlan {
  kind: 'assign';
  taskId: string;
  assignee: string;
  taskActionLabel: string;
}

export interface GroupBySelectedProjectPlan {
  kind: 'group-project';
  taskGroupMode: 'project';
  taskViewMode: 'list';
  taskActionLabel: string;
}

export interface FilterBySelectedAssigneePlan {
  kind: 'filter-assignee';
  tasksPane: TasksPane;
  taskFilterActive: false;
  taskActionLabel: string;
}

export interface TaskClickPlan {
  selectedTaskId: string;
  clearEdit: boolean;
  taskActionLabel: string;
}

export interface ToggleFlagPlan {
  next: boolean;
  taskActionLabel: string;
}

export function buildTaskPaneChangeLabel(t: TasksTranslator, pane: TasksPane): string {
  return t('tasks.action.paneSwitched', { pane: taskPaneLabel(t, pane) });
}

export function planTaskPaneChange(t: TasksTranslator, pane: TasksPane): TaskPaneChangePlan {
  return {
    tasksPane: pane,
    selectedTaskId: null,
    editingTaskId: null,
    editingTaskDraft: null,
    taskActionLabel: buildTaskPaneChangeLabel(t, pane),
  };
}

export function buildTaskSortActionLabel(t: TasksTranslator, mode: TaskSortMode): string {
  return mode === 'due' ? t('tasks.action.sortDue') : t('tasks.action.sortDrag');
}

export function planTaskSortToggle(t: TasksTranslator, current: TaskSortMode): TaskSortTogglePlan {
  const next = nextTaskSortMode(current);
  return {
    next,
    taskActionLabel: buildTaskSortActionLabel(t, next),
  };
}

export function planTaskListReset(t: TasksTranslator): TaskListResetPlan {
  return {
    taskViewMode: 'list',
    taskGroupMode: 'custom',
    taskActionLabel: t('tasks.action.backToList'),
  };
}

export function planNewTaskGroup(t: TasksTranslator, groupCount: number): NewTaskGroupPlan {
  const nextIndex = groupCount + 1;
  return {
    nextIndex,
    taskGroupMode: 'custom',
    taskViewMode: 'list',
    taskActionLabel: t('tasks.action.groupCreated', { index: nextIndex }),
  };
}

export function planCreateTask(t: TasksTranslator, localTaskCounter: number): CreateTaskPlan {
  const nextTask = createLocalTask(localTaskCounter);
  return {
    nextTask,
    tasksPane: 'owned',
    taskViewMode: 'list',
    selectedTaskId: nextTask.id,
    editingTaskId: nextTask.id,
    editingTaskDraft: buildTaskEditDraft(nextTask),
    taskActionLabel: t('tasks.action.taskCreated', { title: nextTask.title }),
  };
}

export function planStartTaskEdit(t: TasksTranslator, task: TaskItem): StartTaskEditPlan {
  return {
    selectedTaskId: task.id,
    editingTaskId: task.id,
    editingTaskDraft: buildTaskEditDraft(task),
    taskViewMode: 'list',
    taskActionLabel: t('tasks.action.editing', { title: task.title }),
  };
}

export function planEditSelectedTask(t: TasksTranslator, selectedTask: TaskItem | null): StartTaskEditPlan | SelectedTaskGuardPlan {
  if (!selectedTask) {
    return { kind: 'feedback', taskActionLabel: t('tasks.action.selectFirst') };
  }
  return planStartTaskEdit(t, selectedTask);
}

export function planSaveTaskEdit(
  t: TasksTranslator,
  editingTaskId: string | null,
  editingTaskDraft: TaskEditDraft | null,
): SaveTaskEditPlan | TaskActionFeedbackPlan {
  if (!editingTaskId || !editingTaskDraft) {
    return { kind: 'feedback', taskActionLabel: t('tasks.action.noEditingTask') };
  }
  const saved = prepareTaskEditSave(t, editingTaskDraft);
  return {
    kind: 'save',
    taskId: editingTaskId,
    patch: saved.patch,
    taskActionLabel: saved.taskActionLabel,
  };
}

export function planCancelTaskEdit(t: TasksTranslator, editingTaskDraft: TaskEditDraft | null): TaskActionFeedbackPlan | null {
  if (!editingTaskDraft) return null;
  return { kind: 'feedback', taskActionLabel: t('tasks.action.editCancelled') };
}

export function planDeleteSelectedTask(t: TasksTranslator, selectedTask: TaskItem | null): DeleteSelectedTaskPlan | SelectedTaskGuardPlan {
  if (!selectedTask) {
    return { kind: 'feedback', taskActionLabel: t('tasks.action.selectFirst') };
  }
  return {
    kind: 'delete',
    taskId: selectedTask.id,
    selectedTaskId: null,
    editingTaskId: null,
    editingTaskDraft: null,
    taskActionLabel: t('tasks.action.taskDeleted', { title: selectedTask.title }),
  };
}

export function planCycleSelectedTaskStatus(
  t: TasksTranslator,
  selectedTask: TaskItem | null,
): CycleSelectedTaskStatusPlan | SelectedTaskGuardPlan {
  if (!selectedTask) {
    return { kind: 'feedback', taskActionLabel: t('tasks.action.selectFirst') };
  }
  const status = nextTaskStatus(selectedTask.status);
  return {
    kind: 'cycle',
    taskId: selectedTask.id,
    status,
    // TaskStatus enum identifiers stay verbatim (data-plane, #2023 decision).
    taskActionLabel: t('tasks.action.statusAdvanced', { title: selectedTask.title, status }),
  };
}

export function planAssignSelectedTaskToMe(
  t: TasksTranslator,
  selectedTask: TaskItem | null,
  userDisplayName?: string | undefined,
  currentUserId?: string | undefined,
): AssignSelectedTaskPlan | SelectedTaskGuardPlan {
  if (!selectedTask) {
    return { kind: 'feedback', taskActionLabel: t('tasks.action.selectFirst') };
  }
  const assignee = resolveTaskAssignee(userDisplayName, currentUserId);
  return {
    kind: 'assign',
    taskId: selectedTask.id,
    assignee,
    taskActionLabel: t('tasks.action.taskAssigned', {
      title: selectedTask.title,
      assignee: resolveTaskAssigneeLabel(t, userDisplayName),
    }),
  };
}

export function planGroupBySelectedTaskProject(
  t: TasksTranslator,
  selectedTask: TaskItem | null,
): GroupBySelectedProjectPlan | SelectedTaskGuardPlan {
  if (!selectedTask) {
    return { kind: 'feedback', taskActionLabel: t('tasks.action.selectFirst') };
  }
  return {
    kind: 'group-project',
    taskGroupMode: 'project',
    taskViewMode: 'list',
    taskActionLabel: t('tasks.action.groupByProject', { project: selectedTask.project }),
  };
}

export function planFilterBySelectedTaskAssignee(
  t: TasksTranslator,
  selectedTask: TaskItem | null,
  currentUserId?: string | undefined,
): FilterBySelectedAssigneePlan | SelectedTaskGuardPlan {
  if (!selectedTask) {
    return { kind: 'feedback', taskActionLabel: t('tasks.action.selectFirst') };
  }
  return {
    kind: 'filter-assignee',
    tasksPane: resolveFilterPaneForAssignee(selectedTask.assignee, currentUserId),
    taskFilterActive: false,
    taskActionLabel: t('tasks.action.currentAssignee', { assignee: selectedTask.assignee }),
  };
}

export function planTaskClick(t: TasksTranslator, task: TaskItem, editingTaskId: string | null): TaskClickPlan {
  return {
    selectedTaskId: task.id,
    clearEdit: Boolean(editingTaskId && editingTaskId !== task.id),
    taskActionLabel: t('tasks.action.taskSelected', { title: task.title }),
  };
}

export function planToolbarFieldConfig(t: TasksTranslator, currentlyShown: boolean): ToggleFlagPlan {
  return {
    next: !currentlyShown,
    taskActionLabel: currentlyShown ? t('tasks.action.creatorFieldHidden') : t('tasks.action.creatorFieldShown'),
  };
}

export function planToolbarFilter(t: TasksTranslator, currentlyActive: boolean): ToggleFlagPlan {
  return {
    next: !currentlyActive,
    taskActionLabel: currentlyActive ? t('tasks.action.filterClosed') : t('tasks.action.filterEnabled'),
  };
}
