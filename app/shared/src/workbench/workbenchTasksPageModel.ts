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
  viewMode: ViewMode,
  groupMode: TaskGroupMode,
): string {
  if (viewMode === 'board') return '分组：状态看板';
  if (viewMode === 'dashboard') return '分组：项目仪表盘';
  if (groupMode === 'project') return '分组：所属项目';
  if (groupMode === 'status') return '分组：任务状态';
  return '分组：自定义分组';
}

export function buildTaskSortLabel(sortMode: TaskSortMode): string {
  return sortMode === 'custom' ? '排序：拖拽自定义' : '排序：截止时间';
}

export function buildTaskFieldConfigLabel(showCreator: boolean): string {
  return showCreator ? '字段配置' : '字段配置 5/6';
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
  realDataMode: boolean;
  taskFilterActive: boolean;
  taskGroupMode: TaskGroupMode;
  taskShowCreator: boolean;
  taskSortMode: TaskSortMode;
  taskViewMode: ViewMode;
  visibleTasks: TaskItem[];
}): TasksPageDerivedModel {
  const {
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
    fieldConfigLabel: buildTaskFieldConfigLabel(taskShowCreator),
    groupActive: taskGroupMode !== 'custom' || taskViewMode !== 'list',
    groupLabel: buildTaskGroupLabel(taskViewMode, taskGroupMode),
    incompleteCount: countIncompleteTasks(visibleTasks),
    sortActive: taskSortMode !== 'custom',
    sortLabel: buildTaskSortLabel(taskSortMode),
  };
}
