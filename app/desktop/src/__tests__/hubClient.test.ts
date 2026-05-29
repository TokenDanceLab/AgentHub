import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHubClient, HubError } from '../api/hubClient';
import type { AuthResponse, UserProfile } from '../api/hubClient';
import { createHubAuth } from '../api/hubAuth';
import {
  clearStoredHubAccessToken,
  clearStoredHubRefreshToken,
  saveStoredHubAccessToken,
  saveStoredHubRefreshToken,
} from '../api/hubTokenStorage';

const mockUser: UserProfile = {
  id: 'user_1',
  username: 'testuser',
  nickname: 'Test User',
  avatar_url: '',
};

const mockAuthResponse: AuthResponse = {
  access_token: 'jwt_access_123',
  refresh_token: 'jwt_refresh_456',
  expires_in: 900,
};

// ── Helpers ──────────────────────────────────────

function mockFetch(status: number, data: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(JSON.stringify(data), {
      status,
      statusText: status === 401 ? 'Unauthorized' : status === 200 ? 'OK' : 'Error',
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function mockFetchSequence(responses: Array<{ status: number; data: unknown }>) {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  for (const r of responses) {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(r.data), {
        status: r.status,
        statusText: r.status === 200 ? 'OK' : 'Error',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }
  return fetchSpy;
}

// ── Tests ────────────────────────────────────────

describe('hubClient', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    await clearStoredHubAccessToken();
    await clearStoredHubRefreshToken();
  });

  describe('createHubClient (unauthenticated)', () => {
    const client = createHubClient({ baseUrl: 'http://test.local' });

    it('refresh POSTs refresh_token', async () => {
      const fetchSpy = mockFetch(200, mockAuthResponse);

      const res = await client.refresh('old_refresh');
      expect(res.access_token).toBe('jwt_access_123');

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://test.local/client/auth/refresh');
      const body = JSON.parse(init.body as string);
      expect(body.refresh_token).toBe('old_refresh');
    });
  });

  describe('createHubClient (authenticated)', () => {
    it('includes Bearer header when getToken returns token', async () => {
      const client = createHubClient({
        baseUrl: 'http://test.local',
        getToken: () => 'my_jwt_token',
      });

      const fetchSpy = mockFetch(200, mockUser);
      await client.me();

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer my_jwt_token');
    });

    it('omits Authorization header when getToken returns null', async () => {
      const client = createHubClient({
        baseUrl: 'http://test.local',
        getToken: () => null,
      });

      const fetchSpy = mockFetch(200, mockUser);
      await client.me();

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    });

    it('me() fetches user profile', async () => {
      const client = createHubClient({
        baseUrl: 'http://test.local',
        getToken: () => 'tok',
      });

      const fetchSpy = mockFetch(200, mockUser);
      const user = await client.me();

      expect(user.id).toBe('user_1');
      expect(user.username).toBe('testuser');
      const [url] = fetchSpy.mock.calls[0] as [string];
      expect(url).toBe('http://test.local/client/auth/me');
    });
  });

  describe('contacts and sessions', () => {
    const client = createHubClient({ baseUrl: 'http://test.local', getToken: () => 'tok' });

    it('listContacts sends GET', async () => {
      const contacts = [{ id: 'c1', user_id: 'u1', friend_id: 'u2', status: 'accepted' }];
      const fetchSpy = mockFetch(200, contacts);
      const res = await client.listContacts();
      expect(res).toEqual(contacts);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://test.local/client/contacts');
      expect(init.method).toBeUndefined(); // GET by default
    });

    it('sendFriendRequest POSTs correctly', async () => {
      const fetchSpy = mockFetch(200, {});
      await client.sendFriendRequest('user_b', 'Hello!');
      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.friend_id).toBe('user_b');
      expect(body.message).toBe('Hello!');
    });

    it('listSessions returns sessions', async () => {
      const sessions = [{ id: 's1', type: 'private', name: 'DM', owner_user_id: 'u1' }];
      mockFetch(200, sessions);
      const res = await client.listSessions();
      expect(res[0].id).toBe('s1');
    });

    it('createPrivateSession POSTs target_user_id', async () => {
      const fetchSpy = mockFetch(200, { id: 's_new', type: 'private', owner_user_id: 'u1' });
      const res = await client.createPrivateSession({ target_user_id: 'user_b' });
      expect(res.id).toBe('s_new');
      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.target_user_id).toBe('user_b');
    });

    it('registerDevice POSTs device info', async () => {
      const device = { id: 'dev_1', user_id: 'u1', device_type: 'desktop', app_version: '1.0', capabilities: {} };
      const fetchSpy = mockFetch(200, device);
      const res = await client.registerDevice({
        device_id: 'dev_1',
        app_version: '1.0',
        capabilities: ['webgl', 'gpu'],
      });
      expect(res.id).toBe('dev_1');
      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.device_id).toBe('dev_1');
      expect(body.capabilities).toEqual(['webgl', 'gpu']);
    });
  });

  describe('execution targets', () => {
    const client = createHubClient({ baseUrl: 'http://test.local', getToken: () => 'tok' });

    it('lists Hub execution targets from the web inventory endpoint', async () => {
      const fetchSpy = mockFetch(200, {
        code: 'ok',
        data: {
          items: [
            {
              id: 'target-relay-1',
              owner_id: 'user_1',
              name: 'Hub relay alpha',
              target_type: 'hub_relay',
              health_state: 'healthy',
              is_online: true,
            },
          ],
          page: { hasMore: false, nextCursor: '' },
        },
      });

      const res = await client.listExecutionTargets();

      expect(res.items[0].name).toBe('Hub relay alpha');
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://test.local/web/execution-targets');
      expect(init.method).toBeUndefined();
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    });

    it('pings a Hub execution target through the web endpoint', async () => {
      const fetchSpy = mockFetch(200, { code: 'ok', data: null });

      await client.pingExecutionTarget('target-relay-1');

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://test.local/web/execution-targets/target-relay-1/ping');
      expect(init.method).toBe('POST');
    });

    it('passes target_id when triggering a Hub agent task', async () => {
      const fetchSpy = mockFetch(200, {
        code: 'ok',
        data: {
          id: 'task-1',
          agent_instance_id: 'agent-1',
          triggered_by_user_id: 'user_1',
          trigger_message_id: 'msg-1',
          target_id: 'target-relay-1',
          status: 'queued',
        },
      });

      const res = await client.triggerAgentTask('msg-1', { target_id: 'target-relay-1' });

      expect(res.target_id).toBe('target-relay-1');
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://test.local/web/agent-tasks');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({
        trigger_message_id: 'msg-1',
        target_id: 'target-relay-1',
      });
    });
  });

  describe('agent teams', () => {
    const client = createHubClient({ baseUrl: 'http://test.local', getToken: () => 'tok' });

    it('lists AgentTeams through the Hub web endpoint', async () => {
      const fetchSpy = mockFetch(200, {
        code: 'ok',
        data: [
          {
            id: 'team-1',
            owner_id: 'user_1',
            name: 'Builder Review Team',
          },
        ],
      });

      const res = await client.listAgentTeams();

      expect(res[0].name).toBe('Builder Review Team');
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://test.local/web/agent-teams');
      expect(init.method).toBeUndefined();
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    });

    it('creates teams, adds members, and starts TeamRuns with Hub request bodies', async () => {
      const fetchSpy = mockFetchSequence([
        { status: 200, data: { code: 'ok', data: { id: 'team-1', name: 'Builder Review Team' } } },
        { status: 200, data: { code: 'ok', data: null } },
        { status: 200, data: { code: 'ok', data: { id: 'run-1', team_id: 'team-1', status: 'running' } } },
      ]);

      await client.createAgentTeam({ name: 'Builder Review Team', description: 'Build and review.' });
      await client.addAgentTeamMember('team-1', { agent_profile_id: 'profile-1', role: 'reviewer' });
      await client.startTeamRun('team-1', { trigger_message: 'Implement Desktop TeamRun Console.' });

      expect(fetchSpy.mock.calls[0]?.[0]).toBe('http://test.local/web/agent-teams');
      expect((fetchSpy.mock.calls[0]?.[1] as RequestInit).method).toBe('POST');
      expect(JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
        name: 'Builder Review Team',
        description: 'Build and review.',
      });
      expect(fetchSpy.mock.calls[1]?.[0]).toBe('http://test.local/web/agent-teams/team-1/members');
      expect(JSON.parse((fetchSpy.mock.calls[1]?.[1] as RequestInit).body as string)).toEqual({
        agent_profile_id: 'profile-1',
        role: 'reviewer',
      });
      expect(fetchSpy.mock.calls[2]?.[0]).toBe('http://test.local/web/agent-teams/team-1/runs');
      expect(JSON.parse((fetchSpy.mock.calls[2]?.[1] as RequestInit).body as string)).toEqual({
        trigger_message: 'Implement Desktop TeamRun Console.',
      });
    });

    it('reads TeamRun state, tasks, and events from encoded TeamRun paths', async () => {
      const fetchSpy = mockFetchSequence([
        { status: 200, data: { code: 'ok', data: { run_id: 'run/1', team_id: 'team/1', status: 'running' } } },
        { status: 200, data: { code: 'ok', data: [{ id: 'task-1', status: 'running' }] } },
        { status: 200, data: { code: 'ok', data: [{ id: 'event-1', seq: 1, type: 'team.route.decided' }] } },
      ]);

      await client.getTeamRunState('team/1', 'run/1');
      await client.listTeamTasks('team/1', 'run/1');
      await client.listTeamEvents('team/1', 'run/1');

      expect(fetchSpy.mock.calls[0]?.[0]).toBe('http://test.local/web/agent-teams/team%2F1/runs/run%2F1/state');
      expect(fetchSpy.mock.calls[1]?.[0]).toBe('http://test.local/web/agent-teams/team%2F1/runs/run%2F1/tasks');
      expect(fetchSpy.mock.calls[2]?.[0]).toBe('http://test.local/web/agent-teams/team%2F1/runs/run%2F1/events');
    });

    it('posts TeamRun approval and conflict decisions to real Hub endpoints', async () => {
      const fetchSpy = mockFetchSequence([
        { status: 200, data: { code: 'ok', data: { approval_id: 'approval-1', status: 'allowed' } } },
        { status: 200, data: { code: 'ok', data: { conflict_id: 'conflict-1', status: 'resolved' } } },
      ]);

      await client.decideTeamApproval('team-1', 'run-1', 'approval-1', {
        decision: 'allow',
        reason: 'verified',
      });
      await client.resolveTeamConflict('team-1', 'run-1', 'conflict-1', {
        resolution: 'manual_merge',
        path: 'src/App.tsx',
      });

      expect(fetchSpy.mock.calls[0]?.[0]).toBe('http://test.local/web/agent-teams/team-1/runs/run-1/approvals/approval-1/decide');
      expect((fetchSpy.mock.calls[0]?.[1] as RequestInit).method).toBe('POST');
      expect(JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
        decision: 'allow',
        reason: 'verified',
      });
      expect(fetchSpy.mock.calls[1]?.[0]).toBe('http://test.local/web/agent-teams/team-1/runs/run-1/conflicts/conflict-1/resolve');
      expect((fetchSpy.mock.calls[1]?.[1] as RequestInit).method).toBe('POST');
    });
  });

  describe('baseUrl handling', () => {
    it('strips trailing slash from baseUrl', async () => {
      const client = createHubClient({ baseUrl: 'http://test.local/' });
      const fetchSpy = mockFetch(200, mockUser);
      await client.me();
      const [url] = fetchSpy.mock.calls[0] as [string];
      expect(url).toBe('http://test.local/client/auth/me');
    });
  });
});

// ── hubAuth tests ────────────────────────────────

describe('hubAuth', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    await clearStoredHubAccessToken();
    await clearStoredHubRefreshToken();
  });

  const newAuth = () => createHubAuth(createHubClient({ baseUrl: 'http://test.local' }));

  // Helper: seed authenticated state via a stored token that tryAutoLogin reads.
  async function seedAuthenticated(auth: ReturnType<typeof createHubAuth>) {
    await saveStoredHubAccessToken('jwt_access_123');
    mockFetch(200, mockUser);
    const ok = await auth.tryAutoLogin();
    if (!ok) throw new Error('seedAuthenticated failed');
  }

  describe('logout flow', () => {
    it('clears state and sessionStorage on logout', async () => {
      const auth = newAuth();
      await seedAuthenticated(auth);

      mockFetch(200, {});
      await auth.logout();

      const state = auth.getState();
      expect(state.token).toBeNull();
      expect(state.refreshToken).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
      expect(localStorage.getItem('agenthub_hub_token')).toBeNull();
      expect(localStorage.getItem('agenthub_hub_refresh')).toBeNull();
    });

    it('logout handles server errors gracefully', async () => {
      const auth = newAuth();
      await seedAuthenticated(auth);

      // Server errors during logout should not throw
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network error'));
      await expect(auth.logout()).resolves.toBeUndefined();
      expect(auth.getState().isAuthenticated).toBe(false);
    });
  });

  describe('tryAutoLogin', () => {
    it('returns false when no token stored', async () => {
      const auth = newAuth();
      const result = await auth.tryAutoLogin();
      expect(result).toBe(false);
      expect(auth.getState().isAuthenticated).toBe(false);
    });

    it('returns true and fetches user when token is valid', async () => {
      await saveStoredHubAccessToken('stored_token');
      const auth = newAuth();

      mockFetch(200, mockUser);
      const result = await auth.tryAutoLogin();

      expect(result).toBe(true);
      expect(auth.getState().isAuthenticated).toBe(true);
      expect(auth.getState().user?.id).toBe('user_1');
    });

    it('refreshes token when stored token is expired', async () => {
      await saveStoredHubAccessToken('expired_token');
      await saveStoredHubRefreshToken('valid_refresh');
      const auth = newAuth();

      mockFetchSequence([
        { status: 401, data: { error: { code: 'token_expired', message: 'Token expired' } } }, // me() fails
        { status: 200, data: { access_token: 'new_token', refresh_token: 'new_refresh', expires_in: 900 } }, // refresh
        { status: 200, data: mockUser }, // me() succeeds
      ]);

      const result = await auth.tryAutoLogin();

      expect(result).toBe(true);
      expect(auth.getState().token).toBe('new_token');
      expect(auth.getState().refreshToken).toBe('new_refresh');
      expect(auth.getState().isAuthenticated).toBe(true);
      expect(sessionStorage.getItem('agenthub_hub_token')).toBe('new_token');
      expect(localStorage.getItem('agenthub_hub_token')).toBeNull();
      expect(localStorage.getItem('agenthub_hub_refresh')).toBeNull();
    });

    it('returns false and clears state when both token and refresh fail', async () => {
      await saveStoredHubAccessToken('bad_token');
      await saveStoredHubRefreshToken('bad_refresh');
      const auth = newAuth();

      mockFetchSequence([
        { status: 401, data: { error: { code: 'token_expired', message: 'Token expired' } } },
        { status: 401, data: { error: { code: 'refresh_failed', message: 'Invalid refresh' } } },
      ]);

      const result = await auth.tryAutoLogin();

      expect(result).toBe(false);
      expect(auth.getState().token).toBeNull();
      expect(auth.getState().refreshToken).toBeNull();
      expect(auth.getState().isAuthenticated).toBe(false);
      expect(localStorage.getItem('agenthub_hub_token')).toBeNull();
      expect(sessionStorage.getItem('agenthub_hub_token')).toBeNull();
      expect(localStorage.getItem('agenthub_hub_refresh')).toBeNull();
    });

    it('returns false and clears state when token fails and no refresh token exists', async () => {
      await saveStoredHubAccessToken('bad_token');
      // No refresh token
      const auth = newAuth();

      mockFetch(401, { error: { code: 'token_expired', message: 'Token expired' } });

      const result = await auth.tryAutoLogin();

      expect(result).toBe(false);
      expect(auth.getState().isAuthenticated).toBe(false);
      expect(localStorage.getItem('agenthub_hub_token')).toBeNull();
      expect(sessionStorage.getItem('agenthub_hub_token')).toBeNull();
    });
  });

  describe('getState snapshot stability', () => {
    it('returns a stable frozen snapshot after auto-login', async () => {
      const auth = newAuth();

      const initialSnapshot = auth.getState();
      expect(auth.getState()).toBe(initialSnapshot);
      expect(Object.isFrozen(initialSnapshot)).toBe(true);

      await saveStoredHubAccessToken('stored_token');
      mockFetch(200, mockUser);
      await auth.tryAutoLogin();

      const snapshot = auth.getState();
      expect(snapshot).not.toBe(initialSnapshot);
      expect(auth.getState()).toBe(snapshot);
      expect(Object.isFrozen(snapshot)).toBe(true);

      expect(() => {
        snapshot.isAuthenticated = false;
      }).toThrow(TypeError);
      expect(auth.getState().isAuthenticated).toBe(true);
    });
  });

  describe('HubError', () => {
    it('has status and code properties', () => {
      const err = new HubError(401, 'Unauthorized', 'auth_failed');
      expect(err).toBeInstanceOf(Error);
      expect(err.status).toBe(401);
      expect(err.code).toBe('auth_failed');
      expect(err.message).toBe('Unauthorized');
    });
  });
});
