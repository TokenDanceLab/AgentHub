import { describe, expect, it } from 'vitest';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import { createTestI18n } from '@shared/testing/i18n';
import type { TaskGroup, TaskItem } from './pages';
import {
  appendCustomTaskGroup,
  buildTaskEditDraft,
  nextTaskGroupMode,
  nextTaskSortMode,
  nextTaskStatus,
  patchTaskEditDraft,
  patchTaskInGroups,
  prepareTaskEditSave,
  prependTaskToGroups,
  removeTaskFromGroups,
  resolveFilterPaneForAssignee,
  resolveSourceTaskGroups,
  resolveTaskAssignee,
  resolveTaskAssigneeLabel,
} from './workbenchTasksRouteGroupHelpers';

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

/** Real zh bundle keeps historical copy expectations honest (#2023). */
const tZh = createTestI18n({ lng: 'zh' }).getFixedT('zh', SHARED_WORKBENCH_I18N_NAMESPACE);

describe('workbenchTasksRouteGroupHelpers', () => {
  it('resolves source task groups for mock and real modes', () => {
    const mock = [{ label: 'mock', tasks: [TASK] }];
    expect(resolveSourceTaskGroups(true, [])).toEqual([]);
    expect(resolveSourceTaskGroups(true, GROUPS)).toEqual(GROUPS);
    expect(resolveSourceTaskGroups(false, [], mock)).toEqual(mock);
    expect(resolveSourceTaskGroups(false, GROUPS, mock)).toEqual(GROUPS);
  });

  it('builds edit drafts and patches draft fields', () => {
    expect(buildTaskEditDraft(TASK)).toEqual({
      title: TASK.title,
      project: TASK.project,
      assignee: TASK.assignee,
      startTime: TASK.startTime,
      dueDate: TASK.dueDate,
      creator: TASK.creator,
    });
    expect(patchTaskEditDraft(null, 'title', 'x')).toBeNull();
    expect(patchTaskEditDraft(buildTaskEditDraft(TASK), 'assignee', 'Me')?.assignee).toBe('Me');
    expect(prepareTaskEditSave(tZh, {
      title: '   ',
      project: 'P',
      assignee: 'A',
      startTime: 's',
      dueDate: 'd',
      creator: 'c',
    }).title).toBe('未命名任务');
  });

  it('toggles sort/group modes and advances status', () => {
    expect(nextTaskSortMode('custom')).toBe('due');
    expect(nextTaskSortMode('due')).toBe('custom');
    expect(nextTaskGroupMode('custom')).toBe('project');
    expect(nextTaskGroupMode('project')).toBe('status');
    expect(nextTaskGroupMode('status')).toBe('custom');
    expect(nextTaskStatus('未开始')).toBe('进行中');
    expect(nextTaskStatus('进行中')).toBe('待评审');
    expect(nextTaskStatus('已完成')).toBe('未开始');
    expect(nextTaskStatus(undefined)).toBe('进行中');
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

  it('resolves assignee labels and filter panes', () => {
    expect(resolveTaskAssignee('Alice', 'u1')).toBe('Alice');
    expect(resolveTaskAssignee(undefined, 'u1')).toBe('u1');
    expect(resolveTaskAssignee(undefined, undefined)).toBe('当前用户');
    expect(resolveTaskAssigneeLabel(tZh, 'Alice')).toBe('Alice');
    expect(resolveTaskAssigneeLabel(tZh, undefined)).toBe('当前用户');
    expect(resolveFilterPaneForAssignee('Builder', 'Builder')).toBe('owned');
    expect(resolveFilterPaneForAssignee('u2', 'u1')).toBe('all');
  });
});
