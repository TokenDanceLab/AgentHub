import { describe, expect, it } from 'vitest';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import { createTestI18n } from '@shared/testing/i18n';
import type { TaskItem } from './pages';
import { buildTaskEditDraft } from './workbenchTasksRouteGroupHelpers';
import {
  buildTaskPaneChangeLabel,
  buildTaskSortActionLabel,
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
} from './workbenchTasksRoutePlanners';

// Real sharedWorkbench bundles (no mocks): zh keeps the historical copy
// assertions honest; the en instance proves zh/en key alignment (#2023).
const tZh = createTestI18n({ lng: 'zh' }).getFixedT('zh', SHARED_WORKBENCH_I18N_NAMESPACE);
const tEn = createTestI18n({ lng: 'en' }).getFixedT('en', SHARED_WORKBENCH_I18N_NAMESPACE);

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

describe('workbenchTasksRoutePlanners', () => {
  it('builds create/start edit plans', () => {
    const created = planCreateTask(tZh, 3);
    expect(created.nextTask.id).toBe('local-task-3');
    expect(created.selectedTaskId).toBe(created.nextTask.id);
    expect(created.editingTaskDraft.title).toBe(created.nextTask.title);
    expect(created.tasksPane).toBe('owned');
    expect(created.taskViewMode).toBe('list');
    expect(created.taskActionLabel).toContain(created.nextTask.title);

    const started = planEditSelectedTask(tZh, TASK);
    expect(started).toMatchObject({
      selectedTaskId: 't1',
      editingTaskId: 't1',
      taskViewMode: 'list',
      taskActionLabel: `正在编辑 ${TASK.title}`,
    });
    expect(planEditSelectedTask(tZh, null)).toEqual({
      kind: 'feedback',
      taskActionLabel: '请先选择任务',
    });
  });

  it('plans pane/list/sort/group transitions and labels', () => {
    expect(planTaskPaneChange(tZh, 'owned')).toEqual({
      tasksPane: 'owned',
      selectedTaskId: null,
      editingTaskId: null,
      editingTaskDraft: null,
      taskNavMenuOpen: false,
      taskActionLabel: '已切换到我负责的',
    });
    expect(buildTaskPaneChangeLabel(tZh, 'watching')).toBe('已切换到我关注的');
    expect(buildTaskPaneChangeLabel(tZh, 'activity')).toBe('已切换到动态');
    expect(buildTaskPaneChangeLabel(tZh, 'done')).toBe('已切换到已完成');
    expect(buildTaskPaneChangeLabel(tZh, 'all')).toBe('已切换到任务视图');

    expect(planTaskListReset(tZh, )).toEqual({
      taskViewMode: 'list',
      taskGroupMode: 'custom',
      taskNavMenuOpen: false,
      taskActionLabel: '已回到任务清单',
    });

    expect(planTaskSortToggle(tZh, 'custom')).toEqual({
      next: 'due',
      taskActionLabel: '已按截止时间排序',
    });
    expect(buildTaskSortActionLabel(tZh, 'custom')).toBe('已恢复拖拽自定义排序');

    expect(planNewTaskGroup(tZh, 2)).toEqual({
      nextIndex: 3,
      taskGroupMode: 'custom',
      taskViewMode: 'list',
      taskActionLabel: '已创建自定义分组 3',
    });
  });

  it('plans save/cancel/delete/cycle/assign/group/filter actions', () => {
    const saved = planSaveTaskEdit(tZh, 't1', {
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
    expect(planSaveTaskEdit(tZh, null, null)).toEqual({
      kind: 'feedback',
      taskActionLabel: '没有正在编辑的任务',
    });

    expect(planCancelTaskEdit(tZh, buildTaskEditDraft(TASK))).toEqual({
      kind: 'feedback',
      taskActionLabel: '已取消编辑',
    });
    expect(planCancelTaskEdit(tZh, null)).toBeNull();

    expect(planDeleteSelectedTask(tZh, null)).toEqual({
      kind: 'feedback',
      taskActionLabel: '请先选择任务',
    });
    expect(planDeleteSelectedTask(tZh, TASK)).toEqual({
      kind: 'delete',
      taskId: 't1',
      selectedTaskId: null,
      editingTaskId: null,
      editingTaskDraft: null,
      taskActionLabel: `${TASK.title} 已删除`,
    });

    expect(planCycleSelectedTaskStatus(tZh, TASK)).toEqual({
      kind: 'cycle',
      taskId: 't1',
      status: '待评审',
      taskActionLabel: `${TASK.title} 已推进到 待评审`,
    });

    expect(planAssignSelectedTaskToMe(tZh, TASK, 'Alice', 'u1')).toEqual({
      kind: 'assign',
      taskId: 't1',
      assignee: 'Alice',
      taskActionLabel: `${TASK.title} 已指派给 Alice`,
    });
    expect(planAssignSelectedTaskToMe(tZh, TASK, undefined, 'u1')).toEqual({
      kind: 'assign',
      taskId: 't1',
      assignee: 'u1',
      taskActionLabel: `${TASK.title} 已指派给 当前用户`,
    });

    expect(planGroupBySelectedTaskProject(tZh, TASK)).toEqual({
      kind: 'group-project',
      taskGroupMode: 'project',
      taskViewMode: 'list',
      taskActionLabel: '已按项目查看：AgentHub',
    });

    expect(planFilterBySelectedTaskAssignee(tZh, TASK, 'Builder')).toEqual({
      kind: 'filter-assignee',
      tasksPane: 'owned',
      taskFilterActive: false,
      taskActionLabel: '当前负责人：Builder',
    });
  });

  it('plans click and toolbar toggles', () => {
    expect(planTaskClick(tZh, TASK, 'other')).toEqual({
      selectedTaskId: 't1',
      clearEdit: true,
      taskActionLabel: `已选中 ${TASK.title}`,
    });
    expect(planTaskClick(tZh, TASK, 't1').clearEdit).toBe(false);
    expect(planTaskClick(tZh, TASK, null).clearEdit).toBe(false);

    expect(planToolbarFieldConfig(tZh, true)).toEqual({
      next: false,
      taskActionLabel: '已隐藏创建人字段',
    });
    expect(planToolbarFieldConfig(tZh, false)).toEqual({
      next: true,
      taskActionLabel: '已显示创建人字段',
    });
    expect(planToolbarFilter(tZh, true)).toEqual({
      next: false,
      taskActionLabel: '已关闭筛选',
    });
    expect(planToolbarFilter(tZh, false)).toEqual({
      next: true,
      taskActionLabel: '筛选已启用',
    });
  });
});

describe('tasks route action labels en convergence (#2023)', () => {
  it('renders natural English feedback copy through the same keys', () => {
    expect(buildTaskPaneChangeLabel(tEn, 'owned')).toBe('Switched to Owned by me');
    expect(buildTaskSortActionLabel(tEn, 'due')).toBe('Sorted by due date');
    expect(planTaskListReset(tEn).taskActionLabel).toBe('Back to task list');
    expect(planNewTaskGroup(tEn, 2).taskActionLabel).toBe('Created custom group 3');
    expect(planCreateTask(tEn, 7).taskActionLabel).toContain('Created ');
    expect(planEditSelectedTask(tEn, null)).toEqual({
      kind: 'feedback',
      taskActionLabel: 'Select a task first',
    });
    expect(planSaveTaskEdit(tEn, null, null)).toEqual({
      kind: 'feedback',
      taskActionLabel: 'No task is being edited',
    });
    expect(planCancelTaskEdit(tEn, buildTaskEditDraft(TASK))).toEqual({
      kind: 'feedback',
      taskActionLabel: 'Edit cancelled',
    });
    expect(planDeleteSelectedTask(tEn, TASK).taskActionLabel).toBe(`${TASK.title} deleted`);
    expect(planCycleSelectedTaskStatus(tEn, TASK).taskActionLabel)
      .toBe(`${TASK.title} advanced to 待评审`);
    expect(planAssignSelectedTaskToMe(tEn, TASK, 'Alice', 'u1').taskActionLabel)
      .toBe(`${TASK.title} assigned to Alice`);
    expect(planAssignSelectedTaskToMe(tEn, TASK, undefined, 'u1').taskActionLabel)
      .toBe(`${TASK.title} assigned to Current user`);
    expect(planGroupBySelectedTaskProject(tEn, TASK).taskActionLabel)
      .toBe('Grouped by project: AgentHub');
    expect(planFilterBySelectedTaskAssignee(tEn, TASK, 'Builder').taskActionLabel)
      .toBe('Current assignee: Builder');
    expect(planTaskClick(tEn, TASK, null).taskActionLabel).toBe(`Selected ${TASK.title}`);
    expect(planToolbarFieldConfig(tEn, true).taskActionLabel).toBe('Creator field hidden');
    expect(planToolbarFilter(tEn, false).taskActionLabel).toBe('Filter enabled');
  });
});
