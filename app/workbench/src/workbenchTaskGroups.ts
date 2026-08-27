import type { TaskGroup, TaskItem, TasksPane, ViewMode } from './pages';
import {
  BOARD_COLUMNS_IN_DISPLAY_ORDER,
  TASK_STATUS_SEQUENCE,
} from './workbenchBoardColumns';

export type TaskSortMode = 'custom' | 'due';
export type TaskGroupMode = 'custom' | 'project' | 'status';

/**
 * Lifecycle status sequence — owned by the board-column SSOT (#1999);
 * re-exported so existing consumers keep their import path.
 */
export { TASK_STATUS_SEQUENCE };

export const DESIGN_DONE_TASK: TaskItem = {
  id: 'readme-structure-done',
  title: 'README 结构更新',
  project: '文档重构',
  assignee: 'Builder',
  startTime: '6月2日',
  dueDate: '6月2日',
  creator: 'Johnny',
  status: '已完成',
};

export const WATCHING_TASK_IDS = new Set(['embedded-docs', 'project-announcement']);
export const ACTIVITY_TASK_IDS = new Set(['sqlite-plan', 'project-announcement', 'agent-market']);

export function flattenTaskGroups(groups: TaskGroup[]): TaskItem[] {
  return groups.flatMap((group) => group.tasks);
}

export function taskMatchesPane(task: TaskItem, pane: TasksPane, currentUserId?: string): boolean {
  switch (pane) {
    case 'watching':
      return WATCHING_TASK_IDS.has(task.id) || task.project === 'AgentHub 设计评审';
    case 'activity':
      return ACTIVITY_TASK_IDS.has(task.id) || task.startTime === '刚刚';
    case 'created':
      return currentUserId ? task.creator === currentUserId : false;
    case 'assigned':
      return currentUserId ? task.creator === currentUserId && task.assignee !== currentUserId : false;
    case 'done':
      return task.status === '已完成';
    case 'owned':
    case 'all':
    default:
      return true;
  }
}

export function dueRank(label: string): number {
  if (label.includes('今天')) return 0;
  if (label.includes('明天')) return 1;
  const match = /(\d+)月(\d+)日/.exec(label);
  if (match) return Number(match[1]) * 100 + Number(match[2]);
  return 9999;
}

export function sortTasks(tasks: TaskItem[], mode: TaskSortMode): TaskItem[] {
  if (mode === 'custom') return tasks;
  return [...tasks].sort((a, b) => (
    dueRank(a.dueDate) - dueRank(b.dueDate)
    || a.title.localeCompare(b.title, 'zh-Hans-CN')
  ));
}

export function groupTasks(tasks: TaskItem[], mode: TaskGroupMode): TaskGroup[] {
  if (mode === 'custom') return [{ label: '默认分组', tasks }];

  // Status groups derive 1:1 from the board-column SSOT (#1999): each
  // group carries its column id/tone so board chrome never re-derives the
  // mapping locally.
  if (mode === 'status') {
    return BOARD_COLUMNS_IN_DISPLAY_ORDER
      .map((column) => ({
        label: column.label,
        tasks: tasks.filter((task) => task.status === column.status),
        columnId: column.id,
        tone: column.tone,
      }))
      .filter((group) => group.tasks.length > 0);
  }

  return Array.from(new Set(tasks.map((task) => task.project)))
    .map((label) => ({
      label,
      tasks: tasks.filter((task) => task.project === label),
    }))
    .filter((group) => group.tasks.length > 0);
}

export function buildTaskGroups(
  sourceGroups: TaskGroup[],
  pane: TasksPane,
  filterActive: boolean,
  sortMode: TaskSortMode,
  groupMode: TaskGroupMode,
  viewMode: ViewMode,
  currentUserId?: string,
): TaskGroup[] {
  const filteredGroups = sourceGroups
    .map((group) => ({
      ...group,
      tasks: sortTasks(
        group.tasks.filter((task) => (
          taskMatchesPane(task, pane, currentUserId)
          && (pane === 'done' || !filterActive || task.status !== '已完成')
        )),
        sortMode,
      ),
    }))
    .filter((group) => group.tasks.length > 0 || (
      groupMode === 'custom' && group.label.startsWith('自定义分组')
    ));

  let groups = filteredGroups;
  if (pane === 'done' && flattenTaskGroups(groups).length === 0) {
    groups = [{ label: '默认分组', tasks: [DESIGN_DONE_TASK] }];
  }

  const nextGroupMode = viewMode === 'board'
    ? 'status'
    : viewMode === 'dashboard'
      ? 'project'
      : groupMode;
  if (nextGroupMode !== 'custom') {
    return groupTasks(sortTasks(flattenTaskGroups(groups), sortMode), nextGroupMode);
  }

  return groups.length > 0 ? groups : [{ label: '默认分组', tasks: [] }];
}

export function createLocalTask(index: number): TaskItem {
  return {
    id: `local-task-${index}`,
    title: `未命名任务 ${index}`,
    project: '前端重构任务',
    assignee: 'Builder',
    startTime: '刚刚',
    dueDate: '今天 22:00',
    creator: '当前用户',
    status: '未开始',
  };
}
