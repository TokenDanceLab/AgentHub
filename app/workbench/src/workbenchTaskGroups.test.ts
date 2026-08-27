import { describe, expect, it } from 'vitest';
import type { TaskGroup, TaskItem } from './pages';
import { boardColumnDisplayLabels } from './workbenchBoardColumns';
import {
  DESIGN_DONE_TASK,
  buildTaskGroups,
  flattenTaskGroups,
  groupTasks,
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

  it('derives status-group order and column chrome from the board-column SSOT (#1999)', () => {
    const groups = groupTasks(TASKS, 'status');
    // Group labels follow the SSOT display order (derived, not hardcoded).
    const expected = boardColumnDisplayLabels().filter((label) =>
      groups.some((group) => group.label === label),
    );
    expect(groups.map((group) => group.label)).toEqual(expected);
    // Status groups carry their SSOT column id/tone; empty columns drop out.
    for (const group of groups) {
      expect(group.columnId).toBeTruthy();
      expect(group.tone).toBeTruthy();
    }
    expect(groups.find((group) => group.label === '待确认')).toBeUndefined();
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
