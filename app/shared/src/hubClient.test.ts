import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from './errors';
import {
  createHubClient,
  HubError,
  parseHubError,
  unwrapHubResponse,
  type HubCustomAgentRequest,
  type HubSession,
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
    await expect(client.triggerAgentTask('m1')).resolves.toMatchObject({ id: 't1' });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://hub.local/web/custom-agents');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://hub.local/edge/devices/register');
    expect(fetchMock.mock.calls[2]?.[0]).toBe('http://hub.local/edge/agent-tasks/task-1/ack');
    expect(fetchMock.mock.calls[3]?.[0]).toBe('http://hub.local/edge/agent-tasks/task-1/stream');
    expect(fetchMock.mock.calls[4]?.[0]).toBe('http://hub.local/edge/agent-tasks/task-1/done');
    expect(fetchMock.mock.calls[5]?.[0]).toBe('http://hub.local/edge/agent-tasks/task-1/fail');
    expect(fetchMock.mock.calls[6]?.[0]).toBe('http://hub.local/web/agent-tasks');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      device_id: 'dev1',
      capabilities: ['run'],
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
      'http://hub.local/client/notifications/n1/read',
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      'http://hub.local/client/notifications/read-all',
    );
  });

  it('keeps the legacy HubError shape for Desktop compatibility', () => {
    const error = new HubError(401, 'Unauthorized', 'auth_failed');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('HubError');
    expect(error.status).toBe(401);
    expect(error.code).toBe('auth_failed');
    expect(error.message).toBe('Unauthorized');
  });
});
