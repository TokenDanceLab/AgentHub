import { describe, expect, it } from 'vitest';
import type { TaskItem } from './pages';
import {
  buildTaskFieldConfigLabel,
  buildTaskGroupLabel,
  buildTaskSortLabel,
  buildTasksPageDerivedModel,
  countCrossProjectTasks,
  countDueTodayTasks,
  countIncompleteTasks,
} from './workbenchTasksPageModel';

const TASKS: TaskItem[] = [
  {
    id: 't1',
    title: 'A',
    project: 'P1',
    assignee: 'u1',
    startTime: '今天',
    dueDate: '今天 18:00',
    creator: 'u1',
    status: '进行中',
  },
  {
    id: 't2',
    title: 'B',
    project: 'P2',
    assignee: 'u2',
    startTime: '昨天',
    dueDate: '明天 10:00',
    creator: 'u2',
    status: '已完成',
  },
  {
    id: 't3',
    title: 'C',
    project: 'P1',
    assignee: 'u1',
    startTime: '上周',
    dueDate: '今天 12:00',
    creator: 'u1',
    status: '未开始',
  },
];

describe('workbenchTasksPageModel', () => {
  it('builds toolbar labels from view/group/sort modes', () => {
    expect(buildTaskGroupLabel('board', 'custom')).toBe('分组：状态看板');
    expect(buildTaskGroupLabel('dashboard', 'custom')).toBe('分组：项目仪表盘');
    expect(buildTaskGroupLabel('list', 'project')).toBe('分组：所属项目');
    expect(buildTaskGroupLabel('list', 'status')).toBe('分组：任务状态');
    expect(buildTaskGroupLabel('list', 'custom')).toBe('分组：自定义分组');
    expect(buildTaskSortLabel('custom')).toBe('排序：拖拽自定义');
    expect(buildTaskSortLabel('due')).toBe('排序：截止时间');
    expect(buildTaskFieldConfigLabel(true)).toBe('字段配置');
    expect(buildTaskFieldConfigLabel(false)).toBe('字段配置 5/6');
  });

  it('counts task stats', () => {
    expect(countDueTodayTasks(TASKS)).toBe(2);
    expect(countIncompleteTasks(TASKS)).toBe(2);
    expect(countCrossProjectTasks(TASKS)).toBe(2);
  });

  it('assembles derived TasksPage model', () => {
    const model = buildTasksPageDerivedModel({
      realDataMode: true,
      taskFilterActive: true,
      taskGroupMode: 'project',
      taskShowCreator: false,
      taskSortMode: 'due',
      taskViewMode: 'list',
      visibleTasks: TASKS,
    });

    expect(model).toEqual({
      activeFilterCount: 1,
      crossProjectCount: 2,
      dueTodayCount: 2,
      // Real mode with visible tasks (parent-provided) is not "coming soon".
      tasksComingSoon: false,
      fieldConfigActive: true,
      fieldConfigLabel: '字段配置 5/6',
      groupActive: true,
      groupLabel: '分组：所属项目',
      incompleteCount: 2,
      sortActive: true,
      sortLabel: '排序：截止时间',
    });

    // Real mode without any tasks renders the honest coming-soon empty
    // state (#1818).
    const realEmpty = buildTasksPageDerivedModel({
      realDataMode: true,
      taskFilterActive: false,
      taskGroupMode: 'custom',
      taskShowCreator: true,
      taskSortMode: 'custom',
      taskViewMode: 'list',
      visibleTasks: [],
    });
    expect(realEmpty.tasksComingSoon).toBe(true);

    const demo = buildTasksPageDerivedModel({
      realDataMode: false,
      taskFilterActive: false,
      taskGroupMode: 'custom',
      taskShowCreator: true,
      taskSortMode: 'custom',
      taskViewMode: 'list',
      visibleTasks: [],
    });
    expect(demo.tasksComingSoon).toBe(false);
    expect(demo.activeFilterCount).toBe(0);
    expect(demo.groupActive).toBe(false);
    expect(demo.sortActive).toBe(false);
  });
});
