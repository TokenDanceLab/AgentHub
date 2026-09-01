import type { TFunction } from 'i18next';
import type { TaskItem, ViewMode } from './pages';
import type { TaskGroupMode, TaskSortMode } from './workbenchTaskGroups';

export interface TasksPageDerivedModel {
  activeFilterCount: number;
  crossProjectCount: number;
  dueTodayCount: number;
  /**
   * Real data mode has no task backend yet (#1818): the page renders an
   * honest "coming soon" empty state instead of replay/mock task rows.
   */
  tasksComingSoon: boolean;
  fieldConfigActive: boolean;
  fieldConfigLabel: string;
  groupActive: boolean;
  groupLabel: string;
  incompleteCount: number;
  sortActive: boolean;
  sortLabel: string;
}

export function buildTaskGroupLabel(
  t: TFunction,
  viewMode: ViewMode,
  groupMode: TaskGroupMode,
): string {
  if (viewMode === 'board') return t('tasks.group.boardStatus');
  if (viewMode === 'dashboard') return t('tasks.group.projectDashboard');
  if (groupMode === 'project') return t('tasks.group.byProject');
  if (groupMode === 'status') return t('tasks.group.byStatus');
  return t('tasks.group.custom');
}

export function buildTaskSortLabel(t: TFunction, sortMode: TaskSortMode): string {
  return sortMode === 'custom' ? t('tasks.sort.custom') : t('tasks.sort.dueDate');
}

export function buildTaskFieldConfigLabel(t: TFunction, showCreator: boolean): string {
  return showCreator ? t('tasks.fieldConfig.basic') : t('tasks.fieldConfig.short');
}

export function countDueTodayTasks(tasks: TaskItem[]): number {
  return tasks.filter((task) => task.dueDate.includes('今天')).length;
}

export function countIncompleteTasks(tasks: TaskItem[]): number {
  return tasks.filter((task) => task.status !== '已完成').length;
}

export function countCrossProjectTasks(tasks: TaskItem[]): number {
  return new Set(tasks.map((task) => task.project)).size;
}

/** Pure derived TasksPage toolbar/stat fields assembled from route state. */
export function buildTasksPageDerivedModel(input: {
  t: TFunction;
  realDataMode: boolean;
  taskFilterActive: boolean;
  taskGroupMode: TaskGroupMode;
  taskShowCreator: boolean;
  taskSortMode: TaskSortMode;
  taskViewMode: ViewMode;
  visibleTasks: TaskItem[];
}): TasksPageDerivedModel {
  const {
    t,
    realDataMode,
    taskFilterActive,
    taskGroupMode,
    taskShowCreator,
    taskSortMode,
    taskViewMode,
    visibleTasks,
  } = input;

  return {
    activeFilterCount: taskFilterActive ? 1 : 0,
    crossProjectCount: countCrossProjectTasks(visibleTasks),
    dueTodayCount: countDueTodayTasks(visibleTasks),
    tasksComingSoon: realDataMode && visibleTasks.length === 0,
    fieldConfigActive: !taskShowCreator,
    fieldConfigLabel: buildTaskFieldConfigLabel(t, taskShowCreator),
    groupActive: taskGroupMode !== 'custom' || taskViewMode !== 'list',
    groupLabel: buildTaskGroupLabel(t, taskViewMode, taskGroupMode),
    incompleteCount: countIncompleteTasks(visibleTasks),
    sortActive: taskSortMode !== 'custom',
    sortLabel: buildTaskSortLabel(t, taskSortMode),
  };
}
