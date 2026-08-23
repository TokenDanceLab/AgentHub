import { describe, expect, it } from 'vitest';
import type { TaskGroup, TaskItem, TasksPane, ViewMode } from './pages';
import type { TaskEditDraft } from './pages/TasksPage';
import type { TaskGroupMode, TaskSortMode } from './workbenchTaskGroups';
import {
  buildTaskEditDraft,
  buildWorkbenchTasksRouteHandlers,
  type WorkbenchTasksRouteHandlers,
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

/* ─────────────────────────────────────────────────────────────────────
   Handler-factory coverage harness: a mutable state box + setter wiring
   so every buildWorkbenchTasksRouteHandlers handler can be exercised in
   isolation (edit lifecycle, group/filter/assign plans, click/nav more).
   ───────────────────────────────────────────────────────────────────── */

interface TasksHarnessState {
  taskGroups: TaskGroup[];
  selectedTaskId: string | null;
  editingTaskId: string | null;
  editingTaskDraft: TaskEditDraft | null;
  localTaskCounter: number;
  tasksPane: TasksPane;
  taskViewMode: ViewMode;
  taskFilterActive: boolean;
  taskSortMode: TaskSortMode;
  taskGroupMode: TaskGroupMode;
  taskShowCreator: boolean;
  taskNavMenuOpen: boolean;
  taskActionLabel: string;
}

function createTasksHarness(
  initial?: Partial<TasksHarnessState>,
  identity?: { currentUserId?: string; userDisplayName?: string },
): { state: TasksHarnessState; build: () => WorkbenchTasksRouteHandlers } {
  const state: TasksHarnessState = {
    taskGroups: GROUPS.map((group) => ({ ...group, tasks: group.tasks.map((task) => ({ ...task })) })),
    selectedTaskId: null,
    editingTaskId: null,
    editingTaskDraft: null,
    localTaskCounter: 1,
    tasksPane: 'owned',
    taskViewMode: 'list',
    taskFilterActive: false,
    taskSortMode: 'custom',
    taskGroupMode: 'custom',
    taskShowCreator: true,
    taskNavMenuOpen: false,
    taskActionLabel: '',
    ...initial,
  };

  // buildWorkbenchTasksRouteHandlers reads the accessor getters once at build
  // time (a render snapshot). build() re-reads the current state box, which is
  // how the real hook observes fresh accessors on every render.
  const build = (): WorkbenchTasksRouteHandlers => {
    const access: WorkbenchTasksRouteStateAccessors = {
      get taskGroups() { return state.taskGroups; },
      get selectedTask() {
        return state.taskGroups.flatMap((group) => group.tasks).find((task) => task.id === state.selectedTaskId) ?? null;
      },
      get editingTaskId() { return state.editingTaskId; },
      get editingTaskDraft() { return state.editingTaskDraft; },
      get localTaskCounter() { return state.localTaskCounter; },
      currentUserId: identity?.currentUserId,
      userDisplayName: identity?.userDisplayName,
      setTasksPane: (value) => { state.tasksPane = typeof value === 'function' ? value(state.tasksPane) : value; },
      setTaskViewMode: (value) => { state.taskViewMode = typeof value === 'function' ? value(state.taskViewMode) : value; },
      setTaskGroups: (value) => { state.taskGroups = typeof value === 'function' ? value(state.taskGroups) : value; },
      setTaskFilterActive: (value) => { state.taskFilterActive = typeof value === 'function' ? value(state.taskFilterActive) : value; },
      setTaskSortMode: (value) => { state.taskSortMode = typeof value === 'function' ? value(state.taskSortMode) : value; },
      setTaskGroupMode: (value) => { state.taskGroupMode = typeof value === 'function' ? value(state.taskGroupMode) : value; },
      setTaskShowCreator: (value) => { state.taskShowCreator = typeof value === 'function' ? value(state.taskShowCreator) : value; },
      setSelectedTaskId: (value) => { state.selectedTaskId = typeof value === 'function' ? value(state.selectedTaskId) : value; },
      setTaskNavMenuOpen: (value) => { state.taskNavMenuOpen = typeof value === 'function' ? value(state.taskNavMenuOpen) : value; },
      setTaskActionLabel: (value) => { state.taskActionLabel = typeof value === 'function' ? value(state.taskActionLabel) : value; },
      setEditingTaskId: (value) => { state.editingTaskId = typeof value === 'function' ? value(state.editingTaskId) : value; },
      setEditingTaskDraft: (value) => { state.editingTaskDraft = typeof value === 'function' ? value(state.editingTaskDraft) : value; },
      setLocalTaskCounter: (value) => { state.localTaskCounter = typeof value === 'function' ? value(state.localTaskCounter) : value; },
    };
    return buildWorkbenchTasksRouteHandlers(access);
  };

  return { state, build };
}

describe('workbenchTasksRouteHandlers — group and edit lifecycle', () => {
  it('handleNewTaskGroup appends a numbered custom group and switches to custom list view', () => {
    const { state, build } = createTasksHarness({ taskGroupMode: 'project', taskViewMode: 'board' });
    const handlers = build();

    handlers.handleNewTaskGroup();

    expect(state.taskGroups.at(-1)?.label).toBe(`自定义分组 ${GROUPS.length + 1}`);
    expect(state.taskGroups.at(-1)?.tasks).toEqual([]);
    expect(state.taskGroupMode).toBe('custom');
    expect(state.taskViewMode).toBe('list');
    expect(state.taskActionLabel).toContain('已创建自定义分组');
  });

  it('handleEditSelectedTask guards an empty selection and starts editing a selected task', () => {
    const { state, build } = createTasksHarness({ selectedTaskId: null });

    build().handleEditSelectedTask();
    expect(state.editingTaskId).toBeNull();
    expect(state.taskActionLabel).toBe('请先选择任务');

    // Selecting a task is a re-render: rebuild so the handler observes it.
    state.selectedTaskId = 't2';
    build().handleEditSelectedTask();
    expect(state.selectedTaskId).toBe('t2');
    expect(state.editingTaskId).toBe('t2');
    expect(state.editingTaskDraft).toEqual(buildTaskEditDraft(state.taskGroups[0]!.tasks[1]!));
    expect(state.taskViewMode).toBe('list');
    expect(state.taskActionLabel).toContain('正在编辑');
  });

  it('handleEditTaskDraftChange patches only the given draft field and no-ops without a draft', () => {
    const { state, build } = createTasksHarness({
      editingTaskId: 't1',
      editingTaskDraft: buildTaskEditDraft(TASK),
    });

    build().handleEditTaskDraftChange('title', '新标题');
    expect(state.editingTaskDraft?.title).toBe('新标题');
    expect(state.editingTaskDraft?.project).toBe(TASK.project);

    state.editingTaskDraft = null;
    build().handleEditTaskDraftChange('title', 'ignored');
    expect(state.editingTaskDraft).toBeNull();
  });

  it('handleSaveTaskEdit reports when nothing is edited and persists the draft otherwise', () => {
    const { state, build } = createTasksHarness({ selectedTaskId: 't1' });

    build().handleSaveTaskEdit();
    expect(state.taskActionLabel).toBe('没有正在编辑的任务');

    state.editingTaskId = 't1';
    state.editingTaskDraft = { ...buildTaskEditDraft(TASK), title: '  已修复  ' };
    build().handleSaveTaskEdit();

    const saved = state.taskGroups[0]?.tasks.find((task) => task.id === 't1');
    expect(saved?.title).toBe('已修复');
    expect(state.editingTaskId).toBeNull();
    expect(state.editingTaskDraft).toBeNull();
    expect(state.taskActionLabel).toBe('已修复 已保存');
  });

  it('handleCancelTaskEdit clears silently without a draft and announces a cancelled edit otherwise', () => {
    const { state, build } = createTasksHarness({ taskActionLabel: '旧状态' });

    build().handleCancelTaskEdit();
    expect(state.taskActionLabel).toBe('旧状态');

    state.editingTaskId = 't1';
    state.editingTaskDraft = buildTaskEditDraft(TASK);
    build().handleCancelTaskEdit();
    expect(state.editingTaskId).toBeNull();
    expect(state.editingTaskDraft).toBeNull();
    expect(state.taskActionLabel).toBe('已取消编辑');
  });
});

describe('workbenchTasksRouteHandlers — selection plans and chrome', () => {
  it('assign/group/filter handlers guard an empty selection', () => {
    const { state, build } = createTasksHarness({ selectedTaskId: null });
    const handlers = build();

    handlers.handleAssignSelectedTaskToMe();
    expect(state.taskActionLabel).toBe('请先选择任务');

    handlers.handleGroupBySelectedTaskProject();
    expect(state.taskActionLabel).toBe('请先选择任务');
    expect(state.taskGroupMode).toBe('custom');

    handlers.handleFilterBySelectedTaskAssignee();
    expect(state.taskActionLabel).toBe('请先选择任务');
    expect(state.taskFilterActive).toBe(false);
  });

  it('cycle/delete handlers guard an empty selection without touching groups', () => {
    const { state, build } = createTasksHarness({ selectedTaskId: null });
    const handlers = build();
    const groupsBefore = state.taskGroups;

    handlers.handleCycleSelectedTaskStatus();
    expect(state.taskActionLabel).toBe('请先选择任务');

    handlers.handleDeleteSelectedTask();
    expect(state.taskActionLabel).toBe('请先选择任务');
    expect(state.taskGroups).toEqual(groupsBefore);
  });

  it('handleAssignSelectedTaskToMe patches the assignee to the acting user', () => {
    const { state, build } = createTasksHarness(
      { selectedTaskId: 't1' },
      { currentUserId: 'ding', userDisplayName: 'Ding' },
    );

    build().handleAssignSelectedTaskToMe();

    expect(state.taskGroups[0]?.tasks.find((task) => task.id === 't1')?.assignee).toBe('Ding');
    expect(state.taskActionLabel).toContain('已指派给 Ding');
  });

  it('handleGroupBySelectedTaskProject switches to the project-grouped list view', () => {
    const { state, build } = createTasksHarness({ selectedTaskId: 't1', taskViewMode: 'board' });

    build().handleGroupBySelectedTaskProject();

    expect(state.taskGroupMode).toBe('project');
    expect(state.taskViewMode).toBe('list');
    expect(state.taskActionLabel).toBe(`已按项目查看：${TASK.project}`);
  });

  it('handleFilterBySelectedTaskAssignee picks the owned pane for self and all otherwise', () => {
    const mine = createTasksHarness(
      { selectedTaskId: 't1', taskFilterActive: true },
      { currentUserId: 'Builder' },
    );
    mine.build().handleFilterBySelectedTaskAssignee();
    expect(mine.state.tasksPane).toBe('owned');
    expect(mine.state.taskFilterActive).toBe(false);
    expect(mine.state.taskActionLabel).toBe(`当前负责人：${TASK.assignee}`);

    const others = createTasksHarness(
      { selectedTaskId: 't1', taskFilterActive: true },
      { currentUserId: 'someone-else' },
    );
    others.build().handleFilterBySelectedTaskAssignee();
    expect(others.state.tasksPane).toBe('all');
  });

  it('handleTaskClick selects the task and clears a draft only when switching targets', () => {
    const { state, build } = createTasksHarness({
      editingTaskId: 't1',
      editingTaskDraft: buildTaskEditDraft(TASK),
    });
    const handlers = build();

    // Clicking the task under edit keeps the draft.
    handlers.handleTaskClick(TASK);
    expect(state.selectedTaskId).toBe('t1');
    expect(state.editingTaskId).toBe('t1');
    expect(state.editingTaskDraft).not.toBeNull();
    expect(state.taskActionLabel).toContain('已选中');

    // Clicking another task clears the in-flight edit.
    handlers.handleTaskClick({ ...TASK, id: 't2' });
    expect(state.selectedTaskId).toBe('t2');
    expect(state.editingTaskId).toBeNull();
    expect(state.editingTaskDraft).toBeNull();
  });

  it('handleNavMore toggles the overflow menu and labels it', () => {
    const { state, build } = createTasksHarness();
    const handlers = build();

    handlers.handleNavMore();
    expect(state.taskNavMenuOpen).toBe(true);
    expect(state.taskActionLabel).toBe('任务更多操作');

    handlers.handleNavMore();
    expect(state.taskNavMenuOpen).toBe(false);
  });
});
