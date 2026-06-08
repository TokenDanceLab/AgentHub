import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TeamRunConsole from './TeamRunConsole';

const startTeamRunMock = vi.hoisted(() => vi.fn());
const refetchTeamsMock = vi.hoisted(() => vi.fn());
const executionTargetsState = vi.hoisted(() => ({
  items: [] as Array<{
    id: string;
    name?: string;
    target_type: string;
    is_online: boolean;
    health_state: string;
  }>,
  isLoading: false,
  isFetching: false,
  error: null as unknown,
}));
const teamRunsState = vi.hoisted(() => ({
  runs: [] as Array<{
    id: string;
    team_id: string;
    status: string;
    created_at?: string;
  }>,
}));
const hubClientMock = vi.hoisted(() => ({
  getTeamRunState: vi.fn(),
  listTeamTasks: vi.fn(),
  listTeamEvents: vi.fn(),
  getAgentTeam: vi.fn(),
  getTeamRun: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, options?: Record<string, string>) => {
      let text = fallback ?? _key;
      for (const [key, value] of Object.entries(options ?? {})) {
        text = text.replace(`{{${key}}}`, value);
      }
      return text;
    },
  }),
}));

vi.mock('@/stores/hubStore', () => ({
  useHubStore: (selector: (state: { authenticated: boolean }) => unknown) =>
    selector({ authenticated: true }),
}));

vi.mock('@/hooks/useAuth', () => ({
  getAccessToken: () => 'hub-token',
}));

vi.mock('@/api/executionTargetQueries', () => ({
  useHubExecutionTargets: () => ({
    data: { items: executionTargetsState.items, page: { hasMore: false } },
    isLoading: executionTargetsState.isLoading,
    isFetching: executionTargetsState.isFetching,
    error: executionTargetsState.error,
  }),
  selectOnlineLocalEdgeExecutionTarget: (
    targets: Array<{ id: string; target_type: string; is_online: boolean; health_state: string }>,
  ) => targets.find((target) =>
    target.target_type === 'local_edge' &&
    target.is_online &&
    target.health_state !== 'offline'
  ),
}));

vi.mock('@/api/agentTeamQueries', () => ({
  useHubAgentTeams: (options: { selectedRunId?: string }) => ({
    data: {
      teams: [{ id: 'team-1', name: 'P0 Team', description: 'Remote control team' }],
      bundles: [{
        team: { id: 'team-1', name: 'P0 Team', description: 'Remote control team', members: [] },
        runs: teamRunsState.runs,
      }],
      selectedTeam: { id: 'team-1', name: 'P0 Team', description: 'Remote control team', members: [] },
      selectedRun: options.selectedRunId
        ? teamRunsState.runs.find((run) => run.id === options.selectedRunId)
        : undefined,
      tasks: [],
      events: [],
    },
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: refetchTeamsMock,
  }),
  useCreateAgentTeam: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useStartTeamRun: () => ({ mutateAsync: startTeamRunMock, isPending: false }),
  useDecideTeamApproval: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/api/hubClient', () => ({
  createHubClient: () => hubClientMock,
}));

describe('TeamRunConsole target routing', () => {
  beforeEach(() => {
    startTeamRunMock.mockReset();
    refetchTeamsMock.mockReset();
    executionTargetsState.items = [];
    executionTargetsState.isLoading = false;
    executionTargetsState.isFetching = false;
    executionTargetsState.error = null;
    teamRunsState.runs = [];
    hubClientMock.getTeamRunState.mockReset();
    hubClientMock.listTeamTasks.mockReset();
    hubClientMock.listTeamEvents.mockReset();
    hubClientMock.getAgentTeam.mockReset();
    hubClientMock.getTeamRun.mockReset();
    hubClientMock.getTeamRunState.mockResolvedValue({ members: [], approvals: [], conflicts: [] });
    hubClientMock.listTeamTasks.mockResolvedValue([]);
    hubClientMock.listTeamEvents.mockResolvedValue([]);
    hubClientMock.getAgentTeam.mockResolvedValue({
      id: 'team-1',
      name: 'P0 Team',
      description: 'Remote control team',
      members: [],
    });
    hubClientMock.getTeamRun.mockResolvedValue({
      id: 'run-1',
      team_id: 'team-1',
      status: 'running',
      created_at: '2026-06-09T09:00:00Z',
    });
    startTeamRunMock.mockResolvedValue({ id: 'run-1', status: 'queued' });
  });

  it('starts TeamRun with the selected online local_edge target id', async () => {
    executionTargetsState.items = [{
      id: 'target-local-edge-1',
      target_type: 'local_edge',
      is_online: true,
      health_state: 'healthy',
    }];

    render(<TeamRunConsole />);

    fireEvent.click(screen.getByText('P0 Team'));
    fireEvent.click(screen.getByRole('button', { name: /Start TeamRun/i }));
    fireEvent.change(screen.getByLabelText('Desktop/Edge target'), {
      target: { value: 'target-local-edge-1' },
    });
    fireEvent.change(screen.getByPlaceholderText('What should the team do?...'), {
      target: { value: 'Run the remote control fixture' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));

    await waitFor(() => {
      expect(startTeamRunMock).toHaveBeenCalledWith({
        teamId: 'team-1',
        run: {
          trigger_message: 'Run the remote control fixture',
          target_id: 'target-local-edge-1',
        },
      });
    });
  });

  it('does not start TeamRun when no online local_edge target is available', () => {
    render(<TeamRunConsole />);

    fireEvent.click(screen.getByText('P0 Team'));
    fireEvent.click(screen.getByRole('button', { name: /Start TeamRun/i }));
    fireEvent.change(screen.getByPlaceholderText('What should the team do?...'), {
      target: { value: 'Run without target' },
    });

    expect(screen.getByText('No online local_edge execution target is available.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go' })).toBeDisabled();
    expect(startTeamRunMock).not.toHaveBeenCalled();
  });

  it('does not silently choose the first online local_edge target before user selection', () => {
    executionTargetsState.items = [
      {
        id: 'target-local-edge-alpha',
        name: 'Alpha Desktop',
        target_type: 'local_edge',
        is_online: true,
        health_state: 'healthy',
      },
      {
        id: 'target-local-edge-beta',
        name: 'Beta Desktop',
        target_type: 'local_edge',
        is_online: true,
        health_state: 'healthy',
      },
    ];

    render(<TeamRunConsole />);

    fireEvent.click(screen.getByText('P0 Team'));
    fireEvent.click(screen.getByRole('button', { name: /Start TeamRun/i }));
    fireEvent.change(screen.getByPlaceholderText('What should the team do?...'), {
      target: { value: 'Run without explicit target' },
    });

    expect(screen.getByText('Select a Desktop/Edge target before starting.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go' })).toBeDisabled();
    expect(startTeamRunMock).not.toHaveBeenCalled();
  });

  it('lets the user choose which online local_edge target receives the TeamRun', async () => {
    executionTargetsState.items = [
      {
        id: 'target-local-edge-alpha',
        name: 'Alpha Desktop',
        target_type: 'local_edge',
        is_online: true,
        health_state: 'healthy',
      },
      {
        id: 'target-local-edge-beta',
        name: 'Beta Desktop',
        target_type: 'local_edge',
        is_online: true,
        health_state: 'healthy',
      },
    ];

    render(<TeamRunConsole />);

    fireEvent.click(screen.getByText('P0 Team'));
    fireEvent.click(screen.getByRole('button', { name: /Start TeamRun/i }));
    fireEvent.change(screen.getByLabelText('Desktop/Edge target'), {
      target: { value: 'target-local-edge-beta' },
    });
    fireEvent.change(screen.getByPlaceholderText('What should the team do?...'), {
      target: { value: 'Run on beta desktop' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));

    await waitFor(() => {
      expect(startTeamRunMock).toHaveBeenCalledWith({
        teamId: 'team-1',
        run: {
          trigger_message: 'Run on beta desktop',
          target_id: 'target-local-edge-beta',
        },
      });
    });
  });

  it('keeps a selected target when the start form is closed and reopened', () => {
    executionTargetsState.items = [{
      id: 'target-local-edge-alpha',
      name: 'Alpha Desktop',
      target_type: 'local_edge',
      is_online: true,
      health_state: 'healthy',
    }];

    render(<TeamRunConsole />);

    fireEvent.click(screen.getByText('P0 Team'));
    fireEvent.click(screen.getByRole('button', { name: /Start TeamRun/i }));
    fireEvent.change(screen.getByLabelText('Desktop/Edge target'), {
      target: { value: 'target-local-edge-alpha' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: /Start TeamRun/i }));

    expect(screen.getByLabelText('Desktop/Edge target')).toHaveValue('target-local-edge-alpha');
    expect(screen.getByText('Target: Alpha Desktop')).toBeInTheDocument();
  });

  it('clears a selected target when Hub no longer reports it online', async () => {
    executionTargetsState.items = [
      {
        id: 'target-local-edge-alpha',
        name: 'Alpha Desktop',
        target_type: 'local_edge',
        is_online: true,
        health_state: 'healthy',
      },
      {
        id: 'target-local-edge-beta',
        name: 'Beta Desktop',
        target_type: 'local_edge',
        is_online: true,
        health_state: 'healthy',
      },
    ];
    const { rerender } = render(<TeamRunConsole />);

    fireEvent.click(screen.getByText('P0 Team'));
    fireEvent.click(screen.getByRole('button', { name: /Start TeamRun/i }));
    fireEvent.change(screen.getByLabelText('Desktop/Edge target'), {
      target: { value: 'target-local-edge-alpha' },
    });

    executionTargetsState.items = [{
      id: 'target-local-edge-beta',
      name: 'Beta Desktop',
      target_type: 'local_edge',
      is_online: true,
      health_state: 'healthy',
    }];
    rerender(<TeamRunConsole />);

    await waitFor(() => {
      expect(screen.getByLabelText('Desktop/Edge target')).toHaveValue('');
    });
    expect(screen.getByText('Select a Desktop/Edge target before starting.')).toBeInTheDocument();
  });

  it('shows a Hub dispatch error when the selected target run cannot start', async () => {
    executionTargetsState.items = [{
      id: 'target-local-edge-alpha',
      name: 'Alpha Desktop',
      target_type: 'local_edge',
      is_online: true,
      health_state: 'healthy',
    }];
    startTeamRunMock.mockRejectedValueOnce(new Error('Hub dispatch denied target access'));

    render(<TeamRunConsole />);

    fireEvent.click(screen.getByText('P0 Team'));
    fireEvent.click(screen.getByRole('button', { name: /Start TeamRun/i }));
    fireEvent.change(screen.getByLabelText('Desktop/Edge target'), {
      target: { value: 'target-local-edge-alpha' },
    });
    fireEvent.change(screen.getByPlaceholderText('What should the team do?...'), {
      target: { value: 'Run on alpha desktop' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));

    await waitFor(() => {
      expect(screen.getByText('Hub dispatch failed: Hub dispatch denied target access')).toBeInTheDocument();
    });
  });

  it('shows a Hub replay error when run state cannot be loaded', async () => {
    teamRunsState.runs = [{
      id: 'run-1',
      team_id: 'team-1',
      status: 'running',
      created_at: '2026-06-09T09:00:00Z',
    }];
    hubClientMock.getTeamRunState.mockRejectedValueOnce(new Error('Hub replay unavailable'));

    render(<TeamRunConsole />);

    fireEvent.click(screen.getByText('P0 Team'));
    fireEvent.click(screen.getByText('Running'));

    await waitFor(() => {
      expect(screen.getByText('Unable to load Hub run replay: Hub replay unavailable')).toBeInTheDocument();
    });
  });

  it('loads and renders replayed Hub events for a selected run in sequence order', async () => {
    teamRunsState.runs = [{
      id: 'run-1',
      team_id: 'team-1',
      status: 'running',
      created_at: '2026-06-09T09:00:00Z',
    }];
    hubClientMock.listTeamEvents.mockResolvedValueOnce([
      {
        id: 'event-2',
        team_run_id: 'run-1',
        seq: 2,
        type: 'agent.message',
        payload: JSON.stringify({ summary: 'Second replay event' }),
        created_at: '2026-06-09T09:00:02Z',
      },
      {
        id: 'event-1',
        team_run_id: 'run-1',
        seq: 1,
        type: 'team.run.started',
        payload: JSON.stringify({ reason: 'First replay event' }),
        created_at: '2026-06-09T09:00:01Z',
      },
    ]);

    render(<TeamRunConsole />);

    fireEvent.click(screen.getByText('P0 Team'));
    fireEvent.click(screen.getByText('Running'));
    fireEvent.click(screen.getByRole('button', { name: /events/i }));

    await waitFor(() => {
      expect(screen.getByText('First replay event')).toBeInTheDocument();
      expect(screen.getByText('Second replay event')).toBeInTheDocument();
    });
    const renderedText = document.body.textContent ?? '';
    expect(renderedText.indexOf('First replay event')).toBeLessThan(renderedText.indexOf('Second replay event'));
    expect(hubClientMock.listTeamEvents).toHaveBeenCalledWith('team-1', 'run-1');
  });
});
