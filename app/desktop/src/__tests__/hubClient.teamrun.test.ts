import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHubClient } from '@/api/hubClient';

function jsonResponse(status: number, body: unknown, statusText = status === 200 ? 'OK' : 'Error') {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

function getHeader(init: RequestInit, name: string): string | null {
  const headers = init.headers;
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  return (headers as Record<string, string> | undefined)?.[name] ?? null;
}

describe('hubClient TeamRun APIs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('unwraps Hub envelopes for agent teams', async () => {
    const client = createHubClient({
      baseUrl: 'http://test.local',
      getToken: () => 'hub-token',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(200, {
        code: 'OK',
        data: {
          items: [{ id: 'team-1', name: 'Agent Profile team', description: 'Frontend slice' }],
          total: 1,
        },
      }),
    );

    const teams = await client.listAgentTeams();

    expect(teams).toEqual({
      items: [{ id: 'team-1', name: 'Agent Profile team', description: 'Frontend slice' }],
      total: 1,
    });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/web/agent-teams');
    expect(getHeader(init, 'Authorization')).toBe('Bearer hub-token');
  });

  it('fetches TeamRunState by team and run id', async () => {
    const client = createHubClient({ baseUrl: 'http://test.local', getToken: () => 'hub-token' });
    const state = {
      run_id: 'run-1',
      team_id: 'team-1',
      status: 'running',
      members: [{ member_id: 'member-1', role: 'supervisor', active_tasks: 1, completed_tasks: 0 }],
      tasks: [{ task_id: 'task-1', objective: 'Read state', status: 'running' }],
      approvals: [{ approval_id: 'approval-1', status: 'pending', tool_name: 'shell' }],
      artifacts: [],
      conflicts: [],
      run_events: [],
      route_log: [],
      dependencies: [],
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(200, {
        code: 'OK',
        data: state,
      }),
    );

    await expect(client.getTeamRunState('team-1', 'run-1')).resolves.toEqual(state);
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/web/agent-teams/team-1/runs/run-1/state');
  });

  it('surfaces unauthorized TeamRun errors with Hub error details', async () => {
    const client = createHubClient({ baseUrl: 'http://test.local', getToken: () => 'expired-token' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(
        401,
        { error: { code: 'unauthorized', message: 'Hub login required' } },
        'Unauthorized',
      ),
    );

    await expect(client.getTeamRunState('team-1', 'run-1')).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
      message: 'Hub login required',
    });
  });
});
