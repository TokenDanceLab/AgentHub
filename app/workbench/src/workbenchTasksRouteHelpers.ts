import type { TaskGroup, TaskItem, TasksPane, ViewMode } from './pages';
import type { WorkbenchTaskQueueSource } from './workbenchTaskDeepLinks';
import type { TaskEditDraft } from './pages/TasksPage';
import {
  type TaskGroupMode,
  type TaskSortMode,
} from './workbenchTaskGroups';
import {
  appendCustomTaskGroup,
  nextTaskGroupMode,
  patchTaskEditDraft,
  patchTaskInGroups,
  prependTaskToGroups,
  removeTaskFromGroups,
} from './workbenchTasksRouteGroupHelpers';
import {
  planAssignSelectedTaskToMe,
  planCancelTaskEdit,
  planCreateTask,
  planCycleSelectedTaskStatus,
  planDeleteSelectedTask,
  planEditSelectedTask,
  planFilterBySelectedTaskAssignee,
  planGroupBySelectedTaskProject,
  planNewTaskGroup,
  planSaveTaskEdit,
  planTaskClick,
  planTaskListReset,
  planTaskPaneChange,
  planTaskSortToggle,
  planToolbarFieldConfig,
  planToolbarFilter,
} from './workbenchTasksRoutePlanners';

/* ═══════════════════════════════════════════════════════════════════════
   workbenchTasksRouteHelpers — residual handler factory + public re-export
   barrel for tasks-route pure slices (#719, #769).

   Group/draft/mode helpers live in workbenchTasksRouteGroupHelpers;
   action-plan / label builders live in workbenchTasksRoutePlanners.
   This module keeps the handler factory and stable public exports.
   No React hooks / no intentional UX change.
   exactOptionalPropertyTypes: only assign `?: T` fields when defined,
   unless the public field type explicitly allows `| undefined`.
   ═══════════════════════════════════════════════════════════════════════ */

export {
  resolveSourceTaskGroups,
  buildTaskEditDraft,
  nextTaskSortMode,
  nextTaskGroupMode,
  patchTaskInGroups,
  removeTaskFromGroups,
  nextTaskStatus,
  resolveTaskAssignee,
  resolveTaskAssigneeLabel,
  prependTaskToGroups,
  appendCustomTaskGroup,
  prepareTaskEditSave,
  patchTaskEditDraft,
  resolveFilterPaneForAssignee,
} from './workbenchTasksRouteGroupHelpers';

export {
  buildTaskPaneChangeLabel,
  planTaskPaneChange,
  buildTaskSortActionLabel,
  planTaskSortToggle,
  planTaskListReset,
  planNewTaskGroup,
  planCreateTask,
  planStartTaskEdit,
  planEditSelectedTask,
  planSaveTaskEdit,
  planCancelTaskEdit,
  planDeleteSelectedTask,
  planCycleSelectedTaskStatus,
  planAssignSelectedTaskToMe,
  planGroupBySelectedTaskProject,
  planFilterBySelectedTaskAssignee,
  planTaskClick,
  planToolbarFieldConfig,
  planToolbarFilter,
  type TaskSelectionReset,
  type TaskPaneChangePlan,
  type CreateTaskPlan,
  type NewTaskGroupPlan,
  type TaskListResetPlan,
  type TaskSortTogglePlan,
  type StartTaskEditPlan,
  type SaveTaskEditPlan,
  type TaskActionFeedbackPlan,
  type SelectedTaskGuardPlan,
  type DeleteSelectedTaskPlan,
  type CycleSelectedTaskStatusPlan,
  type AssignSelectedTaskPlan,
  type GroupBySelectedProjectPlan,
  type FilterBySelectedAssigneePlan,
  type TaskClickPlan,
  type ToggleFlagPlan,
} from './workbenchTasksRoutePlanners';

export interface UseWorkbenchTasksRouteOptions {
  realDataMode: boolean;
  currentUserId?: string | undefined;
  userDisplayName?: string | undefined;
  taskQueueSource?: WorkbenchTaskQueueSource | undefined;
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
  /**
   * Whether more mock tasks are available (mock data-layer cursor pagination,
   * #1510). False in realDataMode — the parent owns taskGroups there.
   */
  hasMore: boolean;
  /** Whether a load-more page fetch is in flight. */
  loadingMore: boolean;
  /** Appends the next page of mock tasks; undefined in realDataMode. */
  onLoadMore: (() => void) | undefined;
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
