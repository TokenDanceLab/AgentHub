import React from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from './__tests__/setup';
import type { TaskItem } from './pages';
import type { WorkbenchTasksRoute } from './useWorkbenchTasksRoute';
import { WorkbenchTasksRouteView } from './WorkbenchTasksRouteView';
import {
  backFromTaskDeepLink,
  consumeWorkbenchTaskDeepLinkIntent,
  getWorkbenchTaskDeepLinkSnapshot,
  openTaskDetailForConversation,
  resetWorkbenchTaskDeepLinksForTest,
} from './workbenchTaskDeepLinks';

// Deep-link chrome copy resolves via the chatview namespace; opt into the en
// bundle of the shared test i18next instance (Issue #1717).
import { useTestI18nLanguage } from '@shared/testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('en');
});

beforeEach(() => {
  resetWorkbenchTaskDeepLinksForTest();
});

function makeTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: 'sqlite-plan',
    title: 'B0 SQLite 迁移方案',
    project: '前端重构任务',
    assignee: 'Builder',
    startTime: '今天 14:49',
    dueDate: '明天 18:00',
    creator: 'demo-user',
    status: '进行中',
    ...overrides,
  };
}

function makeTasksRoute(overrides: Partial<WorkbenchTasksRoute> = {}): WorkbenchTasksRoute {
  return {
    tasksPane: 'owned',
    taskViewMode: 'list',
    taskFilterActive: true,
    taskSortMode: 'custom',
    taskGroupMode: 'custom',
    taskShowCreator: true,
    selectedTaskId: null,
    taskNavMenuOpen: false,
    taskActionLabel: '筛选已启用',
    editingTaskId: null,
    editingTaskDraft: null,
    sourceTaskGroups: [],
    visibleTaskGroups: [],
    visibleTasks: [],
    selectedTask: null,
    hasMore: false,
    loadingMore: false,
    onLoadMore: undefined,
    setTaskViewMode: vi.fn(),
    handleTaskPaneChange: vi.fn(),
    handleCreateTask: vi.fn(),
    handleNewTaskGroup: vi.fn(),
    handleTaskList: vi.fn(),
    handleTaskSort: vi.fn(),
    handleTaskGroup: vi.fn(),
    handleEditSelectedTask: vi.fn(),
    handleEditTaskDraftChange: vi.fn(),
    handleSaveTaskEdit: vi.fn(),
    handleCancelTaskEdit: vi.fn(),
    handleDeleteSelectedTask: vi.fn(),
    handleCycleSelectedTaskStatus: vi.fn(),
    handleAssignSelectedTaskToMe: vi.fn(),
    handleGroupBySelectedTaskProject: vi.fn(),
    handleFilterBySelectedTaskAssignee: vi.fn(),
    handleTaskClick: vi.fn(),
    handleNavMore: vi.fn(),
    handleToolbarFieldConfig: vi.fn(),
    handleToolbarFilter: vi.fn(),
    ...overrides,
  };
}

function renderRouteView(overrides: Partial<WorkbenchTasksRoute> = {}) {
  const tasksRoute = makeTasksRoute(overrides);
  render(
    <WorkbenchTasksRouteView tasksRoute={tasksRoute} realDataMode={false} profiles={[]} />,
  );
  return { tasksRoute };
}

describe('WorkbenchTasksRouteView deep-link chrome (#1963)', () => {
  it('renders no deep-link actions without a selected task', () => {
    renderRouteView();
    expect(screen.queryByRole('button', { name: 'Open hosting conversation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to conversation' })).not.toBeInTheDocument();
  });

  it('offers the hosting-conversation jump for a bound selected task and queues the intent', () => {
    renderRouteView({
      selectedTaskId: 'sqlite-plan',
      selectedTask: makeTask({ conversationId: 'builder' }),
    });

    const button = screen.getByRole('button', { name: 'Open hosting conversation' });
    fireEvent.click(button);

    const { pending } = getWorkbenchTaskDeepLinkSnapshot();
    expect(pending?.type).toBe('open');
    if (pending?.type !== 'open') return;
    expect(pending.link.direction).toBe('task-to-conversation');
    expect(pending.link.taskId).toBe('sqlite-plan');
    expect(pending.link.conversationId).toBe('builder');
  });

  it('offers no conversation jump when the selected task has no hosting conversation', () => {
    renderRouteView({
      selectedTaskId: 'sqlite-plan',
      selectedTask: makeTask(),
    });
    expect(screen.queryByRole('button', { name: 'Open hosting conversation' })).not.toBeInTheDocument();
  });

  it('shows a back affordance after a conversation→task deep link and queues the back intent', () => {
    // Simulate the shell applying an intent queued from the sidebar task queue.
    openTaskDetailForConversation(makeTask());
    consumeWorkbenchTaskDeepLinkIntent();

    renderRouteView({
      selectedTaskId: 'sqlite-plan',
      selectedTask: makeTask({ conversationId: 'builder' }),
    });

    const back = screen.getByRole('button', { name: 'Back to conversation' });
    fireEvent.click(back);

    const { pending } = getWorkbenchTaskDeepLinkSnapshot();
    expect(pending?.type).toBe('back');
    if (pending?.type !== 'back') return;
    expect(pending.link.direction).toBe('conversation-to-task');
  });

  it('hides the back affordance once the back intent has been applied', () => {
    openTaskDetailForConversation(makeTask());
    consumeWorkbenchTaskDeepLinkIntent();
    backFromTaskDeepLink();
    consumeWorkbenchTaskDeepLinkIntent();

    renderRouteView({
      selectedTaskId: 'sqlite-plan',
      selectedTask: makeTask({ conversationId: 'builder' }),
    });
    expect(screen.queryByRole('button', { name: 'Back to conversation' })).not.toBeInTheDocument();
    // The forward jump is independent of the back trip.
    expect(screen.getByRole('button', { name: 'Open hosting conversation' })).toBeInTheDocument();
  });
});
