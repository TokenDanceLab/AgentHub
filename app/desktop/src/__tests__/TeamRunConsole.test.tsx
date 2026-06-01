import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import TeamRunConsole from '@/components/TeamRunConsole';

const mockLoginWithTokenDance = vi.fn();
const mockUseAuth = vi.fn();
const mockUseAgentTeams = vi.fn();
const mockUseTeamRuns = vi.fn();
const mockUseTeamRunsForTeams = vi.fn();
const mockUseTeamRunState = vi.fn();
const mockUseTeamEvents = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/api/teamRunQueries', () => ({
  useAgentTeams: (...args: unknown[]) => mockUseAgentTeams(...args),
  useTeamRuns: (...args: unknown[]) => mockUseTeamRuns(...args),
  useTeamRunsForTeams: (...args: unknown[]) => mockUseTeamRunsForTeams(...args),
  useTeamRunState: (...args: unknown[]) => mockUseTeamRunState(...args),
  useTeamEvents: (...args: unknown[]) => mockUseTeamEvents(...args),
}));

const baseTeam = {
  id: 'team-1',
  name: 'Builder Team',
  description: 'Build and review',
  created_at: '2026-05-29T00:00:00Z',
  updated_at: '2026-05-29T00:00:00Z',
};

const baseRun = {
  id: 'run-1',
  team_id: 'team-1',
  trigger_message: 'Ship TeamRun console',
  status: 'running',
  created_at: '2026-05-29T00:00:00Z',
  updated_at: '2026-05-29T00:00:00Z',
};

const baseState = {
  run_id: 'run-1',
  team_id: 'team-1',
  status: 'running',
  members: [
    { member_id: 'member-supervisor', agent_profile_id: 'profile-supervisor', role: 'supervisor', active_tasks: 1, completed_tasks: 0 },
    { member_id: 'member-builder', agent_profile_id: 'profile-builder', role: 'executor', active_tasks: 0, completed_tasks: 1 },
  ],
  tasks: [
    {
      task_id: 'task-1',
      assignee_member_id: 'member-supervisor',
      status: 'running',
      objective: 'Route work to the builder',
      run_id: 'agent-task-1',
      agent_task_id: 'agent-task-1',
      edge_run_id: 'edge-run-1',
      attempt: 1,
      risk_level: 'medium',
    },
    {
      task_id: 'task-2',
      assignee_member_id: 'member-builder',
      parent_task_id: 'task-1',
      status: 'done',
      objective: 'Implement read-only console',
      run_id: 'agent-task-2',
      agent_task_id: 'agent-task-2',
      edge_run_id: 'edge-run-2',
      attempt: 1,
      risk_level: 'low',
    },
  ],
  dependencies: [{ task_id: 'task-2', depends_on_task_id: 'task-1', kind: 'parent_task' }],
  assignments: [],
  approvals: [
    {
      approval_id: 'approval-1',
      agent_task_id: 'agent-task-1',
      team_task_id: 'task-1',
      request_id: 'request-1',
      tool_name: 'shell',
      status: 'pending',
      created_at: '2026-05-29T00:01:00Z',
    },
  ],
  artifacts: [
    {
      agent_task_id: 'agent-task-2',
      team_task_id: 'task-2',
      path: 'app/desktop/src/components/TeamRunConsole.tsx',
      action: 'modify',
      status: 'created',
      conflict_id: 'conflict-1',
      created_at: '2026-05-29T00:02:00Z',
    },
  ],
  conflicts: [
    {
      conflict_id: 'conflict-1',
      path: 'app/desktop/src/components/TeamRunConsole.tsx',
      status: 'open',
      agent_task_ids: ['agent-task-2'],
    },
  ],
  run_events: [
    {
      agent_task_id: 'agent-task-2',
      edge_run_id: 'edge-run-2',
      event_seq: 7,
      event_type: 'run.agent.result',
      payload: JSON.stringify({ summary: 'Implementation finished' }),
      created_at: '2026-05-29T00:03:00Z',
    },
  ],
  route_log: [
    {
      action: 'delegate',
      next_worker: 'member-builder',
      instructions: 'Build the console',
      reasoning: 'Builder owns UI implementation',
    },
  ],
  budget: {
    total_tokens_used: 1200,
    token_limit: 10000,
    remaining_tokens: 8800,
    usage_percent: 12,
    run_count: 2,
  },
  terminal_reason: 'Waiting for approval review',
};

function signedInDefaults() {
  mockUseAuth.mockReturnValue({
    isAuthenticated: true,
    token: 'hub-token',
    loginWithTokenDance: mockLoginWithTokenDance,
  });
  mockUseAgentTeams.mockReturnValue({ data: [baseTeam], isFetching: false, error: null });
  mockUseTeamRunsForTeams.mockReturnValue([{ teamId: baseTeam.id, runs: [baseRun], isFetching: false, error: null }]);
  mockUseTeamRuns.mockReturnValue({ data: [baseRun], isFetching: false, error: null });
  mockUseTeamRunState.mockReturnValue({ data: baseState, isLoading: false, error: null });
  mockUseTeamEvents.mockReturnValue({
    data: [{ id: 'event-1', team_run_id: 'run-1', seq: 1, type: 'team.run.started', payload: '{}', created_at: '2026-05-29T00:00:00Z' }],
    isFetching: false,
    error: null,
  });
}

describe('TeamRunConsole', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signedInDefaults();
  });

  it('shows a Hub sign-in lock when signed out', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      token: null,
      loginWithTokenDance: mockLoginWithTokenDance,
    });

    render(<TeamRunConsole />);

    expect(screen.getByText('teamrun.signedOutTitle')).toBeInTheDocument();
    expect(screen.getByText('teamrun.signedOutDesc')).toBeInTheDocument();
    expect(screen.getByText('teamrun.localEdgeHint')).toBeInTheDocument();
    expect(screen.getByText('settings.signIn')).toBeInTheDocument();
    expect(screen.getByText('teamrun.viewFixtureDemo')).toBeInTheDocument();
    expect(mockUseAgentTeams).toHaveBeenCalledWith(false);
  });

  it('opens a read-only fixture demo from the signed-out state', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      token: null,
      loginWithTokenDance: mockLoginWithTokenDance,
    });

    render(<TeamRunConsole />);
    fireEvent.click(screen.getByText('teamrun.viewFixtureDemo'));

    expect(screen.getByText('teamrun.sourceFixture')).toBeInTheDocument();
    expect(screen.getByText('teamrun.readOnly')).toBeInTheDocument();
    expect(screen.getByText('teamrun.backToSignIn')).toBeInTheDocument();
    expect(screen.getByText('Frontend Console Demo')).toBeInTheDocument();
  });

  it('shows clearly labeled fixture demo data when Hub has no live teams', () => {
    mockUseAgentTeams.mockReturnValue({ data: [], isFetching: false, error: null });
    mockUseTeamRuns.mockReturnValue({ data: [], isFetching: false, error: null });
    mockUseTeamRunState.mockReturnValue({ data: undefined, isLoading: false, error: null });

    render(<TeamRunConsole />);

    expect(screen.getByText('teamrun.sourceFixture')).toBeInTheDocument();
    expect(screen.getByText('Frontend Console Demo')).toBeInTheDocument();
    expect(screen.getAllByText('Prepare TeamRun Console demo evidence').length).toBeGreaterThan(0);
    expect(screen.getByText('teamrun.readOnly')).toBeInTheDocument();
  });

  it('falls back to fixture demo data when a live team has no TeamRuns yet', () => {
    mockUseTeamRuns.mockReturnValue({ data: [], isFetching: false, error: null });
    mockUseTeamRunState.mockReturnValue({ data: undefined, isLoading: false, error: null });

    render(<TeamRunConsole />);

    expect(screen.getByText('teamrun.sourceFixture')).toBeInTheDocument();
    expect(screen.getByText('Frontend Console Demo')).toBeInTheDocument();
    expect(screen.getAllByText('Prepare TeamRun Console demo evidence').length).toBeGreaterThan(0);
  });

  it('renders active TeamRun state with tasks and route activity', () => {
    render(<TeamRunConsole />);

    expect(screen.getByText('teamrun.sourceLive')).toBeInTheDocument();
    expect(screen.getAllByText('Ship TeamRun console').length).toBeGreaterThan(0);
    expect(screen.getByText('Route work to the builder')).toBeInTheDocument();
    expect(screen.getByText('Implement read-only console')).toBeInTheDocument();
    expect(screen.getByText('Builder owns UI implementation')).toBeInTheDocument();
    expect(screen.getByText('Implementation finished')).toBeInTheDocument();
  });

  it('renders pending approvals, artifacts, conflicts, and terminal reason', () => {
    render(<TeamRunConsole />);

    expect(screen.getByText('Waiting for approval review')).toBeInTheDocument();
    expect(screen.getByText('shell')).toBeInTheDocument();
    expect(screen.getAllByText('app/desktop/src/components/TeamRunConsole.tsx')).toHaveLength(2);
    expect(screen.getByText('conflict')).toBeInTheDocument();
  });

  it('defaults to the first active run across teams', async () => {
    const quietTeam = { ...baseTeam, id: 'team-quiet', name: 'Quiet Team' };
    const activeTeam = { ...baseTeam, id: 'team-active', name: 'Active Team' };
    const completedRun = {
      ...baseRun,
      id: 'run-completed',
      team_id: quietTeam.id,
      status: 'completed',
      trigger_message: 'Completed quiet run',
      updated_at: '2026-05-29T00:05:00Z',
    };
    const activeRun = {
      ...baseRun,
      id: 'run-active',
      team_id: activeTeam.id,
      status: 'running',
      trigger_message: 'Active second team run',
      updated_at: '2026-05-29T00:02:00Z',
    };
    const activeState = {
      ...baseState,
      run_id: activeRun.id,
      team_id: activeTeam.id,
    };

    mockUseAgentTeams.mockReturnValue({ data: [quietTeam, activeTeam], isFetching: false, error: null });
    mockUseTeamRunsForTeams.mockReturnValue([
      { teamId: quietTeam.id, runs: [completedRun], isFetching: false, error: null },
      { teamId: activeTeam.id, runs: [activeRun], isFetching: false, error: null },
    ]);
    mockUseTeamRuns.mockImplementation((teamId: string) => ({
      data: teamId === activeTeam.id ? [activeRun] : [completedRun],
      isFetching: false,
      error: null,
    }));
    mockUseTeamRunState.mockImplementation((_teamId: string, runId: string) => ({
      data: runId === activeRun.id ? activeState : baseState,
      isLoading: false,
      error: null,
    }));

    render(<TeamRunConsole />);

    await waitFor(() => {
      expect(screen.getAllByText('Active second team run').length).toBeGreaterThan(0);
    });
  });
});
