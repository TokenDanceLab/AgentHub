import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@shared/errors';
import { createHubClient } from './hubClient';

describe('createHubClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('posts refresh_token on refresh', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({
        code: 'ok',
        data: {
          access_token: 'hub-access',
          refresh_token: 'hub-refresh',
          expires_in: 3600,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const client = createHubClient({ baseUrl: 'https://hub.example.test' });
    const res = await client.refresh('old-refresh-token');

    expect(res).toEqual({
      access_token: 'hub-access',
      refresh_token: 'hub-refresh',
      expires_in: 3600,
    });
  });

  it('keeps legacy bare JSON compatibility', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({
        id: '00000000-0000-0000-0000-00000000b101',
        username: 'alice',
        nickname: 'Alice',
        avatar_url: '',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));

    const client = createHubClient({ baseUrl: 'https://hub.example.test' });
    await expect(client.me()).resolves.toMatchObject({ username: 'alice' });
  });

  it('converts Hub error envelopes into AppError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ code: 'unauthorized', message: 'bad token' }),
      { status: 401, statusText: 'Unauthorized', headers: { 'Content-Type': 'application/json' } },
    )));

    const client = createHubClient({ baseUrl: 'https://hub.example.test' });

    await expect(client.me()).rejects.toMatchObject({
      code: 'unauthorized',
      message: 'bad token',
      status: 401,
    });
    await expect(client.me()).rejects.toBeInstanceOf(AppError);
  });

  it('lists Hub execution targets with typed query params', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({
        code: 'ok',
        data: {
          items: [
            {
              id: '00000000-0000-0000-0000-00000000e101',
              owner_id: '00000000-0000-0000-0000-00000000u101',
              name: 'Workstation',
              target_type: 'local_edge',
              workspace_allowlist: '["D:\\\\Code"]',
              trust_level: 'local',
              health_state: 'healthy',
              is_online: true,
            },
          ],
          page: { hasMore: false },
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const client = createHubClient({
      baseUrl: 'https://hub.example.test',
      getToken: () => 'hub-access',
    });
    const res = await client.listExecutionTargets({
      target_type: 'local_edge',
      pageCursor: 'cursor-1',
      pageSize: 20,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://hub.example.test/web/execution-targets?target_type=local_edge&pageCursor=cursor-1&pageSize=20',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer hub-access' }),
      }),
    );
    expect(res.items[0]).toMatchObject({
      name: 'Workstation',
      target_type: 'local_edge',
      health_state: 'healthy',
      is_online: true,
    });
  });

  it('pings a Hub execution target through the owner-scoped Hub route', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ code: 'ok', data: null }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const client = createHubClient({
      baseUrl: 'https://hub.example.test',
      getToken: () => 'hub-access',
    });
    await client.pingExecutionTarget('target/id');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://hub.example.test/web/execution-targets/target%2Fid/ping',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer hub-access' }),
      }),
    );
  });

  it('lists, creates, gets, and updates Hub workspace projects through the Web-owned route', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/web/projects?')) {
        return new Response(
          JSON.stringify({
            code: 'ok',
            data: {
              items: [
                {
                  id: '00000000-0000-0000-0000-00000000p101',
                  name: 'AgentHub Demo',
                  description: 'Competition workspace',
                  owner_id: '00000000-0000-0000-0000-00000000u101',
                  created_at: '2026-06-08T00:00:00Z',
                  updated_at: '2026-06-08T00:30:00Z',
                },
              ],
              page: { hasMore: false },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (String(input).endsWith('/web/projects') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            code: 'ok',
            data: {
              id: '00000000-0000-0000-0000-00000000p102',
              name: 'New Project',
              description: 'Created from Web',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (String(input).endsWith('/web/projects/project%2Fid') && !init?.method) {
        return new Response(
          JSON.stringify({
            code: 'ok',
            data: {
              id: '00000000-0000-0000-0000-00000000p101',
              name: 'AgentHub Demo',
              description: 'Loaded from detail',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          code: 'ok',
          data: {
            id: '00000000-0000-0000-0000-00000000p101',
            name: 'AgentHub Demo',
            description: '',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createHubClient({
      baseUrl: 'https://hub.example.test',
      getToken: () => 'hub-access',
    });

    const list = await client.listWorkspaceProjects({ q: 'AgentHub', pageCursor: 'cursor-1', pageSize: 20 });
    const created = await client.createWorkspaceProject({ name: 'New Project', description: 'Created from Web' });
    const detail = await client.getWorkspaceProject('project/id');
    const updated = await client.updateWorkspaceProject('project/id', { description: '' });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://hub.example.test/web/projects?q=AgentHub&pageCursor=cursor-1&pageSize=20',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer hub-access' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://hub.example.test/web/projects',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'New Project', description: 'Created from Web' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://hub.example.test/web/projects/project%2Fid',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer hub-access' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'https://hub.example.test/web/projects/project%2Fid',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ description: '' }),
      }),
    );
    expect(list.items[0]).toMatchObject({ name: 'AgentHub Demo', description: 'Competition workspace' });
    expect(created).toMatchObject({ name: 'New Project', description: 'Created from Web' });
    expect(detail).toMatchObject({ name: 'AgentHub Demo', description: 'Loaded from detail' });
    expect(updated).toMatchObject({ name: 'AgentHub Demo', description: '' });
  });

  it('passes target_id when triggering a Hub agent task', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({
        code: 'ok',
        data: {
          id: 'task-1',
          agent_instance_id: 'agent-1',
          triggered_by_user_id: 'user-1',
          trigger_message_id: 'msg-1',
          target_id: 'target-1',
          status: 'queued',
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const client = createHubClient({
      baseUrl: 'https://hub.example.test',
      getToken: () => 'hub-access',
    });
    const res = await client.triggerAgentTask('msg-1', { target_id: 'target-1' });

    expect(res.target_id).toBe('target-1');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hub.example.test/web/agent-tasks',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ trigger_message_id: 'msg-1', target_id: 'target-1' }),
      }),
    );
  });

  it('passes target_id when starting a Hub TeamRun', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({
        code: 'ok',
        data: {
          id: 'run-1',
          team_id: 'team-1',
          status: 'queued',
          target_id: 'target-local-edge-1',
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const client = createHubClient({
      baseUrl: 'https://hub.example.test',
      getToken: () => 'hub-access',
    });
    const res = await client.startTeamRun('team/1', {
      trigger_message: 'Run remote control fixture',
      target_id: 'target-local-edge-1',
    });

    expect(res.target_id).toBe('target-local-edge-1');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hub.example.test/web/agent-teams/team%2F1/runs',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          trigger_message: 'Run remote control fixture',
          target_id: 'target-local-edge-1',
        }),
      }),
    );
  });

  it('returns the created Hub agent instance when adding an agent to a session', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({
        code: 'ok',
        data: {
          id: 'agent-instance-1',
          agent_type: 'claude-code',
          session_id: 'session-1',
          inviter_user_id: 'user-1',
          display_name: 'Hub Builder',
          created_at: '2026-06-07T00:00:00Z',
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const client = createHubClient({
      baseUrl: 'https://hub.example.test',
      getToken: () => 'hub-access',
    });
    const res = await client.addAgentToSession('session/1', {
      agent_type: 'claude-code',
      display_name: 'Hub Builder',
    });

    expect(res).toMatchObject({
      id: 'agent-instance-1',
      agent_type: 'claude-code',
      session_id: 'session-1',
      display_name: 'Hub Builder',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hub.example.test/client/sessions/session%2F1/agents',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ agent_type: 'claude-code', display_name: 'Hub Builder' }),
      }),
    );
  });
});
