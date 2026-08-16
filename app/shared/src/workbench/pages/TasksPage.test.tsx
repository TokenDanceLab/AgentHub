import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '../../__tests__/setup';
import { TasksPage } from './TasksPage';

// Tasks copy resolves via the sharedWorkbench namespace; opt into the zh
// bundle of the shared test i18next instance (Issue #1717).
import { useTestI18nLanguage } from '../../testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});

const BASE_PROPS = {
  activePane: 'owned' as const,
  onPaneChange: () => undefined,
  viewMode: 'list' as const,
  onViewModeChange: () => undefined,
  groups: [],
  incompleteCount: 0,
  dueTodayCount: 0,
  crossProjectCount: 0,
};

describe('TasksPage empty state', () => {
  it('uses shared EmptyState for the primary empty path and maps emptyStateLabel to description', () => {
    const onAddTaskRow = vi.fn();

    render(
      <TasksPage
        {...BASE_PROPS}
        emptyStateLabel="Hub tasks are not loaded in this replay."
        onAddTaskRow={onAddTaskRow}
      />,
    );

    const emptyState = screen.getByRole('region', { name: '暂无任务' });
    expect(
      within(emptyState).getByText('Hub tasks are not loaded in this replay.'),
    ).toBeInTheDocument();

    fireEvent.click(within(emptyState).getByRole('button', { name: '新建任务' }));
    expect(onAddTaskRow).toHaveBeenCalledTimes(1);
  });

  it('still shows the default EmptyState title when emptyStateLabel is omitted', () => {
    render(<TasksPage {...BASE_PROPS} />);

    const emptyState = screen.getByRole('region', { name: '暂无任务' });
    expect(emptyState).toBeInTheDocument();
    expect(
      within(emptyState).queryByText('Hub tasks are not loaded in this replay.'),
    ).not.toBeInTheDocument();
  });

  it('does not render EmptyState when tasks are present', () => {
    render(
      <TasksPage
        {...BASE_PROPS}
        groups={[
          {
            label: '默认分组',
            tasks: [
              {
                id: 'task-1',
                title: '示例任务',
                project: 'AgentHub',
                assignee: 'Builder',
                startTime: '今天 10:00',
                dueDate: '明天 18:00',
                creator: 'Owner',
                status: '进行中',
              },
            ],
          },
        ]}
        emptyStateLabel="Hub tasks are not loaded in this replay."
      />,
    );

    expect(screen.queryByRole('region', { name: '暂无任务' })).not.toBeInTheDocument();
    expect(screen.getByText('示例任务')).toBeInTheDocument();
  });
});

describe('TasksPage infinite scroll (T14 skeleton)', () => {
  it('renders no load-more affordance when pagination props are absent', () => {
    render(<TasksPage {...BASE_PROPS} />);

    expect(
      screen.queryByRole('button', { name: '加载更多' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('加载中…')).not.toBeInTheDocument();
  });

  it('shows the fallback load-more button when hasMore is set and fires onLoadMore', () => {
    const onLoadMore = vi.fn();
    render(<TasksPage {...BASE_PROPS} hasMore onLoadMore={onLoadMore} />);

    const button = screen.getByRole('button', { name: '加载更多' });
    fireEvent.click(button);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('shows loading status and hides the button while loadingMore', () => {
    render(<TasksPage {...BASE_PROPS} hasMore loadingMore />);

    expect(
      screen.queryByRole('button', { name: '加载更多' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('加载中…')).toBeInTheDocument();
  });
});
