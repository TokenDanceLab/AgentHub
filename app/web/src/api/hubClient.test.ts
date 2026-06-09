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

  it('uses Web project group thread routes for @Agent message contracts', async () => {
    const a2aContent = {
      text: '@Reviewer please inspect this Project Group slice',
      metadata: {
        im_kind: 'project_group',
        mentions: [{ type: 'agent', id: 'agent-reviewer', display_name: 'Reviewer' }],
        orchestrator_queue: {
          status: 'queued',
          route: 'review',
          correlation_id: 'corr-project-agent-1',
        },
      },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/web/projects/project%2Fid/threads') && !init?.method) {
        return new Response(
          JSON.stringify({
            code: 'ok',
            data: [{
              id: 'thread-1',
              project_id: 'project/id',
              type: 'group',
              name: 'Project Group',
              owner_user_id: 'user-1',
              role: 'owner',
              member_count: 3,
              created_at: '2026-06-09T01:00:00Z',
            }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/web/projects/project%2Fid/threads') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            code: 'ok',
            data: {
              id: 'thread-2',
              project_id: 'project/id',
              type: 'group',
              name: 'Follow-up Group',
              member_count: 1,
              created_at: '2026-06-09T01:01:00Z',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/threads/thread%2Fid/messages?limit=80')) {
        return new Response(
          JSON.stringify({
            code: 'ok',
            data: [{
              id: 'message-1',
              project_id: 'project/id',
              thread_id: 'thread/id',
              seq_id: 1,
              client_msg_id: 'client-message-1',
              sender_type: 'user',
              sender_id: 'user-1',
              content_type: 'text',
              content: JSON.stringify(a2aContent),
              created_at: '2026-06-09T01:02:00Z',
            }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          code: 'ok',
          data: {
            id: 'message-2',
            project_id: 'project/id',
            thread_id: 'thread/id',
            seq_id: 2,
            client_msg_id: 'client-message-2',
            sender_type: 'user',
            sender_id: 'user-1',
            content_type: 'text',
            content: JSON.stringify(a2aContent),
            created_at: '2026-06-09T01:03:00Z',
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

    const threads = await client.listWorkspaceProjectThreads('project/id');
    const createdThread = await client.createWorkspaceProjectThread('project/id', { name: 'Follow-up Group' });
    const messages = await client.listWorkspaceProjectThreadMessages('project/id', 'thread/id', { limit: 80 });
    const sent = await client.sendWorkspaceProjectThreadMessage('project/id', 'thread/id', {
      client_msg_id: 'client-message-2',
      content_type: 'text',
      content: JSON.stringify(a2aContent),
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://hub.example.test/web/projects/project%2Fid/threads',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer hub-access' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://hub.example.test/web/projects/project%2Fid/threads',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Follow-up Group' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://hub.example.test/web/projects/project%2Fid/threads/thread%2Fid/messages?limit=80',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer hub-access' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'https://hub.example.test/web/projects/project%2Fid/threads/thread%2Fid/messages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          client_msg_id: 'client-message-2',
          content_type: 'text',
          content: JSON.stringify(a2aContent),
        }),
      }),
    );
    expect(threads[0]).toMatchObject({ id: 'thread-1', name: 'Project Group', member_count: 3 });
    expect(createdThread).toMatchObject({ id: 'thread-2', name: 'Follow-up Group' });
    expect(JSON.parse(messages[0]!.content)).toMatchObject({
      metadata: {
        im_kind: 'project_group',
        mentions: [{ id: 'agent-reviewer' }],
        orchestrator_queue: { status: 'queued' },
      },
    });
    expect(sent).toMatchObject({ id: 'message-2', thread_id: 'thread/id' });
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

  it('consumes Hub single-task approval and artifact contracts through Web-owned routes', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/web/agent-tasks/task%2F1/approvals') && !init?.method) {
        return new Response(
          JSON.stringify({
            code: 'ok',
            data: {
              task_id: 'task/1',
              edge_run_id: 'edge-run-1',
              session_id: 'hub-session-1',
              approvals: [{
                approval_id: 'approval-1',
                task_id: 'task/1',
                edge_run_id: 'edge-run-1',
                session_id: 'hub-session-1',
                source_event_id: 'evt-approval-1',
                event_seq: 7,
                request_id: 'perm-1',
                tool_name: 'Write',
                status: 'pending',
                reason: 'Modify workspace file',
                created_at: '2026-06-09T01:00:00Z',
              }],
              pending: [],
              decided: [],
              last_event_seq: 7,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/web/agent-tasks/task%2F1/artifacts') && !init?.method) {
        return new Response(
          JSON.stringify({
            code: 'ok',
            data: {
              task_id: 'task/1',
              edge_run_id: 'edge-run-1',
              session_id: 'hub-session-1',
              artifacts: [{
                task_id: 'task/1',
                edge_run_id: 'edge-run-1',
                session_id: 'hub-session-1',
                source_event_id: 'evt-artifact-1',
                event_seq: 8,
                artifact_id: 'artifact-1',
                name: 'report.md',
                path: 'reports/report.md',
                action: 'created',
                tool_name: 'Write',
                mime_type: 'text/markdown',
                size_bytes: 128,
                diff: '@@ -1 +1 @@\n-old\n+new\n',
                edit_id: 'edit-1',
                review_status: 'needs_review',
                can_apply: false,
                can_revert: true,
                created_at: '2026-06-09T01:00:01Z',
              }],
              last_event_seq: 8,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          code: 'ok',
          data: {
            approval_id: 'approval-1',
            task_id: 'task/1',
            edge_run_id: 'edge-run-1',
            session_id: 'hub-session-1',
            status: 'approved',
            decided_at: '2026-06-09T01:00:02Z',
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

    const approvals = await client.listTaskApprovals('task/1');
    const artifacts = await client.listTaskArtifacts('task/1');
    const decision = await client.decideTaskApproval('task/1', 'approval/1', { decision: 'allow' });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://hub.example.test/web/agent-tasks/task%2F1/approvals',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer hub-access' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://hub.example.test/web/agent-tasks/task%2F1/artifacts',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer hub-access' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://hub.example.test/web/agent-tasks/task%2F1/approvals/approval%2F1/decide',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ decision: 'allow' }),
      }),
    );
    expect(approvals.approvals[0]).toMatchObject({ approval_id: 'approval-1', status: 'pending' });
    expect(artifacts.artifacts[0]).toMatchObject({
      artifact_id: 'artifact-1',
      path: 'reports/report.md',
      diff: '@@ -1 +1 @@\n-old\n+new\n',
      edit_id: 'edit-1',
      review_status: 'needs_review',
      can_apply: false,
      can_revert: true,
    });
    expect(decision).toMatchObject({ approval_id: 'approval-1', status: 'approved' });
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
