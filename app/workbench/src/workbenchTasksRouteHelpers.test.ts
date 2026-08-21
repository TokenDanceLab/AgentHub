import { describe, expect, it } from 'vitest';
import type { TaskGroup, TaskItem } from './pages';
import {
  buildTaskEditDraft,
  buildWorkbenchTasksRouteHandlers,
  type WorkbenchTasksRouteStateAccessors,
} from './workbenchTasksRouteHelpers';

const TASK: TaskItem = {
  id: 't1',
  title: '  修 bug  ',
  project: 'AgentHub',
  assignee: 'Builder',
  startTime: '今天 10:00',
  dueDate: '今天 18:00',
  creator: 'Johnny',
  status: '进行中',
};

const GROUPS: TaskGroup[] = [
  {
    label: '默认分组',
    tasks: [TASK, { ...TASK, id: 't2', title: '第二项', status: '未开始' }],
  },
  {
    label: '自定义分组 1',
    tasks: [],
  },
];

describe('workbenchTasksRouteHelpers handlers', () => {
  it('builds route handlers that apply create/delete/cycle plans to state setters', () => {
    let taskGroups = GROUPS.map((group) => ({
      ...group,
      tasks: group.tasks.map((task) => ({ ...task })),
    }));
    let selectedTaskId: string | null = 't1';
    let editingTaskId: string | null = null;
    let editingTaskDraft = null as ReturnType<typeof buildTaskEditDraft> | null;
    let taskActionLabel = '筛选已启用';
    let localTaskCounter = 1;
    let tasksPane: import('./pages').TasksPane = 'owned';
    let taskViewMode: import('./pages').ViewMode = 'list';
    let taskFilterActive = true;
    let taskSortMode: 'custom' | 'due' = 'custom';
    let taskGroupMode: 'custom' | 'project' | 'status' = 'custom';
    let taskShowCreator = true;
    let taskNavMenuOpen = false;

    const access: WorkbenchTasksRouteStateAccessors = {
      get taskGroups() { return taskGroups; },
      get selectedTask() {
        return taskGroups.flatMap((group) => group.tasks).find((task) => task.id === selectedTaskId) ?? null;
      },
      get editingTaskId() { return editingTaskId; },
      get editingTaskDraft() { return editingTaskDraft; },
      get localTaskCounter() { return localTaskCounter; },
      currentUserId: 'Builder',
      userDisplayName: 'Builder',
      setTasksPane: (value) => {
        tasksPane = typeof value === 'function' ? value(tasksPane) : value;
      },
      setTaskViewMode: (value) => {
        taskViewMode = typeof value === 'function' ? value(taskViewMode) : value;
      },
      setTaskGroups: (value) => {
        taskGroups = typeof value === 'function' ? value(taskGroups) : value;
      },
      setTaskFilterActive: (value) => {
        taskFilterActive = typeof value === 'function' ? value(taskFilterActive) : value;
      },
      setTaskSortMode: (value) => {
        taskSortMode = typeof value === 'function' ? value(taskSortMode) : value;
      },
      setTaskGroupMode: (value) => {
        taskGroupMode = typeof value === 'function' ? value(taskGroupMode) : value;
      },
      setTaskShowCreator: (value) => {
        taskShowCreator = typeof value === 'function' ? value(taskShowCreator) : value;
      },
      setSelectedTaskId: (value) => {
        selectedTaskId = typeof value === 'function' ? value(selectedTaskId) : value;
      },
      setTaskNavMenuOpen: (value) => {
        taskNavMenuOpen = typeof value === 'function' ? value(taskNavMenuOpen) : value;
      },
      setTaskActionLabel: (value) => {
        taskActionLabel = typeof value === 'function' ? value(taskActionLabel) : value;
      },
      setEditingTaskId: (value) => {
        editingTaskId = typeof value === 'function' ? value(editingTaskId) : value;
      },
      setEditingTaskDraft: (value) => {
        editingTaskDraft = typeof value === 'function' ? value(editingTaskDraft) : value;
      },
      setLocalTaskCounter: (value) => {
        localTaskCounter = typeof value === 'function' ? value(localTaskCounter) : value;
      },
    };

    const handlers = buildWorkbenchTasksRouteHandlers(access);

    handlers.handleCreateTask();
    expect(localTaskCounter).toBe(2);
    expect(selectedTaskId).toBe('local-task-1');
    expect(editingTaskId).toBe('local-task-1');
    expect(taskGroups[0]?.tasks[0]?.id).toBe('local-task-1');
    expect(taskActionLabel).toContain('已创建');

    selectedTaskId = 't1';
    handlers.handleCycleSelectedTaskStatus();
    expect(taskGroups[0]?.tasks.find((task) => task.id === 't1')?.status).toBe('待评审');
    expect(taskActionLabel).toContain('已推进到 待评审');

    handlers.handleDeleteSelectedTask();
    expect(taskGroups[0]?.tasks.some((task) => task.id === 't1')).toBe(false);
    expect(selectedTaskId).toBeNull();
    expect(taskActionLabel).toContain('已删除');

    handlers.handleTaskPaneChange('done');
    expect(tasksPane).toBe('done');
    expect(taskNavMenuOpen).toBe(false);
    expect(taskActionLabel).toBe('已切换到已完成');

    handlers.handleTaskSort();
    expect(taskSortMode).toBe('due');
    handlers.handleToolbarFilter();
    expect(taskFilterActive).toBe(false);
    handlers.handleToolbarFieldConfig();
    expect(taskShowCreator).toBe(false);
    handlers.handleTaskList();
    expect(taskViewMode).toBe('list');
    expect(taskGroupMode).toBe('custom');
  });
});
