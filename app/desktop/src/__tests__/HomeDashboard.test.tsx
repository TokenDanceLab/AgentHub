import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import HomeDashboard from '@/components/HomeDashboard';
import * as useHealthModule from '@/hooks/useHealth';
import * as threadQueriesModule from '@/api/threadQueries';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/hooks/useHealth', () => ({
  useHealth: vi.fn(() => ({
    online: true,
    health: { version: 'v1.0.0', status: 'ok', checks: {} },
  })),
}));

vi.mock('@/api/runQueries', () => ({
  useRuns: () => ({
    data: {
      items: [
        { runId: 'run-1', projectId: 'p1', threadId: 't1', status: 'running', createdAt: '2026-01-01T00:00:00Z' },
        { runId: 'run-2', projectId: 'p1', threadId: 't2', status: 'queued', createdAt: '2026-01-02T00:00:00Z' },
        { runId: 'run-3', projectId: 'p1', threadId: 't3', status: 'completed', createdAt: '2026-01-03T00:00:00Z' },
      ],
    },
  }),
}));

const mockUseThreads = vi.fn(() => ({
  data: {
    items: [
      { threadId: 't1', projectId: 'p1', title: 'Fix auth bug', status: 'active', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
      { threadId: 't2', projectId: 'p1', title: 'Add tests', status: 'active', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T12:00:00Z' },
    ],
  },
}));

vi.mock('@/api/threadQueries', () => ({
  useThreads: () => mockUseThreads(),
}));

vi.mock('@/stores/taskBridgeStore', () => ({
  useTaskBridgeStore: () => ({
    tasks: [],
  }),
}));

describe('HomeDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseThreads.mockReturnValue({
      data: {
        items: [
          { threadId: 't1', projectId: 'p1', title: 'Fix auth bug', status: 'active', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
          { threadId: 't2', projectId: 'p1', title: 'Add tests', status: 'active', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T12:00:00Z' },
        ],
      },
    });
  });

  it('renders active runs count', () => {
    render(
      <HomeDashboard
        onNewThread={vi.fn()}
        onSelectThread={vi.fn()}
        onQuickStart={vi.fn()}
      />,
    );

    expect(screen.getByText('home.activeRuns')).toBeInTheDocument();
    // 2 active runs (running + queued)
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('home.viewAllRuns')).toBeInTheDocument();
  });

  it('renders pending approvals card', () => {
    render(
      <HomeDashboard
        onNewThread={vi.fn()}
        onSelectThread={vi.fn()}
        onQuickStart={vi.fn()}
        permissionCount={3}
      />,
    );

    expect(screen.getByText('home.pendingApprovals')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('opens TeamRun Console from the dashboard card', () => {
    const onOpenTeamRuns = vi.fn();
    render(
      <HomeDashboard
        onNewThread={vi.fn()}
        onSelectThread={vi.fn()}
        onQuickStart={vi.fn()}
        onOpenTeamRuns={onOpenTeamRuns}
      />,
    );

    expect(screen.getByText('home.activeTeamRuns')).toBeInTheDocument();
    fireEvent.click(screen.getByText('home.openTeamRuns'));
    expect(onOpenTeamRuns).toHaveBeenCalledTimes(1);
  });

  it('renders target health card', () => {
    render(
      <HomeDashboard
        onNewThread={vi.fn()}
        onSelectThread={vi.fn()}
        onQuickStart={vi.fn()}
      />,
    );

    expect(screen.getByText('home.targetHealth')).toBeInTheDocument();
    expect(screen.getByText('v1.0.0')).toBeInTheDocument();
    expect(screen.getByText('home.edgeConnected')).toBeInTheDocument();
  });

  it('shows health as red when offline', () => {
    vi.mocked(useHealthModule.useHealth).mockReturnValue({
      online: false,
      health: null,
    });

    render(
      <HomeDashboard
        onNewThread={vi.fn()}
        onSelectThread={vi.fn()}
        onQuickStart={vi.fn()}
      />,
    );

    expect(screen.getByText('home.offline')).toBeInTheDocument();
    expect(screen.getByText('home.edgeDisconnected')).toBeInTheDocument();
  });

  it('renders recent threads', () => {
    render(
      <HomeDashboard
        onNewThread={vi.fn()}
        onSelectThread={vi.fn()}
        onQuickStart={vi.fn()}
      />,
    );

    expect(screen.getByText('home.recentThreads')).toBeInTheDocument();
    expect(screen.getByText('Fix auth bug')).toBeInTheDocument();
    expect(screen.getByText('Add tests')).toBeInTheDocument();
  });

  it('shows empty state when no recent threads', () => {
    mockUseThreads.mockReturnValue({ data: { items: [] } });

    render(
      <HomeDashboard
        onNewThread={vi.fn()}
        onSelectThread={vi.fn()}
        onQuickStart={vi.fn()}
      />,
    );

    expect(screen.getByText('home.noRecentThreads')).toBeInTheDocument();
  });

  it('calls onSelectThread when a thread is clicked', () => {
    const onSelect = vi.fn();
    render(
      <HomeDashboard
        onNewThread={vi.fn()}
        onSelectThread={onSelect}
        onQuickStart={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Fix auth bug'));
    expect(onSelect).toHaveBeenCalledWith('t1');
  });

  it('calls onNewThread when CTA is clicked', () => {
    const onNew = vi.fn();
    render(
      <HomeDashboard
        onNewThread={onNew}
        onSelectThread={vi.fn()}
        onQuickStart={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('home.newThread'));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it('renders quick start suggestions', () => {
    render(
      <HomeDashboard
        onNewThread={vi.fn()}
        onSelectThread={vi.fn()}
        onQuickStart={vi.fn()}
      />,
    );

    expect(screen.getByText('home.quickStartLabel')).toBeInTheDocument();
    expect(screen.getByText('home.quickStart1')).toBeInTheDocument();
    expect(screen.getByText('home.quickStart2')).toBeInTheDocument();
    expect(screen.getByText('home.quickStart3')).toBeInTheDocument();
  });

  it('calls onQuickStart when a quick start chip is clicked', () => {
    const onQuickStart = vi.fn();
    render(
      <HomeDashboard
        onNewThread={vi.fn()}
        onSelectThread={vi.fn()}
        onQuickStart={onQuickStart}
      />,
    );

    fireEvent.click(screen.getByText('home.quickStart1'));
    expect(onQuickStart).toHaveBeenCalledWith('home.quickStart1');
  });
});
