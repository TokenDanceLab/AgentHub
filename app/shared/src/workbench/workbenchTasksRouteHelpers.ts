import type { TaskGroup, TaskItem, TaskStatus, TasksPane, ViewMode } from './pages';
import type { TaskEditDraft } from './pages/TasksPage';
import { WORKBENCH_MOCK_TASK_GROUPS } from './mockData';
import {
  TASK_STATUS_SEQUENCE,
  type TaskGroupMode,
  type TaskSortMode,
  createLocalTask,
} from './workbenchTaskGroups';

/* ═══════════════════════════════════════════════════════════════════════
   workbenchTasksRouteHelpers — pure residual slices from
   useWorkbenchTasksRoute (#719).

   Public option/return types, source-group resolution, edit drafts,
   task-group mutations, status/assignee/pane/sort/group planners, and
   action-label builders. No React hooks / no intentional UX change.
   exactOptionalPropertyTypes: only assign `?: T` fields when defined,
   unless the public field type explicitly allows `| undefined`.
   ═══════════════════════════════════════════════════════════════════════ */

export interface UseWorkbenchTasksRouteOptions {
  realDataMode: boolean;
  currentUserId?: string | undefined;
  userDisplayName?: string | undefined;
}

export interface WorkbenchTasksRoute {
  tasksPane: TasksPane;
  taskViewMode: ViewMode;
  taskFilterActive: boolean;
  taskSortMode: TaskSortMode;
  taskGroupMode: TaskGroupMode;
  taskShowCreator: boolean;
  selectedTaskId: string | null;
  taskNavMenuOpen: boolean;
  taskActionLabel: string;
  editingTaskId: string | null;
  editingTaskDraft: TaskEditDraft | null;
  sourceTaskGroups: TaskGroup[];
  visibleTaskGroups: TaskGroup[];
  visibleTasks: TaskItem[];
  selectedTask: TaskItem | null;
  setTaskViewMode: (mode: ViewMode) => void;
  handleTaskPaneChange: (pane: TasksPane) => void;
  handleCreateTask: () => void;
  handleNewTaskGroup: () => void;
  handleTaskList: () => void;
  handleTaskSort: () => void;
  handleTaskGroup: () => void;
  handleEditSelectedTask: () => void;
  handleEditTaskDraftChange: (field: keyof TaskEditDraft, value: string) => void;
  handleSaveTaskEdit: () => void;
  handleCancelTaskEdit: () => void;
  handleDeleteSelectedTask: () => void;
  handleCycleSelectedTaskStatus: () => void;
  handleAssignSelectedTaskToMe: () => void;
  handleGroupBySelectedTaskProject: () => void;
  handleFilterBySelectedTaskAssignee: () => void;
  handleTaskClick: (task: TaskItem) => void;
  handleNavMore: () => void;
  handleToolbarFieldConfig: () => void;
  handleToolbarFilter: () => void;
}

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

export function nextTaskSortMode(current: TaskSortMode): TaskSortMode {
  return current === 'custom' ? 'due' : 'custom';
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

export function nextTaskGroupMode(current: TaskGroupMode): TaskGroupMode {
  return current === 'custom' ? 'project' : current === 'project' ? 'status' : 'custom';
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
  userDisplayName?: string | undefined,
): string {
  return userDisplayName ?? '当前用户';
}

export function prependTaskToGroups(groups: TaskGroup[], task: TaskItem): TaskGroup[] {
  const [first, ...rest] = groups;
  if (!first) return [{ label: '默认分组', tasks: [task] }];
  return [{ ...first, tasks: [task, ...first.tasks] }, ...rest];
}

export function appendCustomTaskGroup(groups: TaskGroup[], nextIndex: number): TaskGroup[] {
  return [...groups, { label: `自定义分组 ${nextIndex}`, tasks: [] }];
}

export function prepareTaskEditSave(draft: TaskEditDraft): {
  title: string;
  patch: TaskEditDraft;
  taskActionLabel: string;
} {
  const title = draft.title.trim() || '未命名任务';
  const patch = { ...draft, title };
  return {
    title,
    patch,
    taskActionLabel: `${title} 已保存`,
  };
}

export function patchTaskEditDraft(
  current: TaskEditDraft | null,
  field: keyof TaskEditDraft,
  value: string,
): TaskEditDraft | null {
  return current ? { ...current, [field]: value } : current;
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

export function resolveFilterPaneForAssignee(
  assignee: string,
  currentUserId?: string | undefined,
): TasksPane {
  return assignee === currentUserId ? 'owned' : 'all';
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

/** Minimal setState signature so handlers stay React-hook free. */
export type TasksRouteSetState<T> = (value: T | ((prev: T) => T)) => void;

export interface WorkbenchTasksRouteStateAccessors {
  taskGroups: TaskGroup[];
  selectedTask: TaskItem | null;
  editingTaskId: string | null;
  editingTaskDraft: TaskEditDraft | null;
  localTaskCounter: number;
  currentUserId?: string | undefined;
  userDisplayName?: string | undefined;
  setTasksPane: TasksRouteSetState<TasksPane>;
  setTaskViewMode: TasksRouteSetState<ViewMode>;
  setTaskGroups: TasksRouteSetState<TaskGroup[]>;
  setTaskFilterActive: TasksRouteSetState<boolean>;
  setTaskSortMode: TasksRouteSetState<TaskSortMode>;
  setTaskGroupMode: TasksRouteSetState<TaskGroupMode>;
  setTaskShowCreator: TasksRouteSetState<boolean>;
  setSelectedTaskId: TasksRouteSetState<string | null>;
  setTaskNavMenuOpen: TasksRouteSetState<boolean>;
  setTaskActionLabel: TasksRouteSetState<string>;
  setEditingTaskId: TasksRouteSetState<string | null>;
  setEditingTaskDraft: TasksRouteSetState<TaskEditDraft | null>;
  setLocalTaskCounter: TasksRouteSetState<number>;
}

export type WorkbenchTasksRouteHandlers = Pick<
  WorkbenchTasksRoute,
  | 'handleTaskPaneChange'
  | 'handleCreateTask'
  | 'handleNewTaskGroup'
  | 'handleTaskList'
  | 'handleTaskSort'
  | 'handleTaskGroup'
  | 'handleEditSelectedTask'
  | 'handleEditTaskDraftChange'
  | 'handleSaveTaskEdit'
  | 'handleCancelTaskEdit'
  | 'handleDeleteSelectedTask'
  | 'handleCycleSelectedTaskStatus'
  | 'handleAssignSelectedTaskToMe'
  | 'handleGroupBySelectedTaskProject'
  | 'handleFilterBySelectedTaskAssignee'
  | 'handleTaskClick'
  | 'handleNavMore'
  | 'handleToolbarFieldConfig'
  | 'handleToolbarFilter'
>;

/** Build all TasksRoute event handlers from pure planners + state setters. */
export function buildWorkbenchTasksRouteHandlers(
  access: WorkbenchTasksRouteStateAccessors,
): WorkbenchTasksRouteHandlers {
  const {
    taskGroups,
    selectedTask,
    editingTaskId,
    editingTaskDraft,
    localTaskCounter,
    currentUserId,
    userDisplayName,
    setTasksPane,
    setTaskViewMode,
    setTaskGroups,
    setTaskFilterActive,
    setTaskSortMode,
    setTaskGroupMode,
    setTaskShowCreator,
    setSelectedTaskId,
    setTaskNavMenuOpen,
    setTaskActionLabel,
    setEditingTaskId,
    setEditingTaskDraft,
    setLocalTaskCounter,
  } = access;

  return {
    handleTaskPaneChange(pane) {
      const plan = planTaskPaneChange(pane);
      setTasksPane(plan.tasksPane);
      setSelectedTaskId(plan.selectedTaskId);
      setEditingTaskId(plan.editingTaskId);
      setEditingTaskDraft(plan.editingTaskDraft);
      setTaskNavMenuOpen(plan.taskNavMenuOpen);
      setTaskActionLabel(plan.taskActionLabel);
    },
    handleCreateTask() {
      const plan = planCreateTask(localTaskCounter);
      setLocalTaskCounter((current) => current + 1);
      setTaskGroups((current) => prependTaskToGroups(current, plan.nextTask));
      setTasksPane(plan.tasksPane);
      setTaskViewMode(plan.taskViewMode);
      setSelectedTaskId(plan.selectedTaskId);
      setEditingTaskId(plan.editingTaskId);
      setEditingTaskDraft(plan.editingTaskDraft);
      setTaskActionLabel(plan.taskActionLabel);
    },
    handleNewTaskGroup() {
      const plan = planNewTaskGroup(taskGroups.length);
      setTaskGroups((current) => appendCustomTaskGroup(current, plan.nextIndex));
      setTaskGroupMode(plan.taskGroupMode);
      setTaskViewMode(plan.taskViewMode);
      setTaskActionLabel(plan.taskActionLabel);
    },
    handleTaskList() {
      const plan = planTaskListReset();
      setTaskViewMode(plan.taskViewMode);
      setTaskGroupMode(plan.taskGroupMode);
      setTaskNavMenuOpen(plan.taskNavMenuOpen);
      setTaskActionLabel(plan.taskActionLabel);
    },
    handleTaskSort() {
      setTaskSortMode((current) => {
        const plan = planTaskSortToggle(current);
        setTaskActionLabel(plan.taskActionLabel);
        return plan.next;
      });
    },
    handleTaskGroup() {
      setTaskGroupMode((current) => nextTaskGroupMode(current));
      setTaskActionLabel('已切换任务分组方式');
    },
    handleEditSelectedTask() {
      const plan = planEditSelectedTask(selectedTask);
      if ('kind' in plan) {
        setTaskActionLabel(plan.taskActionLabel);
        return;
      }
      setSelectedTaskId(plan.selectedTaskId);
      setEditingTaskId(plan.editingTaskId);
      setEditingTaskDraft(plan.editingTaskDraft);
      setTaskViewMode(plan.taskViewMode);
      setTaskActionLabel(plan.taskActionLabel);
    },
    handleEditTaskDraftChange(field, value) {
      setEditingTaskDraft((current) => patchTaskEditDraft(current, field, value));
    },
    handleSaveTaskEdit() {
      const plan = planSaveTaskEdit(editingTaskId, editingTaskDraft);
      if (plan.kind === 'feedback') {
        setTaskActionLabel(plan.taskActionLabel);
        return;
      }
      setTaskGroups((current) => patchTaskInGroups(current, plan.taskId, plan.patch));
      setEditingTaskId(null);
      setEditingTaskDraft(null);
      setTaskActionLabel(plan.taskActionLabel);
    },
    handleCancelTaskEdit() {
      const plan = planCancelTaskEdit(editingTaskDraft);
      if (plan) setTaskActionLabel(plan.taskActionLabel);
      setEditingTaskId(null);
      setEditingTaskDraft(null);
    },
    handleDeleteSelectedTask() {
      const plan = planDeleteSelectedTask(selectedTask);
      if (plan.kind === 'feedback') {
        setTaskActionLabel(plan.taskActionLabel);
        return;
      }
      setTaskGroups((current) => removeTaskFromGroups(current, plan.taskId));
      setSelectedTaskId(plan.selectedTaskId);
      setEditingTaskId(plan.editingTaskId);
      setEditingTaskDraft(plan.editingTaskDraft);
      setTaskActionLabel(plan.taskActionLabel);
    },
    handleCycleSelectedTaskStatus() {
      const plan = planCycleSelectedTaskStatus(selectedTask);
      if (plan.kind === 'feedback') {
        setTaskActionLabel(plan.taskActionLabel);
        return;
      }
      setTaskGroups((current) => patchTaskInGroups(current, plan.taskId, { status: plan.status }));
      setTaskActionLabel(plan.taskActionLabel);
    },
    handleAssignSelectedTaskToMe() {
      const plan = planAssignSelectedTaskToMe(selectedTask, userDisplayName, currentUserId);
      if (plan.kind === 'feedback') {
        setTaskActionLabel(plan.taskActionLabel);
        return;
      }
      setTaskGroups((current) => patchTaskInGroups(current, plan.taskId, { assignee: plan.assignee }));
      setTaskActionLabel(plan.taskActionLabel);
    },
    handleGroupBySelectedTaskProject() {
      const plan = planGroupBySelectedTaskProject(selectedTask);
      if (plan.kind === 'feedback') {
        setTaskActionLabel(plan.taskActionLabel);
        return;
      }
      setTaskGroupMode(plan.taskGroupMode);
      setTaskViewMode(plan.taskViewMode);
      setTaskActionLabel(plan.taskActionLabel);
    },
    handleFilterBySelectedTaskAssignee() {
      const plan = planFilterBySelectedTaskAssignee(selectedTask, currentUserId);
      if (plan.kind === 'feedback') {
        setTaskActionLabel(plan.taskActionLabel);
        return;
      }
      setTasksPane(plan.tasksPane);
      setTaskFilterActive(plan.taskFilterActive);
      setTaskActionLabel(plan.taskActionLabel);
    },
    handleTaskClick(task) {
      const plan = planTaskClick(task, editingTaskId);
      setSelectedTaskId(plan.selectedTaskId);
      if (plan.clearEdit) {
        setEditingTaskId(null);
        setEditingTaskDraft(null);
      }
      setTaskActionLabel(plan.taskActionLabel);
    },
    handleNavMore() {
      setTaskNavMenuOpen((current) => !current);
      setTaskActionLabel('任务更多操作');
    },
    handleToolbarFieldConfig() {
      setTaskShowCreator((current) => {
        const plan = planToolbarFieldConfig(current);
        setTaskActionLabel(plan.taskActionLabel);
        return plan.next;
      });
    },
    handleToolbarFilter() {
      setTaskFilterActive((current) => {
        const plan = planToolbarFilter(current);
        setTaskActionLabel(plan.taskActionLabel);
        return plan.next;
      });
    },
  };
}
