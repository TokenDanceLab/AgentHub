import { describe, expect, it, vi } from 'vitest';
import {
  TASK_EDIT_FIELD_CONFIGS,
  countTasksInGroups,
  joinClassNames,
  taskAddRowClassName,
  taskDisplayRowClassName,
  taskEditRowClassName,
  taskEmptyStateActionProps,
  taskEmptyStateClassProps,
  taskEmptyStateDescriptionProps,
  taskGroupTitleClassName,
  taskSelectionAriaLabel,
  taskSelectionMetaLine,
  taskStatusIconClassName,
  taskStatusIconModifier,
  taskTableClassName,
} from './TaskTableHelpers';
import type { TaskGroup } from './types';

describe('TaskTableHelpers', () => {
  it('joins class names without empty/false parts', () => {
    expect(joinClassNames('a', undefined, null, false, 'b', '')).toBe('a b');
    expect(joinClassNames()).toBe('');
  });

  it('maps task status icon modifiers', () => {
    const css = {
      nameIcon: 'icon',
      nameIconDone: 'done',
      nameIconRunning: 'running',
    };

    expect(taskStatusIconModifier('已完成', css)).toBe('done');
    expect(taskStatusIconModifier('进行中', css)).toBe('running');
    expect(taskStatusIconModifier('未开始', css)).toBe('');
    expect(taskStatusIconModifier('待评审', css)).toBe('');
    expect(taskStatusIconModifier('待确认', css)).toBe('');

    expect(taskStatusIconClassName('已完成', css)).toBe('icon done');
    expect(taskStatusIconClassName('进行中', css)).toBe('icon running');
    expect(taskStatusIconClassName('未开始', css)).toBe('icon');
  });

  it('builds table / row / group / add-row class names', () => {
    const css = {
      table: 'table',
      tableFiveColumns: 'five',
      row: 'row',
      rowSelected: 'selected',
      editRow: 'edit',
      groupTitle: 'group',
      addRow: 'add',
    };

    expect(taskTableClassName(true, css)).toBe('table task-table');
    expect(taskTableClassName(false, css)).toBe('table five task-table');

    expect(taskDisplayRowClassName(false, css)).toBe('row task-row');
    expect(taskDisplayRowClassName(true, css)).toBe('row selected task-row');
    expect(taskEditRowClassName(css)).toBe('row selected edit task-row');

    expect(taskGroupTitleClassName(css)).toBe('group task-group-title');
    expect(taskAddRowClassName(css)).toBe('add task-add-row');
  });

  it('builds selection strip aria label and meta line', () => {
    expect(taskSelectionAriaLabel('示例任务')).toBe('示例任务 任务详情');
    expect(
      taskSelectionMetaLine({
        project: 'AgentHub',
        assignee: 'Builder',
        dueDate: '明天 18:00',
      }),
    ).toBe('AgentHub · Builder · 截止 明天 18:00');
  });

  it('counts tasks across groups', () => {
    const groups: TaskGroup[] = [
      {
        label: 'A',
        tasks: [
          {
            id: '1',
            title: 't1',
            project: 'p',
            assignee: 'a',
            startTime: 's',
            dueDate: 'd',
            creator: 'c',
            status: '进行中',
          },
        ],
      },
      {
        label: 'B',
        tasks: [
          {
            id: '2',
            title: 't2',
            project: 'p',
            assignee: 'a',
            startTime: 's',
            dueDate: 'd',
            creator: 'c',
            status: '未开始',
          },
          {
            id: '3',
            title: 't3',
            project: 'p',
            assignee: 'a',
            startTime: 's',
            dueDate: 'd',
            creator: 'c',
            status: '已完成',
          },
        ],
      },
    ];

    expect(countTasksInGroups(groups)).toBe(3);
    expect(countTasksInGroups([])).toBe(0);
  });

  it('lists five stable edit field configs', () => {
    expect(TASK_EDIT_FIELD_CONFIGS).toHaveLength(5);
    expect(TASK_EDIT_FIELD_CONFIGS.map((f) => f.key)).toEqual([
      'title',
      'project',
      'assignee',
      'startTime',
      'dueDate',
    ]);
    expect(TASK_EDIT_FIELD_CONFIGS.map((f) => f.ariaLabel)).toEqual([
      '编辑任务标题',
      '编辑所属项目',
      '编辑负责人',
      '编辑开始时间',
      '编辑截止时间',
    ]);
  });

  it('builds exactOptionalPropertyTypes-safe empty-state class props', () => {
    const withClasses = taskEmptyStateClassProps({
      'tasks-empty-compact': 'c1',
      'tasks-empty-compact-content': 'c2',
      'tasks-empty-compact-title': 'c3',
      'tasks-empty-compact-description': 'c4',
      'tasks-empty-compact-action': 'c5',
    });
    expect(withClasses).toEqual({
      className: 'c1',
      contentClassName: 'c2',
      titleClassName: 'c3',
      descriptionClassName: 'c4',
      actionClassName: 'c5',
    });

    const withoutClasses = taskEmptyStateClassProps({});
    expect(withoutClasses).toEqual({});
    expect(Object.prototype.hasOwnProperty.call(withoutClasses, 'className')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(withoutClasses, 'contentClassName')).toBe(false);
  });

  it('builds exactOptionalPropertyTypes-safe empty-state description props', () => {
    expect(taskEmptyStateDescriptionProps(undefined)).toEqual({});
    expect(taskEmptyStateDescriptionProps('')).toEqual({});
    expect(Object.prototype.hasOwnProperty.call(taskEmptyStateDescriptionProps(), 'description')).toBe(
      false,
    );

    const withLabel = taskEmptyStateDescriptionProps('Hub tasks missing');
    expect(withLabel).toEqual({ description: 'Hub tasks missing' });
    expect(Object.prototype.hasOwnProperty.call(withLabel, 'description')).toBe(true);
  });

  it('builds exactOptionalPropertyTypes-safe empty-state action props', () => {
    expect(taskEmptyStateActionProps('新建任务')).toEqual({});
    expect(taskEmptyStateActionProps('新建任务', undefined)).toEqual({});
    expect(
      Object.prototype.hasOwnProperty.call(taskEmptyStateActionProps('新建任务'), 'action'),
    ).toBe(false);

    const onAddRow = vi.fn();
    const withAction = taskEmptyStateActionProps('新建任务', onAddRow);
    expect(Object.keys(withAction)).toEqual(['action']);
    expect(withAction.action?.label).toBe('新建任务');
    withAction.action?.onClick();
    expect(onAddRow).toHaveBeenCalledTimes(1);
  });
});
