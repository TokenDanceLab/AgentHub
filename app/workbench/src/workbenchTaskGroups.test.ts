import { describe, expect, it } from 'vitest';
import type { TaskGroup, TaskItem } from './pages';
import {
  DESIGN_DONE_TASK,
  buildTaskGroups,
  flattenTaskGroups,
  sortTasks,
  taskMatchesPane,
} from './workbenchTaskGroups';

const TASKS: TaskItem[] = [
  {
    id: 'embedded-docs',
    title: '嵌入文档',
    project: 'AgentHub 设计评审',
    assignee: 'Alice',
    startTime: '昨天',
    dueDate: '今天 18:00',
    creator: 'user-1',
    status: '进行中',
  },
  {
    id: 'sqlite-plan',
    title: 'SQLite 方案',
    project: '后端',
    assignee: 'Bob',
    startTime: '刚刚',
    dueDate: '明天 10:00',
    creator: 'user-2',
    status: '已完成',
  },
  {
    id: 'other',
    title: '其他任务',
    project: '前端',
    assignee: 'user-1',
    startTime: '上周',
    dueDate: '6月3日',
    creator: 'user-1',
    status: '未开始',
  },
];

const SOURCE: TaskGroup[] = [{ label: '默认分组', tasks: TASKS }];

describe('workbenchTaskGroups', () => {
  it('filters tasks by pane rules', () => {
    expect(taskMatchesPane(TASKS[0]!, 'watching')).toBe(true);
    expect(taskMatchesPane(TASKS[1]!, 'activity')).toBe(true);
    expect(taskMatchesPane(TASKS[2]!, 'created', 'user-1')).toBe(true);
    expect(taskMatchesPane(TASKS[2]!, 'assigned', 'user-1')).toBe(false);
    expect(taskMatchesPane(TASKS[1]!, 'done')).toBe(true);
  });

  it('sorts by due date when requested', () => {
    const sorted = sortTasks(TASKS, 'due');
    expect(sorted.map((task) => task.id)).toEqual(['embedded-docs', 'sqlite-plan', 'other']);
  });

  it('builds visible groups and falls back to design done task', () => {
    const filtered = buildTaskGroups(SOURCE, 'watching', true, 'custom', 'custom', 'list');
    expect(flattenTaskGroups(filtered).map((task) => task.id)).toEqual(['embedded-docs']);

    const doneFallback = buildTaskGroups(
      [{ label: '默认分组', tasks: TASKS.filter((task) => task.status !== '已完成') }],
      'done',
      true,
      'custom',
      'custom',
      'list',
    );
    expect(flattenTaskGroups(doneFallback)).toEqual([DESIGN_DONE_TASK]);
  });
});
