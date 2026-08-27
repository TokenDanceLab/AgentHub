import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '../../__tests__/setup';
import { useTestI18nLanguage } from '@shared/testing/i18n';
import { TaskMain } from './TaskMainViews';
import type { TasksPageProps, TaskGroup, TaskItem } from './types';
import type { TaskReviewMergePort } from '../../workbenchBoardColumns';

/* ═══════════════════════════════════════════════════════════════════════
   review-before-merge behavior (#1999, UX F13):
   - awaiting-review task cards carry an explicit review marker;
   - approve/merge controls render only with a real capability port on a
     desktop surface (fail-closed zero controls otherwise);
   - Hub-only surfaces state that merging needs Desktop / Local Edge and
     never expose merge controls or a merged state.
   ═══════════════════════════════════════════════════════════════════════ */

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});

function makeTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: 'task-review',
    title: '待评审任务',
    project: '前端重构任务',
    assignee: 'Builder',
    startTime: '今天 14:49',
    dueDate: '明天 18:00',
    creator: 'demo-user',
    status: '待评审',
    ...overrides,
  };
}

const REVIEW_TASK = makeTask();
const RUNNING_TASK = makeTask({ id: 'task-running', title: '进行中任务', status: '进行中' });

const BOARD_GROUPS: TaskGroup[] = [
  { label: '进行中', tasks: [RUNNING_TASK], columnId: 'running', tone: 'running' },
  { label: '待评审', tasks: [REVIEW_TASK], columnId: 'review', tone: 'review' },
];

const noop = (): void => {};

function baseProps(overrides: Partial<TasksPageProps> = {}): Partial<TasksPageProps> {
  return {
    activePane: 'owned',
    viewMode: 'board',
    onViewModeChange: noop,
    groups: BOARD_GROUPS,
    comingSoonEmptyState: false,
    demoDataActive: true,
    profiles: [],
    selectedTask: null,
    taskActionLabel: '',
    editingTaskId: null,
    editingDraft: null,
    incompleteCount: 2,
    dueTodayCount: 0,
    crossProjectCount: 1,
    activeFilterCount: 0,
    sortLabel: '排序：拖拽自定义',
    groupLabel: '分组：状态看板',
    fieldConfigLabel: '字段配置',
    sortActive: false,
    groupActive: true,
    fieldConfigActive: false,
    showCreatorColumn: true,
    selectedTaskId: null,
    hasMore: false,
    loadingMore: false,
    ...overrides,
  };
}

function makePort(): TaskReviewMergePort {
  return { approveReview: vi.fn(), mergeTask: vi.fn() };
}

describe('awaiting-review marker (#1999)', () => {
  it('marks awaiting-review task cards explicitly and only those', () => {
    const { container } = render(<TaskMain {...baseProps()} />);

    const markers = screen.getAllByTestId('task-review-marker');
    expect(markers).toHaveLength(1);
    expect(markers[0]).toHaveTextContent('等待评审');

    const reviewRow = container.querySelector('[data-task-id="task-review"]');
    const runningRow = container.querySelector('[data-task-id="task-running"]');
    expect(reviewRow).not.toBeNull();
    expect(runningRow).not.toBeNull();
    expect(within(reviewRow as HTMLElement).getByTestId('task-review-marker')).toBeInTheDocument();
    expect(within(runningRow as HTMLElement).queryByTestId('task-review-marker')).toBeNull();
  });

  it('tags board group titles with the SSOT column id and tone', () => {
    const { container } = render(<TaskMain {...baseProps()} />);
    const reviewTitle = container.querySelector('[data-board-column-id="review"]');
    expect(reviewTitle).not.toBeNull();
    expect(reviewTitle).toHaveAttribute('data-board-tone', 'review');
    // Non-status groups (e.g. custom/project) carry no column chrome.
    expect(container.querySelector('[data-board-column-id="custom"]')).toBeNull();
  });
});

describe('capability-port gated controls (#1999)', () => {
  it('renders zero approve/merge controls without a capability port (fail-closed)', () => {
    render(
      <TaskMain
        {...baseProps({ selectedTask: REVIEW_TASK, selectedTaskId: REVIEW_TASK.id, platformSurface: 'desktop' })}
      />,
    );
    expect(screen.queryByTestId('task-review-merge-controls')).toBeNull();
    expect(screen.queryByRole('button', { name: '批准评审' })).toBeNull();
    expect(screen.queryByRole('button', { name: '合并' })).toBeNull();
  });

  it('renders controls and invokes the port when a desktop capability port exists', () => {
    const port = makePort();
    render(
      <TaskMain
        {...baseProps({
          selectedTask: REVIEW_TASK,
          selectedTaskId: REVIEW_TASK.id,
          platformSurface: 'desktop',
          reviewMergePort: port,
        })}
      />,
    );

    expect(screen.getByTestId('task-review-merge-controls')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '批准评审' }));
    fireEvent.click(screen.getByRole('button', { name: '合并' }));
    expect(port.approveReview).toHaveBeenCalledWith('task-review');
    expect(port.mergeTask).toHaveBeenCalledWith('task-review');
  });

  it('keeps zero controls for non-awaiting-review selections even with a port', () => {
    render(
      <TaskMain
        {...baseProps({
          selectedTask: RUNNING_TASK,
          selectedTaskId: RUNNING_TASK.id,
          platformSurface: 'desktop',
          reviewMergePort: makePort(),
        })}
      />,
    );
    expect(screen.queryByTestId('task-review-merge-controls')).toBeNull();
  });
});

describe('Hub-only surface honesty (#1999)', () => {
  it('shows the Desktop/Local Edge notice and zero controls on web even with a port', () => {
    render(
      <TaskMain
        {...baseProps({
          selectedTask: REVIEW_TASK,
          selectedTaskId: REVIEW_TASK.id,
          platformSurface: 'web',
          reviewMergePort: makePort(),
        })}
      />,
    );

    const notice = screen.getByTestId('tasks-hub-only-merge-notice');
    expect(notice).toHaveTextContent('合并需要 Desktop / Local Edge');
    // Never a merged or fake-merged state: no merge controls at all on web.
    expect(screen.queryByTestId('task-review-merge-controls')).toBeNull();
    expect(screen.queryByRole('button', { name: '批准评审' })).toBeNull();
    expect(screen.queryByRole('button', { name: '合并' })).toBeNull();
    expect(screen.queryByText('已合并')).toBeNull();
  });

  it('stays silent without awaiting-review tasks and on desktop', () => {
    const runningOnly: TaskGroup[] = [
      { label: '进行中', tasks: [RUNNING_TASK], columnId: 'running', tone: 'running' },
    ];
    const web = render(
      <TaskMain {...baseProps({ groups: runningOnly, platformSurface: 'web' })} />,
    );
    expect(web.queryByTestId('tasks-hub-only-merge-notice')).toBeNull();
    web.unmount();

    const desktop = render(
      <TaskMain {...baseProps({ platformSurface: 'desktop' })} />,
    );
    expect(desktop.queryByTestId('tasks-hub-only-merge-notice')).toBeNull();
  });
});
