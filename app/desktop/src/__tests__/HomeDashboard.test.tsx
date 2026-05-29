import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import HomeDashboard from '@/components/HomeDashboard';
import * as useHealthModule from '@/hooks/useHealth';
<<<<<<< HEAD
=======
import type { AgentInfo } from '@shared/types';
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)

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

<<<<<<< HEAD
vi.mock('@/stores/taskBridgeStore', () => ({
  useTaskBridgeStore: (selector?: (s: { tasks: Array<{ status: string }> }) => unknown) => {
    const state = { tasks: [{ status: 'running' }, { status: 'done' }] };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/stores/hubStore', () => ({
  useHubStore: (selector?: (s: { authenticated: boolean; username: string | null }) => unknown) => {
    const state = { authenticated: true, username: 'Ding' };
    return selector ? selector(state) : state;
  },
}));
=======
const dashboardProps = () => ({
  onNewThread: vi.fn(),
  onSelectThread: vi.fn(),
  onQuickStart: vi.fn(),
  onViewRuns: vi.fn(),
  onReviewApprovals: vi.fn(),
  onViewAllThreads: vi.fn(),
  onOpenTeamRuns: vi.fn(),
  onOpenHubAccount: vi.fn(),
});

const baseCapabilities: AgentInfo['capabilities'] = {
  streaming: true,
  toolCalls: true,
  fileChanges: true,
  thinkingVisible: true,
  multiTurn: true,
  mcpIntegration: true,
  permissionHooks: true,
  subAgentSpawn: false,
};
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)

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
        {...dashboardProps()}
      />,
    );

    expect(screen.getByText('home.activeRuns')).toBeInTheDocument();
    // 2 active runs (running + queued)
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('home.viewAllRuns')).toBeInTheDocument();
  });

  it('renders pending approvals card', () => {
    const onOpenApprovals = vi.fn();
    render(
      <HomeDashboard
<<<<<<< HEAD
        onNewThread={vi.fn()}
        onSelectThread={vi.fn()}
        onQuickStart={vi.fn()}
        onOpenApprovals={onOpenApprovals}
=======
        {...dashboardProps()}
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
        permissionCount={3}
      />,
    );

    expect(screen.getByText('home.pendingApprovals')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    fireEvent.click(screen.getByText('home.reviewApprovals'));
    expect(onOpenApprovals).toHaveBeenCalledTimes(1);
  });

  it('renders Hub session and bridged task summary', () => {
    render(
      <HomeDashboard
        {...dashboardProps()}
      />,
    );

    expect(screen.getByText('home.hubSession')).toBeInTheDocument();
    expect(screen.getByText('home.hubConnected')).toBeInTheDocument();
    expect(screen.getByText('home.hubBridgeSummary')).toBeInTheDocument();
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
        {...dashboardProps()}
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
        {...dashboardProps()}
      />,
    );

    expect(screen.getByText('home.offline')).toBeInTheDocument();
    expect(screen.getByText('home.edgeDisconnected')).toBeInTheDocument();
  });

  it('renders recent threads', () => {
    render(
      <HomeDashboard
        {...dashboardProps()}
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
        {...dashboardProps()}
      />,
    );

    expect(screen.getByText('home.noRecentThreads')).toBeInTheDocument();
  });

  it('calls onSelectThread when a thread is clicked', () => {
    const onSelect = vi.fn();
    render(
      <HomeDashboard
        {...dashboardProps()}
        onSelectThread={onSelect}
      />,
    );

    fireEvent.click(screen.getByText('Fix auth bug'));
    expect(onSelect).toHaveBeenCalledWith('t1');
  });

  it('calls onNewThread when CTA is clicked', () => {
    const onNew = vi.fn();
    render(
      <HomeDashboard
        {...dashboardProps()}
        onNewThread={onNew}
      />,
    );

    fireEvent.click(screen.getByText('home.newThread'));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it('opens the run queue from active runs card', () => {
    const onOpenRuns = vi.fn();
    render(
      <HomeDashboard
<<<<<<< HEAD
        onNewThread={vi.fn()}
        onSelectThread={vi.fn()}
        onQuickStart={vi.fn()}
        onOpenRuns={onOpenRuns}
      />,
    );

    fireEvent.click(screen.getByText('home.viewAllRuns'));
    expect(onOpenRuns).toHaveBeenCalledTimes(1);
  });

  it('renders quick start suggestions', () => {
    render(
      <HomeDashboard
=======
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
        {...dashboardProps()}
      />,
    );

    expect(screen.getByText('home.quickStartLabel')).toBeInTheDocument();
    expect(screen.getByText('home.quickStart1')).toBeInTheDocument();
    expect(screen.getByText('home.quickStart2')).toBeInTheDocument();
    expect(screen.getByText('home.quickStart3')).toBeInTheDocument();
  });

  it('shows an honest signed-out TeamRun state with account action', () => {
    const props = dashboardProps();
    render(<HomeDashboard {...props} agentTeamsSignedIn={false} />);

    expect(screen.getByTestId('home-teamrun-panel')).toBeInTheDocument();
    expect(screen.getByText('home.teamRunSignedOut')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'home.teamRunSignIn' }));
    expect(props.onOpenHubAccount).toHaveBeenCalledTimes(1);
  });

  it('shows local orchestration as usable when Hub TeamRun sync is signed out', () => {
    const props = dashboardProps();
    const onSelectAgent = vi.fn();
    const agents: AgentInfo[] = [
      {
        id: 'orchestrator',
        name: 'Orchestrator',
        status: 'available',
        capabilities: { ...baseCapabilities, subAgentSpawn: true },
      },
      {
        id: 'codex',
        name: 'Codex',
        status: 'available',
        capabilities: baseCapabilities,
      },
      {
        id: 'claude-code',
        name: 'Claude Code',
        status: 'available',
        capabilities: baseCapabilities,
      },
    ];

    render(
      <HomeDashboard
        {...props}
        agentTeamsSignedIn={false}
        agents={agents}
        selectedAgentId="codex"
        onSelectAgent={onSelectAgent}
      />,
    );

    expect(screen.getByText('home.localOrchestrationReady')).toBeInTheDocument();
    expect(screen.getByText('home.teamRunHubSyncSignedOut')).toBeInTheDocument();
    expect(screen.queryByText('home.teamRunSignedOut')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'home.localOrchestrationAction' }));
    expect(onSelectAgent).toHaveBeenCalledWith('orchestrator');
  });

  it('starts the local orchestration workflow with a composer draft when wired by the shell', () => {
    const props = dashboardProps();
    const onStartLocalOrchestration = vi.fn();
    const onSelectAgent = vi.fn();
    const agents: AgentInfo[] = [
      {
        id: 'orchestrator',
        name: 'Orchestrator',
        status: 'available',
        capabilities: { ...baseCapabilities, subAgentSpawn: true },
      },
      {
        id: 'codex',
        name: 'Codex',
        status: 'available',
        capabilities: baseCapabilities,
      },
    ];

    render(
      <HomeDashboard
        {...props}
        agentTeamsSignedIn={false}
        agents={agents}
        selectedAgentId="orchestrator"
        onSelectAgent={onSelectAgent}
        onStartLocalOrchestration={onStartLocalOrchestration}
      />,
    );

    const button = screen.getByTestId('home-local-orchestration-action');
    expect(button).not.toBeDisabled();
    fireEvent.click(button);

    expect(onStartLocalOrchestration).toHaveBeenCalledWith(
      'orchestrator',
      'home.localOrchestrationDraft',
    );
    expect(onSelectAgent).not.toHaveBeenCalled();
  });

  it('renders active TeamRun metrics from real Hub overview data', () => {
    const props = dashboardProps();
    render(
      <HomeDashboard
        {...props}
        agentTeamsSignedIn
        agentTeamOverview={{
          teams: [{ id: 'team-1', name: 'Review Team', members: [{ id: 'member-1', team_id: 'team-1', role: 'supervisor' }] }],
          bundles: [{
            team: { id: 'team-1', name: 'Review Team', members: [{ id: 'member-1', team_id: 'team-1', role: 'supervisor' }] },
            runs: [{ id: 'run-1', team_id: 'team-1', status: 'running', trigger_message: 'Review Desktop orchestration.' }],
            latestRun: { id: 'run-1', team_id: 'team-1', status: 'running', trigger_message: 'Review Desktop orchestration.' },
          }],
          customAgents: [],
          selectedTeam: { id: 'team-1', name: 'Review Team', members: [{ id: 'member-1', team_id: 'team-1', role: 'supervisor' }] },
          selectedRun: { id: 'run-1', team_id: 'team-1', status: 'running', trigger_message: 'Review Desktop orchestration.' },
          state: {
            run_id: 'run-1',
            team_id: 'team-1',
            status: 'running',
            members: [{ member_id: 'member-1', role: 'supervisor', active_tasks: 1 }],
            tasks: [{ task_id: 'task-1', status: 'running', objective: 'Review Desktop orchestration.' }],
            approvals: [{ approval_id: 'approval-1', status: 'pending', tool_name: 'write_file' }],
            conflicts: [{ conflict_id: 'conflict-1', path: 'app/desktop/src/App.tsx', status: 'open' }],
            route_log: [{ action: 'delegate', next_worker: 'reviewer', instructions: 'Review Desktop orchestration.' }],
          },
          tasks: [],
          events: [],
        }}
      />,
    );

    expect(screen.getByText('Review Team')).toBeInTheDocument();
    expect(screen.getByText('settings.teamRunStatus.running')).toBeInTheDocument();
    expect(screen.getByText('Review Desktop orchestration.')).toBeInTheDocument();
    expect(screen.getByText('home.teamRunBlocks: 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'home.teamRunOpenConsole' }));
    expect(props.onOpenTeamRuns).toHaveBeenCalledTimes(1);
  });

  it('calls onQuickStart when a quick start chip is clicked', () => {
    const onQuickStart = vi.fn();
    render(
      <HomeDashboard
        {...dashboardProps()}
        onQuickStart={onQuickStart}
      />,
    );

    fireEvent.click(screen.getByText('home.quickStart1'));
    expect(onQuickStart).toHaveBeenCalledWith('home.quickStart1');
  });

  it('opens the runs view when the active runs footer is clicked', () => {
    const props = dashboardProps();
    render(<HomeDashboard {...props} />);

    fireEvent.click(screen.getByText('home.viewAllRuns'));
    expect(props.onViewRuns).toHaveBeenCalledTimes(1);
  });

  it('disables review approvals when there is no pending request', () => {
    const props = dashboardProps();
    render(<HomeDashboard {...props} permissionCount={0} />);

    const button = screen.getByRole('button', { name: 'home.reviewApprovals' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(props.onReviewApprovals).not.toHaveBeenCalled();
  });

  it('calls review approvals when pending requests exist', () => {
    const props = dashboardProps();
    render(<HomeDashboard {...props} permissionCount={2} />);

    fireEvent.click(screen.getByRole('button', { name: 'home.reviewApprovals' }));
    expect(props.onReviewApprovals).toHaveBeenCalledTimes(1);
  });

  it('opens the full thread list when more than five threads exist', () => {
    const props = dashboardProps();
    mockUseThreads.mockReturnValue({
      data: {
        items: Array.from({ length: 6 }, (_, index) => ({
          threadId: `t${index}`,
          projectId: 'p1',
          title: `Thread ${index}`,
          status: 'active',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: `2026-01-0${index + 1}T00:00:00Z`,
        })),
      },
    });

    render(<HomeDashboard {...props} />);

    fireEvent.click(screen.getByText('home.viewAll'));
    expect(props.onViewAllThreads).toHaveBeenCalledTimes(1);
  });
});
