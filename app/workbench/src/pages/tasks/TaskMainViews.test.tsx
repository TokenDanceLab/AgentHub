import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TaskMain } from './TaskMainViews';
import type { TasksPageProps } from './types';

const noop = (): void => {};

const baseProps = {
  activePane: 'mine' as const,
  viewMode: 'list' as const,
  onViewModeChange: vi.fn(),
  groups: [],
  emptyStateLabel: '暂无任务',
  comingSoonEmptyState: false,
  demoDataActive: false,
  profiles: [],
  selectedTask: null,
  taskActionLabel: '',
  editingTaskId: null,
  editingDraft: null,
  incompleteCount: 0,
  dueTodayCount: 0,
  crossProjectCount: 0,
  activeFilterCount: 0,
  sortLabel: '排序',
  groupLabel: '分组',
  fieldConfigLabel: '字段',
  sortActive: false,
  groupActive: false,
  fieldConfigActive: false,
  showCreatorColumn: true,
  selectedTaskId: null,
  hasMore: false,
  loadingMore: false,
  onLoadMore: noop,
  onCreateTask: noop,
  onAddTaskRow: noop,
  onTaskClick: noop,
  onToolbarFilter: noop,
  onToolbarSort: noop,
  onToolbarGroup: noop,
  onToolbarFieldConfig: noop,
  onCycleSelectedTaskStatus: noop,
  onAssignSelectedTaskToMe: noop,
  onGroupBySelectedTaskProject: noop,
  onFilterBySelectedTaskAssignee: noop,
  onEditSelectedTask: noop,
  onDeleteSelectedTask: noop,
  onEditDraftChange: noop,
  onSaveTaskEdit: noop,
  onCancelTaskEdit: noop,
} satisfies Partial<TasksPageProps>;

describe('TaskMain view tablist roving tabindex (#1823)', () => {
  it('moves focus with ArrowRight without changing the view mode', () => {
    render(<TaskMain {...baseProps} />);
    const listTab = screen.getByRole('tab', { name: '列表' });
    listTab.focus();
    fireEvent.keyDown(listTab, { key: 'ArrowRight' });

    const boardTab = screen.getByRole('tab', { name: '看板' });
    expect(document.activeElement).toBe(boardTab);
    expect(boardTab).toHaveAttribute('tabindex', '0');
    expect(listTab).toHaveAttribute('tabindex', '-1');
    // Activation stays on click/Enter — arrows move focus only.
    expect(listTab).toHaveAttribute('aria-selected', 'true');
    expect(boardTab).toHaveAttribute('aria-selected', 'false');
    expect(baseProps.onViewModeChange).not.toHaveBeenCalledWith('board');
  });

  it('supports Home/End and wraps with ArrowLeft', () => {
    render(<TaskMain {...baseProps} />);
    const tabs = screen.getAllByRole('tab');

    tabs[0]!.focus();
    fireEvent.keyDown(tabs[0]!, { key: 'Home' });
    expect(document.activeElement).toBe(tabs[0]);

    fireEvent.keyDown(tabs[0]!, { key: 'End' });
    expect(document.activeElement).toBe(tabs[tabs.length - 1]);

    fireEvent.keyDown(tabs[tabs.length - 1]!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tabs[tabs.length - 2]);
  });

  it('associates the tablist with the tabpanel', () => {
    const { container } = render(<TaskMain {...baseProps} />);
    const panel = container.querySelector('[role="tabpanel"]');
    const listTab = screen.getByRole('tab', { name: '列表' });
    expect(panel).not.toBeNull();
    expect(listTab.getAttribute('aria-controls')).toBe(panel!.id);
    expect(panel!.getAttribute('aria-labelledby')).toBe(listTab.id);
  });

  it('moves the roving stop to the clicked view tab (#1823)', () => {
    render(<TaskMain {...baseProps} />);
    const listTab = screen.getByRole('tab', { name: '列表' });
    listTab.focus();
    fireEvent.keyDown(listTab, { key: 'ArrowRight' });
    const boardTab = screen.getByRole('tab', { name: '看板' });
    expect(boardTab).toHaveAttribute('tabindex', '0');

    // A click activates another tab — the roving stop must follow it so the
    // next Tab press returns to the clicked tab, not the stale focused one.
    const dashTab = screen.getByRole('tab', { name: '仪表盘' });
    fireEvent.click(dashTab);
    expect(baseProps.onViewModeChange).toHaveBeenCalledWith('dashboard');
    expect(dashTab).toHaveAttribute('tabindex', '0');
    expect(boardTab).toHaveAttribute('tabindex', '-1');
    expect(listTab).toHaveAttribute('tabindex', '-1');
  });
});
