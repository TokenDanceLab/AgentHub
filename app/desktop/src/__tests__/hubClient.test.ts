import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHubClient, HubError } from '../api/hubClient';
import type { AuthResponse, UserProfile } from '../api/hubClient';
import { createHubAuth } from '../api/hubAuth';
import {
  clearStoredHubAccessToken,
  clearStoredHubRefreshToken,
  loadStoredHubAccessToken,
  loadStoredHubRefreshToken,
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

function jsonResponse(status: number, data: unknown, statusText = status === 200 ? 'OK' : 'Error') {
  return new Response(JSON.stringify(data), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetch(status: number, data: unknown, statusText?: string) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(status, data, statusText));
}

function mockFetchSequence(responses: Array<{ status: number; data: unknown; statusText?: string }>) {
  for (const r of responses) {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(r.status, r.data, r.statusText));
  }
}

function getHeader(init: RequestInit, name: string): string | null {
  const headers = init.headers;
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  return (headers as Record<string, string> | undefined)?.[name] ?? null;
}

describe('hubClient', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    await clearStoredHubAccessToken();
    await clearStoredHubRefreshToken();
  });

  describe('auth endpoints', () => {
    it('refresh POSTs refresh_token', async () => {
      const client = createHubClient({ baseUrl: 'http://test.local' });
      const fetchSpy = mockFetch(200, mockAuthResponse);

      const res = await client.refresh('old_refresh');

      expect(res.access_token).toBe('jwt_access_123');
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://test.local/client/auth/refresh');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string).refresh_token).toBe('old_refresh');
    });

    it('starts OIDC authorize with PKCE device payload', async () => {
      const client = createHubClient({ baseUrl: 'http://test.local' });
      const fetchSpy = mockFetch(200, {
        code: 'OK',
        data: { state: 'state-1', authorization_url: 'https://id.example/auth' },
      });

      const res = await client.oidcAuthorize({
        code_challenge: 'challenge',
        code_challenge_method: 'S256',
        device_type: 'desktop',
        device_id: 'device-1',
        redirect_uri: 'http://127.0.0.1:9000/callback',
      });

      expect(res.authorization_url).toBe('https://id.example/auth');
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://test.local/client/auth/oidc/authorize');
      expect(JSON.parse(init.body as string)).toMatchObject({
        code_challenge: 'challenge',
        device_type: 'desktop',
        device_id: 'device-1',
      });
    });

    it('exchanges OIDC callback for Hub session tokens', async () => {
      const client = createHubClient({ baseUrl: 'http://test.local' });
      mockFetch(200, {
        code: 'OK',
        data: { ...mockAuthResponse, user: mockUser },
      });

      await expect(
        client.oidcCallback({
          code: 'code-1',
          state: 'state-1',
          code_verifier: 'verifier',
          device_type: 'desktop',
          device_id: 'device-1',
        }),
      ).resolves.toMatchObject({ access_token: 'jwt_access_123', user: mockUser });
    });

    it('surfaces shared auth errors', async () => {
      const client = createHubClient({ baseUrl: 'http://test.local' });
      mockFetch(
        401,
        { error: { code: 'auth_failed', message: 'Invalid credentials' } },
        'Unauthorized',
      );

      await expect(client.me()).rejects.toMatchObject({
        status: 401,
        code: 'auth_failed',
        message: 'Invalid credentials',
      });
    });

    it('falls back to statusText when error body has no message', async () => {
      const client = createHubClient({ baseUrl: 'http://test.local' });
      mockFetch(503, {}, 'Service Unavailable');

      await expect(client.me()).rejects.toThrow('HTTP 503: Service Unavailable');
    });
  });

  describe('authenticated requests', () => {
    it('includes Bearer header when getToken returns token', async () => {
      const client = createHubClient({
        baseUrl: 'http://test.local',
        getToken: () => 'my_jwt_token',
      });

      const fetchSpy = mockFetch(200, mockUser);
      await client.me();

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(getHeader(init, 'Authorization')).toBe('Bearer my_jwt_token');
    });

    it('omits Authorization header when getToken returns null', async () => {
      const client = createHubClient({
        baseUrl: 'http://test.local',
        getToken: () => null,
      });

      const fetchSpy = mockFetch(200, mockUser);
      await client.me();

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(getHeader(init, 'Authorization')).toBeNull();
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
      expect(fetchSpy.mock.calls[0]?.[0]).toBe('http://test.local/client/auth/me');
    });
  });

  describe('contacts, sessions, and edge callbacks', () => {
    const client = createHubClient({ baseUrl: 'http://test.local', getToken: () => 'tok' });

    it('listContacts sends GET', async () => {
      const contacts = [{ id: 'c1', user_id: 'u1', friend_id: 'u2', status: 'accepted' }];
      const fetchSpy = mockFetch(200, contacts);
      const res = await client.listContacts();

      expect(res).toEqual(contacts);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://test.local/client/contacts');
      expect(init.method).toBeUndefined();
    });

    it('sendFriendRequest POSTs correctly', async () => {
      const fetchSpy = mockFetch(204, undefined);
      await client.sendFriendRequest('user_b', 'Hello!');

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({ friend_id: 'user_b', message: 'Hello!' });
    });

    it('unwraps Hub response envelopes', async () => {
      mockFetch(200, {
        code: 'OK',
        data: [{ session_id: 's-envelope', type: 'private', name: 'DM' }],
      });

      const res = await client.listSessions();

      expect(res).toHaveLength(1);
      expect(res[0]?.session_id).toBe('s-envelope');
    });

    it('uses Hub envelope message on errors', async () => {
      mockFetch(400, { code: 'BAD_REQUEST', message: 'invalid session' });

      await expect(client.listSessions()).rejects.toThrow('invalid session');
    });

    it('createPrivateSession POSTs target_user_id', async () => {
      const fetchSpy = mockFetch(200, { id: 's_new', type: 'private', owner_user_id: 'u1' });

      const res = await client.createPrivateSession({ target_user_id: 'user_b' });

      expect(res.id).toBe('s_new');
      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string).target_user_id).toBe('user_b');
    });

    it('registerDevice POSTs device info', async () => {
      const device = {
        id: 'dev_1',
        user_id: 'u1',
        device_type: 'desktop',
        app_version: '1.0',
        capabilities: {},
      };
      const fetchSpy = mockFetch(200, device);

      const res = await client.registerDevice({
        device_id: 'dev_1',
        app_version: '1.0',
        capabilities: ['webgl', 'gpu'],
      });

      expect(res.id).toBe('dev_1');
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://test.local/edge/devices/register');
      expect(JSON.parse(init.body as string)).toMatchObject({
        device_id: 'dev_1',
        app_version: '1.0',
      });
    });

    it('streams task events with optional run metadata', async () => {
      const fetchSpy = mockFetch(204, undefined);

      await client.streamTaskEvent('task-1', 'run.finished', { ok: true }, {
        runId: 'run-1',
        clientMsgId: 'msg-1',
      });

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://test.local/edge/agent-tasks/task-1/stream');
      expect(JSON.parse(init.body as string)).toEqual({
        event_type: 'run.finished',
        payload: { ok: true },
        run_id: 'run-1',
        client_msg_id: 'msg-1',
      });
    });
  });

  describe('baseUrl handling', () => {
    it('strips trailing slash from baseUrl', async () => {
      const client = createHubClient({ baseUrl: 'http://test.local/' });
      const fetchSpy = mockFetch(200, mockUser);

      await client.me();

      expect(fetchSpy.mock.calls[0]?.[0]).toBe('http://test.local/client/auth/me');
    });

    it('uses the Desktop HUB_URL default when baseUrl is omitted', async () => {
      const client = createHubClient();
      const fetchSpy = mockFetch(200, mockUser);

      await client.me();

      expect(fetchSpy.mock.calls[0]?.[0]).toBe('http://localhost:8080/client/auth/me');
    });
  });
});

describe('hubAuth', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    await clearStoredHubAccessToken();
    await clearStoredHubRefreshToken();
  });

  const newAuth = () => createHubAuth(createHubClient({ baseUrl: 'http://test.local' }));

  describe('tryAutoLogin', () => {
    it('returns false when no access token is stored', async () => {
      const auth = newAuth();

      const result = await auth.tryAutoLogin();

      expect(result).toBe(false);
      expect(auth.getState().isAuthenticated).toBe(false);
    });

    it('returns true and fetches the user from a stored access token', async () => {
      await saveStoredHubAccessToken('valid_access');
      localStorage.setItem('agenthub_token_source', 'tokendance');
      const auth = newAuth();
      mockFetch(200, mockUser);

      const result = await auth.tryAutoLogin();

      expect(result).toBe(true);
      expect(auth.getState()).toMatchObject({
        token: 'valid_access',
        isAuthenticated: true,
        tokenSource: 'tokendance',
      });
      expect(auth.getState().user?.id).toBe('user_1');
      expect(localStorage.getItem('agenthub_hub_token')).toBeNull();
    });

    it('refreshes access token when the stored access token is rejected', async () => {
      await saveStoredHubAccessToken('expired_access');
      await saveStoredHubRefreshToken('valid_refresh');
      const auth = newAuth();
      mockFetchSequence([
        { status: 401, data: { error: { code: 'token_expired', message: 'Token expired' } } },
        { status: 200, data: { access_token: 'new_token', refresh_token: 'new_refresh', expires_in: 900 } },
        { status: 200, data: mockUser },
      ]);

      const result = await auth.tryAutoLogin();

      expect(result).toBe(true);
      expect(auth.getState().token).toBe('new_token');
      expect(auth.getState().refreshToken).toBe('new_refresh');
      expect(await loadStoredHubAccessToken()).toBe('new_token');
      expect(await loadStoredHubRefreshToken()).toBe('new_refresh');
    });

    it('returns false and clears state when refresh fails', async () => {
      await saveStoredHubAccessToken('expired_access');
      await saveStoredHubRefreshToken('bad_refresh');
      localStorage.setItem('agenthub_token_source', 'tokendance');
      const auth = newAuth();
      mockFetchSequence([
        { status: 401, data: { error: { code: 'token_expired', message: 'Token expired' } } },
        { status: 401, data: { error: { code: 'refresh_failed', message: 'Invalid refresh' } } },
      ]);

      const result = await auth.tryAutoLogin();

      expect(result).toBe(false);
      expect(auth.getState()).toMatchObject({
        token: null,
        refreshToken: null,
        user: null,
        isAuthenticated: false,
        tokenSource: null,
      });
      expect(await loadStoredHubAccessToken()).toBeNull();
      expect(await loadStoredHubRefreshToken()).toBeNull();
      expect(localStorage.getItem('agenthub_token_source')).toBeNull();
    });
  });

  describe('logout flow', () => {
    it('clears state and stored Hub session tokens', async () => {
      await saveStoredHubAccessToken('valid_access');
      await saveStoredHubRefreshToken('valid_refresh');
      const auth = newAuth();
      mockFetch(200, mockUser);
      await auth.tryAutoLogin();
      mockFetch(204, undefined);

      await auth.logout();

      expect(auth.getState()).toMatchObject({
        token: null,
        refreshToken: null,
        user: null,
        isAuthenticated: false,
      });
      expect(await loadStoredHubAccessToken()).toBeNull();
      expect(await loadStoredHubRefreshToken()).toBeNull();
    });

    it('logout handles server errors gracefully', async () => {
      await saveStoredHubAccessToken('valid_access');
      const auth = newAuth();
      mockFetch(200, mockUser);
      await auth.tryAutoLogin();
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network error'));

      await expect(auth.logout()).resolves.toBeUndefined();
      expect(auth.getState().isAuthenticated).toBe(false);
    });
  });

  describe('state snapshots', () => {
    it('returns a stable frozen snapshot until auth state changes', async () => {
      const auth = newAuth();
      const initialSnapshot = auth.getState();

      expect(auth.getState()).toBe(initialSnapshot);
      expect(Object.isFrozen(initialSnapshot)).toBe(true);

      await saveStoredHubAccessToken('valid_access');
      mockFetch(200, mockUser);
      await auth.tryAutoLogin();

      const snapshot = auth.getState();
      expect(snapshot).not.toBe(initialSnapshot);
      expect(auth.getState()).toBe(snapshot);
      expect(Object.isFrozen(snapshot)).toBe(true);
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
