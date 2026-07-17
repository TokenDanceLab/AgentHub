import { describe, expect, it } from 'vitest';
import type { TaskGroup, TaskItem } from './pages';
import {
  appendCustomTaskGroup,
  buildTaskEditDraft,
  buildTaskPaneChangeLabel,
  buildTaskSortActionLabel,
  buildWorkbenchTasksRouteHandlers,
  nextTaskGroupMode,
  nextTaskSortMode,
  nextTaskStatus,
  patchTaskEditDraft,
  patchTaskInGroups,
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
  prepareTaskEditSave,
  prependTaskToGroups,
  removeTaskFromGroups,
  resolveFilterPaneForAssignee,
  resolveSourceTaskGroups,
  resolveTaskAssignee,
  resolveTaskAssigneeLabel,
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

describe('workbenchTasksRouteHelpers', () => {
  it('resolves source task groups for mock and real modes', () => {
    const mock = [{ label: 'mock', tasks: [TASK] }];
    expect(resolveSourceTaskGroups(true, [])).toEqual([]);
    expect(resolveSourceTaskGroups(true, GROUPS)).toEqual(GROUPS);
    expect(resolveSourceTaskGroups(false, [], mock)).toEqual(mock);
    expect(resolveSourceTaskGroups(false, GROUPS, mock)).toEqual(GROUPS);
  });

  it('builds edit drafts and create/start edit plans', () => {
    expect(buildTaskEditDraft(TASK)).toEqual({
      title: TASK.title,
      project: TASK.project,
      assignee: TASK.assignee,
      startTime: TASK.startTime,
      dueDate: TASK.dueDate,
      creator: TASK.creator,
    });

    const created = planCreateTask(3);
    expect(created.nextTask.id).toBe('local-task-3');
    expect(created.selectedTaskId).toBe(created.nextTask.id);
    expect(created.editingTaskDraft.title).toBe(created.nextTask.title);
    expect(created.tasksPane).toBe('owned');
    expect(created.taskViewMode).toBe('list');
    expect(created.taskActionLabel).toContain(created.nextTask.title);

    const started = planEditSelectedTask(TASK);
    expect(started).toMatchObject({
      selectedTaskId: 't1',
      editingTaskId: 't1',
      taskViewMode: 'list',
      taskActionLabel: `正在编辑 ${TASK.title}`,
    });
    expect(planEditSelectedTask(null)).toEqual({
      kind: 'feedback',
      taskActionLabel: '请先选择任务',
    });
  });

  it('plans pane/list/sort/group transitions and labels', () => {
    expect(planTaskPaneChange('owned')).toEqual({
      tasksPane: 'owned',
      selectedTaskId: null,
      editingTaskId: null,
      editingTaskDraft: null,
      taskNavMenuOpen: false,
      taskActionLabel: '已切换到我负责的',
    });
    expect(buildTaskPaneChangeLabel('watching')).toBe('已切换到我关注的');
    expect(buildTaskPaneChangeLabel('activity')).toBe('已切换到动态');
    expect(buildTaskPaneChangeLabel('done')).toBe('已切换到已完成');
    expect(buildTaskPaneChangeLabel('all')).toBe('已切换到任务视图');

    expect(planTaskListReset()).toEqual({
      taskViewMode: 'list',
      taskGroupMode: 'custom',
      taskNavMenuOpen: false,
      taskActionLabel: '已回到任务清单',
    });

    expect(nextTaskSortMode('custom')).toBe('due');
    expect(nextTaskSortMode('due')).toBe('custom');
    expect(planTaskSortToggle('custom')).toEqual({
      next: 'due',
      taskActionLabel: '已按截止时间排序',
    });
    expect(buildTaskSortActionLabel('custom')).toBe('已恢复拖拽自定义排序');

    expect(nextTaskGroupMode('custom')).toBe('project');
    expect(nextTaskGroupMode('project')).toBe('status');
    expect(nextTaskGroupMode('status')).toBe('custom');
    expect(planNewTaskGroup(2)).toEqual({
      nextIndex: 3,
      taskGroupMode: 'custom',
      taskViewMode: 'list',
      taskActionLabel: '已创建自定义分组 3',
    });
  });

  it('mutates task groups immutably for patch/remove/prepend/append', () => {
    const patched = patchTaskInGroups(GROUPS, 't1', { status: '待评审' });
    expect(patched[0]?.tasks[0]?.status).toBe('待评审');
    expect(GROUPS[0]?.tasks[0]?.status).toBe('进行中');

    const removed = removeTaskFromGroups(GROUPS, 't1');
    expect(removed[0]?.tasks.map((task) => task.id)).toEqual(['t2']);
    expect(removed.some((group) => group.label === '自定义分组 1')).toBe(true);

    const emptied = removeTaskFromGroups(
      [{ label: '默认分组', tasks: [TASK] }],
      't1',
    );
    expect(emptied).toEqual([]);

    const prependedEmpty = prependTaskToGroups([], TASK);
    expect(prependedEmpty).toEqual([{ label: '默认分组', tasks: [TASK] }]);

    const prepended = prependTaskToGroups(GROUPS, { ...TASK, id: 't0', title: '新任务' });
    expect(prepended[0]?.tasks[0]?.id).toBe('t0');
    expect(prepended[0]?.tasks).toHaveLength(3);

    const appended = appendCustomTaskGroup(GROUPS, 4);
    expect(appended[appended.length - 1]).toEqual({ label: '自定义分组 4', tasks: [] });
  });

  it('advances status and resolves assignee labels', () => {
    expect(nextTaskStatus('未开始')).toBe('进行中');
    expect(nextTaskStatus('进行中')).toBe('待评审');
    expect(nextTaskStatus('已完成')).toBe('未开始');
    expect(nextTaskStatus(undefined)).toBe('进行中');

    expect(resolveTaskAssignee('Alice', 'u1')).toBe('Alice');
    expect(resolveTaskAssignee(undefined, 'u1')).toBe('u1');
    expect(resolveTaskAssignee(undefined, undefined)).toBe('当前用户');
    expect(resolveTaskAssigneeLabel('Alice')).toBe('Alice');
    expect(resolveTaskAssigneeLabel(undefined)).toBe('当前用户');
  });

  it('plans save/cancel/delete/cycle/assign/group/filter actions', () => {
    const saved = planSaveTaskEdit('t1', {
      title: '  标题  ',
      project: 'P',
      assignee: 'A',
      startTime: 's',
      dueDate: 'd',
      creator: 'c',
    });
    expect(saved).toEqual({
      kind: 'save',
      taskId: 't1',
      patch: {
        title: '标题',
        project: 'P',
        assignee: 'A',
        startTime: 's',
        dueDate: 'd',
        creator: 'c',
      },
      taskActionLabel: '标题 已保存',
    });
    expect(planSaveTaskEdit(null, null)).toEqual({
      kind: 'feedback',
      taskActionLabel: '没有正在编辑的任务',
    });
    expect(prepareTaskEditSave({
      title: '   ',
      project: 'P',
      assignee: 'A',
      startTime: 's',
      dueDate: 'd',
      creator: 'c',
    }).title).toBe('未命名任务');

    expect(planCancelTaskEdit(buildTaskEditDraft(TASK))).toEqual({
      kind: 'feedback',
      taskActionLabel: '已取消编辑',
    });
    expect(planCancelTaskEdit(null)).toBeNull();

    expect(planDeleteSelectedTask(null)).toEqual({
      kind: 'feedback',
      taskActionLabel: '请先选择任务',
    });
    expect(planDeleteSelectedTask(TASK)).toEqual({
      kind: 'delete',
      taskId: 't1',
      selectedTaskId: null,
      editingTaskId: null,
      editingTaskDraft: null,
      taskActionLabel: `${TASK.title} 已删除`,
    });

    expect(planCycleSelectedTaskStatus(TASK)).toEqual({
      kind: 'cycle',
      taskId: 't1',
      status: '待评审',
      taskActionLabel: `${TASK.title} 已推进到 待评审`,
    });

    expect(planAssignSelectedTaskToMe(TASK, 'Alice', 'u1')).toEqual({
      kind: 'assign',
      taskId: 't1',
      assignee: 'Alice',
      taskActionLabel: `${TASK.title} 已指派给 Alice`,
    });
    expect(planAssignSelectedTaskToMe(TASK, undefined, 'u1')).toEqual({
      kind: 'assign',
      taskId: 't1',
      assignee: 'u1',
      taskActionLabel: `${TASK.title} 已指派给 当前用户`,
    });

    expect(planGroupBySelectedTaskProject(TASK)).toEqual({
      kind: 'group-project',
      taskGroupMode: 'project',
      taskViewMode: 'list',
      taskActionLabel: '已按项目查看：AgentHub',
    });

    expect(planFilterBySelectedTaskAssignee(TASK, 'Builder')).toEqual({
      kind: 'filter-assignee',
      tasksPane: 'owned',
      taskFilterActive: false,
      taskActionLabel: '当前负责人：Builder',
    });
    expect(resolveFilterPaneForAssignee('u2', 'u1')).toBe('all');
  });

  it('plans click and toolbar toggles; patches drafts', () => {
    expect(planTaskClick(TASK, 'other')).toEqual({
      selectedTaskId: 't1',
      clearEdit: true,
      taskActionLabel: `已选中 ${TASK.title}`,
    });
    expect(planTaskClick(TASK, 't1').clearEdit).toBe(false);
    expect(planTaskClick(TASK, null).clearEdit).toBe(false);

    expect(planToolbarFieldConfig(true)).toEqual({
      next: false,
      taskActionLabel: '已隐藏创建人字段',
    });
    expect(planToolbarFieldConfig(false)).toEqual({
      next: true,
      taskActionLabel: '已显示创建人字段',
    });
    expect(planToolbarFilter(true)).toEqual({
      next: false,
      taskActionLabel: '已关闭筛选',
    });
    expect(planToolbarFilter(false)).toEqual({
      next: true,
      taskActionLabel: '筛选已启用',
    });

    expect(patchTaskEditDraft(null, 'title', 'x')).toBeNull();
    expect(patchTaskEditDraft(buildTaskEditDraft(TASK), 'assignee', 'Me')?.assignee).toBe('Me');
  });

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
