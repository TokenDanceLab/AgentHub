import { describe, expect, it } from 'vitest';
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

    expect(planTaskSortToggle('custom')).toEqual({
      next: 'due',
      taskActionLabel: '已按截止时间排序',
    });
    expect(buildTaskSortActionLabel('custom')).toBe('已恢复拖拽自定义排序');

    expect(planNewTaskGroup(2)).toEqual({
      nextIndex: 3,
      taskGroupMode: 'custom',
      taskViewMode: 'list',
      taskActionLabel: '已创建自定义分组 3',
    });
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
  });

  it('plans click and toolbar toggles', () => {
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
  });
});
