import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TeamRunConsole from './TeamRunConsole';

const startTeamRunMock = vi.hoisted(() => vi.fn());
const refetchTeamsMock = vi.hoisted(() => vi.fn());
const executionTargetItems = vi.hoisted(() => [] as Array<{
  id: string;
  name?: string;
  target_type: string;
  is_online: boolean;
  health_state: string;
}>);

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
    data: { items: executionTargetItems, page: { hasMore: false } },
    isLoading: false,
    isFetching: false,
    error: null,
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
  useHubAgentTeams: () => ({
    data: {
      teams: [{ id: 'team-1', name: 'P0 Team', description: 'Remote control team' }],
      bundles: [{
        team: { id: 'team-1', name: 'P0 Team', description: 'Remote control team', members: [] },
        runs: [],
      }],
      selectedTeam: { id: 'team-1', name: 'P0 Team', description: 'Remote control team', members: [] },
      tasks: [],
      events: [],
    },
    isLoading: false,
    isFetching: false,
    refetch: refetchTeamsMock,
  }),
  useCreateAgentTeam: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useStartTeamRun: () => ({ mutateAsync: startTeamRunMock, isPending: false }),
  useDecideTeamApproval: () => ({ mutateAsync: vi.fn() }),
}));

describe('TeamRunConsole target routing', () => {
  beforeEach(() => {
    startTeamRunMock.mockReset();
    refetchTeamsMock.mockReset();
    executionTargetItems.splice(0, executionTargetItems.length);
    startTeamRunMock.mockResolvedValue({ id: 'run-1', status: 'queued' });
  });

  it('starts TeamRun with the selected online local_edge target id', async () => {
    executionTargetItems.push({
      id: 'target-local-edge-1',
      target_type: 'local_edge',
      is_online: true,
      health_state: 'healthy',
    });

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
    executionTargetItems.push(
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
    );

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
    executionTargetItems.push(
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
    );

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
});
