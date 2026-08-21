import type { TaskItem, TaskStatus, TasksPane } from './pages';
import type { TaskEditDraft } from './pages/TasksPage';
import {
  type TaskSortMode,
  createLocalTask,
} from './workbenchTaskGroups';
import {
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
   exactOptionalPropertyTypes: only assign `?: T` fields when defined,
   unless the public field type explicitly allows `| undefined`.
   ═══════════════════════════════════════════════════════════════════════ */

const TASK_PANE_LABELS: Record<TasksPane, string> = {
  owned: '我负责的',
  watching: '我关注的',
  activity: '动态',
  done: '已完成',
  all: '任务视图',
  created: '任务视图',
  assigned: '任务视图',
};

export interface TaskSelectionReset {
  selectedTaskId: null;
  editingTaskId: null;
  editingTaskDraft: null;
}

export interface TaskPaneChangePlan extends TaskSelectionReset {
  tasksPane: TasksPane;
  taskNavMenuOpen: false;
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
  taskNavMenuOpen: false;
  taskActionLabel: '已回到任务清单';
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

export function buildTaskPaneChangeLabel(pane: TasksPane): string {
  return `已切换到${TASK_PANE_LABELS[pane]}`;
}

export function planTaskPaneChange(pane: TasksPane): TaskPaneChangePlan {
  return {
    tasksPane: pane,
    selectedTaskId: null,
    editingTaskId: null,
    editingTaskDraft: null,
    taskNavMenuOpen: false,
    taskActionLabel: buildTaskPaneChangeLabel(pane),
  };
}

export function buildTaskSortActionLabel(mode: TaskSortMode): string {
  return mode === 'due' ? '已按截止时间排序' : '已恢复拖拽自定义排序';
}

export function planTaskSortToggle(current: TaskSortMode): TaskSortTogglePlan {
  const next = nextTaskSortMode(current);
  return {
    next,
    taskActionLabel: buildTaskSortActionLabel(next),
  };
}

export function planTaskListReset(): TaskListResetPlan {
  return {
    taskViewMode: 'list',
    taskGroupMode: 'custom',
    taskNavMenuOpen: false,
    taskActionLabel: '已回到任务清单',
  };
}

export function planNewTaskGroup(groupCount: number): NewTaskGroupPlan {
  const nextIndex = groupCount + 1;
  return {
    nextIndex,
    taskGroupMode: 'custom',
    taskViewMode: 'list',
    taskActionLabel: `已创建自定义分组 ${nextIndex}`,
  };
}

export function planCreateTask(localTaskCounter: number): CreateTaskPlan {
  const nextTask = createLocalTask(localTaskCounter);
  return {
    nextTask,
    tasksPane: 'owned',
    taskViewMode: 'list',
    selectedTaskId: nextTask.id,
    editingTaskId: nextTask.id,
    editingTaskDraft: buildTaskEditDraft(nextTask),
    taskActionLabel: `已创建 ${nextTask.title}`,
  };
}

export function planStartTaskEdit(task: TaskItem): StartTaskEditPlan {
  return {
    selectedTaskId: task.id,
    editingTaskId: task.id,
    editingTaskDraft: buildTaskEditDraft(task),
    taskViewMode: 'list',
    taskActionLabel: `正在编辑 ${task.title}`,
  };
}

export function planEditSelectedTask(selectedTask: TaskItem | null): StartTaskEditPlan | SelectedTaskGuardPlan {
  if (!selectedTask) {
    return { kind: 'feedback', taskActionLabel: '请先选择任务' };
  }
  return planStartTaskEdit(selectedTask);
}

export function planSaveTaskEdit(
  editingTaskId: string | null,
  editingTaskDraft: TaskEditDraft | null,
): SaveTaskEditPlan | TaskActionFeedbackPlan {
  if (!editingTaskId || !editingTaskDraft) {
    return { kind: 'feedback', taskActionLabel: '没有正在编辑的任务' };
  }
  const saved = prepareTaskEditSave(editingTaskDraft);
  return {
    kind: 'save',
    taskId: editingTaskId,
    patch: saved.patch,
    taskActionLabel: saved.taskActionLabel,
  };
}

export function planCancelTaskEdit(editingTaskDraft: TaskEditDraft | null): TaskActionFeedbackPlan | null {
  if (!editingTaskDraft) return null;
  return { kind: 'feedback', taskActionLabel: '已取消编辑' };
}

export function planDeleteSelectedTask(selectedTask: TaskItem | null): DeleteSelectedTaskPlan | SelectedTaskGuardPlan {
  if (!selectedTask) {
    return { kind: 'feedback', taskActionLabel: '请先选择任务' };
  }
  return {
    kind: 'delete',
    taskId: selectedTask.id,
    selectedTaskId: null,
    editingTaskId: null,
    editingTaskDraft: null,
    taskActionLabel: `${selectedTask.title} 已删除`,
  };
}

export function planCycleSelectedTaskStatus(
  selectedTask: TaskItem | null,
): CycleSelectedTaskStatusPlan | SelectedTaskGuardPlan {
  if (!selectedTask) {
    return { kind: 'feedback', taskActionLabel: '请先选择任务' };
  }
  const status = nextTaskStatus(selectedTask.status);
  return {
    kind: 'cycle',
    taskId: selectedTask.id,
    status,
    taskActionLabel: `${selectedTask.title} 已推进到 ${status}`,
  };
}

export function planAssignSelectedTaskToMe(
  selectedTask: TaskItem | null,
  userDisplayName?: string | undefined,
  currentUserId?: string | undefined,
): AssignSelectedTaskPlan | SelectedTaskGuardPlan {
  if (!selectedTask) {
    return { kind: 'feedback', taskActionLabel: '请先选择任务' };
  }
  const assignee = resolveTaskAssignee(userDisplayName, currentUserId);
  return {
    kind: 'assign',
    taskId: selectedTask.id,
    assignee,
    taskActionLabel: `${selectedTask.title} 已指派给 ${resolveTaskAssigneeLabel(userDisplayName)}`,
  };
}

export function planGroupBySelectedTaskProject(
  selectedTask: TaskItem | null,
): GroupBySelectedProjectPlan | SelectedTaskGuardPlan {
  if (!selectedTask) {
    return { kind: 'feedback', taskActionLabel: '请先选择任务' };
  }
  return {
    kind: 'group-project',
    taskGroupMode: 'project',
    taskViewMode: 'list',
    taskActionLabel: `已按项目查看：${selectedTask.project}`,
  };
}

export function planFilterBySelectedTaskAssignee(
  selectedTask: TaskItem | null,
  currentUserId?: string | undefined,
): FilterBySelectedAssigneePlan | SelectedTaskGuardPlan {
  if (!selectedTask) {
    return { kind: 'feedback', taskActionLabel: '请先选择任务' };
  }
  return {
    kind: 'filter-assignee',
    tasksPane: resolveFilterPaneForAssignee(selectedTask.assignee, currentUserId),
    taskFilterActive: false,
    taskActionLabel: `当前负责人：${selectedTask.assignee}`,
  };
}

export function planTaskClick(task: TaskItem, editingTaskId: string | null): TaskClickPlan {
  return {
    selectedTaskId: task.id,
    clearEdit: Boolean(editingTaskId && editingTaskId !== task.id),
    taskActionLabel: `已选中 ${task.title}`,
  };
}

export function planToolbarFieldConfig(currentlyShown: boolean): ToggleFlagPlan {
  return {
    next: !currentlyShown,
    taskActionLabel: currentlyShown ? '已隐藏创建人字段' : '已显示创建人字段',
  };
}

export function planToolbarFilter(currentlyActive: boolean): ToggleFlagPlan {
  return {
    next: !currentlyActive,
    taskActionLabel: currentlyActive ? '已关闭筛选' : '筛选已启用',
  };
}
