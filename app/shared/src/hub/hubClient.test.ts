import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HUB_EVENTS } from '../hubEvents';
import { AppError } from '../errors';
import {
  createHubClient,
  HUBCLIENT_SSOT_GAPS,
  HubError,
  parseHubError,
  unwrapHubResponse,
  type AuthResponse,
  type HubAgentDoneFrame,
  type HubAgentFailedFrame,
  type HubAgentStreamFrame,
  type HubCustomAgentRequest,
  type HubDeviceKickedFrame,
  type HubDeviceOnlineFrame,
  type HubFriendAcceptedFrame,
  type HubFriendRequestFrame,
  type HubNotificationNewFrame,
  type HubSession,
  type Session,
} from './hubClient';

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('hubClient helpers', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('unwraps Hub response envelopes and keeps raw bodies compatible', () => {
    expect(unwrapHubResponse<{ id: string }>({ code: 'OK', data: { id: '1' } })).toEqual({
      id: '1',
    });
    expect(unwrapHubResponse<{ id: string }>({ code: 'ok', data: { id: '2' } })).toEqual({
      id: '2',
    });
    expect(unwrapHubResponse<{ id: string }>({ code: 'Ok', data: { id: '3' } })).toEqual({
      id: '3',
    });
    expect(unwrapHubResponse<{ id: string }>({ id: 'raw' })).toEqual({ id: 'raw' });

    const sessionWithSessionId: HubSession = { session_id: 's1', type: 'private' };
    const sessionWithLegacyId: HubSession = { id: 's2', type: 'group' };
    expect(sessionWithSessionId.session_id).toBe('s1');
    expect(sessionWithLegacyId.id).toBe('s2');
  });

  it('turns Hub envelope errors into AppError', async () => {
    expect(() =>
      unwrapHubResponse({ code: 'SESSION_NOT_MEMBER', message: 'not a member' }, 403),
    ).toThrow(AppError);

    const error = await parseHubError(
      jsonResponse({ code: 'AGENT_TASK_NOT_FOUND', message: 'missing task' }, { status: 404 }),
    );

    expect(error).toMatchObject({
      code: 'AGENT_TASK_NOT_FOUND',
      message: 'missing task',
      status: 404,
    });

    expect(() =>
      unwrapHubResponse({ code: 'HUB_ENVELOPE_ERROR', message: 'bad envelope' }, 200),
    ).toThrow(AppError);
  });

  it('requests IM contact/session/message endpoints with the Hub envelope', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 'OK', data: [{ user_id: 'u1', username: 'x', nickname: 'X', online: true, type: 'user' }] }))
      .mockResolvedValueOnce(jsonResponse({ code: 'OK', data: [{ session_id: 's1', type: 'private', unread_count: 0 }, { id: 's2', type: 'group', unread_count: 1 }] }))
      .mockResolvedValueOnce(jsonResponse({ code: 'OK', data: [{ id: 'm1', session_id: 's1', seq_id: 1, sender_type: 'user', sender_id: 'u1', content_type: 'text', content: '{"text":"hi"}' }] }));

    const client = createHubClient({
      baseUrl: 'http://hub.local/',
      getToken: () => 'token-1',
    });

    await expect(client.listContacts()).resolves.toHaveLength(1);
    await expect(client.listSessions()).resolves.toEqual([
      { session_id: 's1', type: 'private', unread_count: 0 },
      { id: 's2', type: 'group', unread_count: 1 },
    ]);
    await expect(client.getMessages('s1', { limit: 20 })).resolves.toHaveLength(1);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://hub.local/client/contacts');
    expect((init?.headers as Headers).get('Authorization')).toBe('Bearer token-1');
  });

  it('requests custom agent, device, and task callback paths', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 'OK', data: [{ id: 'a1', owner_user_id: 'u1', name: 'Agent', agent_type: 'codex', system_prompt: 'go', created_at: 'now', updated_at: 'now' }] }))
      .mockResolvedValueOnce(jsonResponse({ code: 'OK', data: { id: 'dev1', user_id: 'u1', device_type: 'desktop', capabilities: '["run"]' } }))
      .mockResolvedValueOnce(jsonResponse({ code: 'OK' }))
      .mockResolvedValueOnce(jsonResponse({ code: 'OK' }))
      .mockResolvedValueOnce(jsonResponse({ code: 'OK' }))
      .mockResolvedValueOnce(jsonResponse({ code: 'OK' }))
      .mockResolvedValueOnce(jsonResponse({ code: 'OK', data: { id: 't1', agent_instance_id: 'ai1', triggered_by_user_id: 'u1', trigger_message_id: 'm1', status: 'queued', created_at: 'now', expire_at: 'later' } }));

    const client = createHubClient({ baseUrl: 'http://hub.local' });
    const customAgent: HubCustomAgentRequest = {
      name: 'Agent',
      agent_type: 'codex',
      system_prompt: 'go',
    };

    await expect(client.listCustomAgents()).resolves.toHaveLength(1);
    await expect(client.registerDevice({ device_id: 'dev1', capabilities: ['run'] })).resolves.toMatchObject({ id: 'dev1' });
    await expect(client.ackTask('task-1', 'run-1')).resolves.toBeUndefined();
    await expect(client.streamTask('task-1', 'delta', 'run-1')).resolves.toBeUndefined();
    await expect(client.doneTask('task-1', 'final', 'run-1')).resolves.toBeUndefined();
    await expect(client.failTask('task-1', 'boom', 'run-1')).resolves.toBeUndefined();
    await expect(client.triggerAgentTask('m1', { target_id: 'target-1' })).resolves.toMatchObject({ id: 't1' });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://hub.local/web/custom-agents');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://hub.local/edge/devices:register');
    expect(fetchMock.mock.calls[2]?.[0]).toBe('http://hub.local/edge/agent-tasks/task-1/ack');
    expect(fetchMock.mock.calls[3]?.[0]).toBe('http://hub.local/edge/agent-tasks/task-1/stream');
    expect(fetchMock.mock.calls[4]?.[0]).toBe('http://hub.local/edge/agent-tasks/task-1/done');
    expect(fetchMock.mock.calls[5]?.[0]).toBe('http://hub.local/edge/agent-tasks/task-1/fail');
    expect(fetchMock.mock.calls[6]?.[0]).toBe('http://hub.local/web/agent-tasks');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      device_id: 'dev1',
      device_name: 'dev1',
      device_type: 'desktop',
      capabilities: { run: true },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({ run_id: 'run-1' });
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({
      content: 'delta',
      run_id: 'run-1',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body))).toEqual({
      final_content: 'final',
      run_id: 'run-1',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[5]?.[1]?.body))).toEqual({
      error: 'boom',
      run_id: 'run-1',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[6]?.[1]?.body))).toEqual({
      trigger_message_id: 'm1',
      target_id: 'target-1',
    });
    expect(customAgent.agent_type).toBe('codex');
  });

  it('requests notification endpoints', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        code: 'OK',
        data: [{
          id: 'n1',
          user_id: 'u1',
          type: 'mention',
          payload: '{"title":"Mention"}',
          read: false,
          created_at: '2026-05-25T01:06:00Z',
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({ code: 'OK' }))
      .mockResolvedValueOnce(jsonResponse({ code: 'OK' }));

    const client = createHubClient({ baseUrl: 'http://hub.local' });

    await expect(client.listNotifications({ unread_only: true, limit: 10 })).resolves.toEqual([
      {
        id: 'n1',
        user_id: 'u1',
        type: 'mention',
        payload: '{"title":"Mention"}',
        read: false,
        created_at: '2026-05-25T01:06:00Z',
      },
    ]);
    await expect(client.markNotificationRead('n1')).resolves.toBeUndefined();
    await expect(client.readAllNotifications()).resolves.toBeUndefined();

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://hub.local/client/notifications?unread_only=true&limit=10',
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'http://hub.local/client/notifications/n1:read',
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      'http://hub.local/client/notifications:read-all',
    );
  });

  it('falls back to dev/trump legacy Hub paths when master routes are absent', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 'NOT_FOUND', message: 'missing' }, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ code: 'OK' }))
      .mockResolvedValueOnce(jsonResponse({ code: 'NOT_FOUND', message: 'missing' }, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ code: 'OK' }))
      .mockResolvedValueOnce(jsonResponse({ code: 'NOT_FOUND', message: 'missing' }, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ code: 'OK', data: { id: 'dev1', user_id: 'u1', device_type: 'desktop' } }))
      .mockResolvedValueOnce(jsonResponse({ code: 'NOT_FOUND', message: 'missing' }, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ code: 'OK' }));

    const client = createHubClient({ baseUrl: 'http://hub.local' });

    await expect(client.markNotificationRead('n1')).resolves.toBeUndefined();
    await expect(client.readAllNotifications()).resolves.toBeUndefined();
    await expect(client.registerDevice({ device_id: 'dev1' })).resolves.toMatchObject({ id: 'dev1' });
    await expect(client.cancelAgentTask('task-1')).resolves.toBeUndefined();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://hub.local/client/notifications/n1:read',
      'http://hub.local/client/notifications/n1/read',
      'http://hub.local/client/notifications:read-all',
      'http://hub.local/client/notifications/read-all',
      'http://hub.local/edge/devices:register',
      'http://hub.local/edge/devices/register',
      'http://hub.local/web/agent-tasks/task-1:cancel',
      'http://hub.local/web/agent-tasks/task-1/cancel',
    ]);
  });

  it('exposes master web management and OIDC contract endpoints without wiring the callback flow', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 'OK', data: { state: 's1', authorization_url: 'https://id.local/auth' } }))
      .mockResolvedValueOnce(jsonResponse({ code: 'OK', data: { items: [{ id: 'target-1', name: 'Local Edge', type: 'local_edge' }], page: { hasMore: false } } }))
      .mockResolvedValueOnce(jsonResponse({ code: 'OK', data: { items: [{ id: 'audit-1', action: 'target.ping' }], page: { hasMore: false } } }))
      .mockResolvedValueOnce(jsonResponse({ code: 'OK', data: { id: 'relay-1', target_id: 'target-1', status: 'queued' } }))
      .mockResolvedValueOnce(jsonResponse({ code: 'OK' }));

    const client = createHubClient({ baseUrl: 'http://hub.local' });

    await expect(client.oidcAuthorize({ code_challenge: 'challenge' })).resolves.toEqual({
      state: 's1',
      authorization_url: 'https://id.local/auth',
    });
    await expect(client.listExecutionTargets()).resolves.toMatchObject({
      items: [{ id: 'target-1' }],
    });
    await expect(client.listAuditEvents({ pageSize: 5 })).resolves.toMatchObject({
      items: [{ id: 'audit-1' }],
    });
    await expect(client.createRelayCommand({ target_id: 'target-1', payload: { op: 'ping' } })).resolves.toMatchObject({ id: 'relay-1' });
    await expect(client.ackRelayCommand('relay-1', 'device-1')).resolves.toBeUndefined();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://hub.local/client/auth/oidc/authorize',
      'http://hub.local/web/execution-targets',
      'http://hub.local/web/audit-events?pageSize=5',
      'http://hub.local/web/relay/commands',
      'http://hub.local/web/relay/commands/relay-1/device-ack',
    ]);
  });

  it('types Hub WS frames used by notifications, social, device, and task bridge events', () => {
    const deviceOnline: HubDeviceOnlineFrame = {
      type: HUB_EVENTS.DEVICE_ONLINE,
      payload: {
        user_id: 'u1',
      },
    };
    const deviceKicked: HubDeviceKickedFrame = {
      type: HUB_EVENTS.DEVICE_KICKED,
      payload: { device_id: '018f86aa-2f93-7cc0-9c39-000000000001', reason: 'replaced' },
    };
    const agentStream: HubAgentStreamFrame = {
      type: HUB_EVENTS.AGENT_STREAM,
      payload: { task_id: 'task-1', content: 'delta', run_id: 'run-1' },
    };
    const agentDone: HubAgentDoneFrame = {
      type: HUB_EVENTS.AGENT_DONE,
      payload: { task_id: 'task-1', final_content: 'final', edge_run_id: 'run-1' },
    };
    const agentFailed: HubAgentFailedFrame = {
      type: HUB_EVENTS.AGENT_FAILED,
      payload: { task_id: 'task-2', error_message: 'boom', run_id: 'run-2' },
    };
    const notification: HubNotificationNewFrame = {
      type: HUB_EVENTS.NOTIFICATION_NEW,
      payload: {
        id: '018f86aa-2f93-7cc0-9c39-000000000002',
        user_id: '018f86aa-2f93-7cc0-9c39-000000000003',
        type: 'friend_request',
        payload: '{"request_id":"fr1"}',
        read: false,
        created_at: '2026-05-25T01:06:00Z',
      },
    };
    const friendRequest: HubFriendRequestFrame = {
      type: HUB_EVENTS.FRIEND_REQUEST,
      payload: { request_id: 'fr1', user_id: 'u2', nickname: 'Friend' },
    };
    const friendAccepted: HubFriendAcceptedFrame = {
      type: HUB_EVENTS.FRIEND_ACCEPTED,
      payload: { user_id: 'u2', friend_id: 'u1' },
    };

    expect([
      deviceOnline.type,
      deviceKicked.type,
      agentStream.type,
      agentDone.type,
      agentFailed.type,
      notification.type,
      friendRequest.type,
      friendAccepted.type,
    ]).toEqual([
      'device.online',
      'device.kicked',
      'agent.stream',
      'agent.done',
      'agent.failed',
      'notification.new',
      'friend.request',
      'friend.accepted',
    ]);
    expect(agentStream.payload?.run_id).toBe('run-1');
    expect(notification.payload?.read).toBe(false);
  });

  it('keeps the legacy HubError shape for Desktop compatibility', () => {
    const error = new HubError(401, 'Unauthorized', 'auth_failed');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('HubError');
    expect(error.status).toBe(401);
    expect(error.code).toBe('auth_failed');
    expect(error.message).toBe('Unauthorized');
  });

  it('exposes T3.4 shared task approval methods (#433)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'OK', data: { task_id: 't1', approvals: [] } }));
    const client = createHubClient({ baseUrl: 'http://hub.local' });
    await expect(client.listTaskApprovals('t1')).resolves.toMatchObject({ task_id: 't1', approvals: [] });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://hub.local/web/agent-tasks/t1/approvals');
  });

  it('exposes T3.2 shared team/settings methods (#431)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'OK', data: [{ id: 'team-1', name: 'T' }] }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'OK', data: { theme: 'dark' } }));
    const client = createHubClient({ baseUrl: 'http://hub.local' });
    await expect(client.listAgentTeams()).resolves.toEqual([{ id: 'team-1', name: 'T' }]);
    await expect(client.fetchSettings()).resolves.toEqual({ theme: 'dark' });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://hub.local/web/agent-teams',
      'http://hub.local/client/settings',
    ]);
  });

  it('exports compatibility aliases and SSOT gap inventory for slice1 (#430)', () => {
    // Type-level aliases must remain assignable (compile-time); runtime checks inventory shape.
    const session: Session = { session_id: 's-alias', type: 'private' };
    const hubSession: HubSession = session;
    expect(hubSession.session_id).toBe('s-alias');

    const auth: AuthResponse = {
      access_token: 'a',
      refresh_token: 'r',
      expires_in: 3600,
    };
    expect(auth.access_token).toBe('a');

    expect(HUBCLIENT_SSOT_GAPS.desktopAndWebNotShared).not.toContain('listAgentTeams');
    expect(HUBCLIENT_SSOT_GAPS.desktopAndWebNotShared).not.toContain('fetchSettings');
    expect(Array.isArray(HUBCLIENT_SSOT_GAPS.desktopOnly)).toBe(true);
    expect(Array.isArray(HUBCLIENT_SSOT_GAPS.webOnly)).toBe(true);
    // Guard against accidental empty inventory during later edits.
    expect(Array.isArray(HUBCLIENT_SSOT_GAPS.desktopAndWebNotShared)).toBe(true);
  });

  it('throws 401 immediately when no onRefreshToken is configured (current behavior)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 'auth_failed', message: 'Unauthorized' }, { status: 401 }),
    );
    const client = createHubClient({
      baseUrl: 'http://hub.local',
      getToken: () => 'expired-token',
    });

    await expect(client.me()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes the token and retries once on 401 when onRefreshToken is provided', async () => {
    const user = { id: 'u1', username: 'x', nickname: 'X' };
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ code: 'auth_failed', message: 'Unauthorized' }, { status: 401 }),
      )
      .mockResolvedValueOnce(jsonResponse({ code: 'OK', data: user }));
    const onRefreshToken = vi.fn(async () => 'fresh-token');
    const client = createHubClient({
      baseUrl: 'http://hub.local',
      getToken: () => 'stale-token',
      onRefreshToken,
    });

    const result = await client.me();

    expect(result).toMatchObject({ id: 'u1' });
    expect(onRefreshToken).toHaveBeenCalledTimes(1);
    // The retry must carry the refreshed bearer token.
    const retryInit = fetchMock.mock.calls[1]?.[1];
    expect((retryInit?.headers as Headers).get('Authorization')).toBe(
      'Bearer fresh-token',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry when onRefreshToken returns null', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 'auth_failed', message: 'Unauthorized' }, { status: 401 }),
    );
    const onRefreshToken = vi.fn(async () => null);
    const client = createHubClient({
      baseUrl: 'http://hub.local',
      getToken: () => 'expired-token',
      onRefreshToken,
    });

    await expect(client.me()).rejects.toMatchObject({ status: 401 });
    expect(onRefreshToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
