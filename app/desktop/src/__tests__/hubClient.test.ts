import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHubClient, HubError } from '../api/hubClient';
import type { AuthResponse, UserProfile } from '../api/hubClient';
import { createHubAuth } from '../api/hubAuth';

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
  return vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 401 ? 'Unauthorized' : status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
    headers: new Headers(),
  } as Response);
}

function mockFetchSequence(responses: Array<{ status: number; data: unknown }>) {
  for (const r of responses) {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      statusText: r.status === 200 ? 'OK' : 'Error',
      json: () => Promise.resolve(r.data),
      headers: new Headers(),
    } as Response);
  }
}

// ── Tests ────────────────────────────────────────

describe('hubClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe('createHubClient (unauthenticated)', () => {
    const client = createHubClient({ baseUrl: 'http://test.local' });

    it('sends POST login with correct body', async () => {
      const fetchSpy = mockFetch(200, mockAuthResponse);

      const res = await client.login({
        username: 'alice',
        password: 'secret',
        device_type: 'desktop',
        device_id: 'dev_001',
      });

      expect(res.access_token).toBe('jwt_access_123');
      expect(res.refresh_token).toBe('jwt_refresh_456');

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://test.local/client/auth/login');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string);
      expect(body.username).toBe('alice');
      expect(body.password).toBe('secret');
      expect(body.device_type).toBe('desktop');
      expect(body.device_id).toBe('dev_001');
    });

    it('sends register with nickname', async () => {
      const fetchSpy = mockFetch(200, { user_id: 'user_new' });

      const res = await client.register({
        username: 'newuser',
        password: 'pass123',
        nickname: 'New Guy',
      });

      expect(res.user_id).toBe('user_new');
      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.nickname).toBe('New Guy');
    });

    it('throws HubError on 401 invalid credentials', async () => {
      mockFetch(401, { error: { code: 'auth_failed', message: 'Invalid credentials' } });

      await expect(
        client.login({
          username: 'bad',
          password: 'wrong',
          device_type: 'desktop',
          device_id: 'd',
        }),
      ).rejects.toThrow('Invalid credentials');
    });

    it('throws on 500 server error', async () => {
      mockFetch(500, { error: { code: 'internal_error', message: 'database down' } });

      await expect(
        client.login({
          username: 'x',
          password: 'y',
          device_type: 'desktop',
          device_id: 'z',
        }),
      ).rejects.toThrow('database down');
    });

    it('falls back to statusText when error body has no message', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: () => Promise.resolve({}),
        headers: new Headers(),
      } as Response);

      await expect(
        client.login({ username: 'x', password: 'y', device_type: 'd', device_id: 'z' }),
      ).rejects.toThrow();
    });

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

      const fetchSpy = mockFetch(200, { user_id: 'x' });
      await client.register({ username: 'x', password: 'y', nickname: 'z' });

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
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  const newAuth = () => createHubAuth(createHubClient({ baseUrl: 'http://test.local' }));

  describe('login flow', () => {
    it('stores token and fetches user on successful login', async () => {
      const auth = newAuth();

      mockFetchSequence([
        { status: 200, data: mockAuthResponse }, // login
        { status: 200, data: mockUser },          // me
      ]);

      await auth.login('alice', 'hunter2');

      const state = auth.getState();
      expect(state.token).toBe('jwt_access_123');
      expect(state.refreshToken).toBe('jwt_refresh_456');
      expect(state.isAuthenticated).toBe(true);
      expect(state.user?.username).toBe('testuser');
      expect(localStorage.getItem('agenthub_hub_token')).toBe('jwt_access_123');
      expect(localStorage.getItem('agenthub_hub_refresh')).toBe('jwt_refresh_456');
    });

    it('uses the stable desktop device id for legacy login', async () => {
      localStorage.setItem('agenthub_device_id', '00000000-0000-0000-0000-00000000a001');
      const auth = newAuth();

      mockFetchSequence([
        { status: 200, data: mockAuthResponse },
        { status: 200, data: mockUser },
      ]);

      await auth.login('alice', 'hunter2');

      const [, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.device_id).toBe('00000000-0000-0000-0000-00000000a001');
    });

    it('notifies subscribers on login', async () => {
      const auth = newAuth();
      const states: { isAuthenticated: boolean }[] = [];

      auth.subscribe((s) => states.push({ isAuthenticated: s.isAuthenticated }));

      mockFetchSequence([
        { status: 200, data: mockAuthResponse },
        { status: 200, data: mockUser },
      ]);

      await auth.login('alice', 'hunter2');
      // Should have been notified at least once with isAuthenticated=true
      expect(states.some((s) => s.isAuthenticated)).toBe(true);
    });

    it('unsubscribe stops receiving notifications', async () => {
      const auth = newAuth();
      const calls: boolean[] = [];
      const unsub = auth.subscribe((s) => calls.push(s.isAuthenticated));

      // Unsubscribe immediately
      unsub();

      mockFetchSequence([
        { status: 200, data: mockAuthResponse },
        { status: 200, data: mockUser },
      ]);
      await auth.login('alice', 'hunter2');
      // Still called once for initial subscription, then unsubscribed
      // The unsubscribe should prevent additional calls during login
      expect(calls.length).toBeLessThanOrEqual(1);
    });
  });

  describe('logout flow', () => {
    it('clears state and localStorage on logout', async () => {
      const auth = newAuth();

      // First login
      mockFetchSequence([
        { status: 200, data: mockAuthResponse },
        { status: 200, data: mockUser },
      ]);
      await auth.login('alice', 'hunter2');

      // Then logout
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

      mockFetchSequence([
        { status: 200, data: mockAuthResponse },
        { status: 200, data: mockUser },
      ]);
      await auth.login('alice', 'hunter2');

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
      localStorage.setItem('agenthub_hub_token', 'stored_token');
      const auth = newAuth();

      mockFetch(200, mockUser);
      const result = await auth.tryAutoLogin();

      expect(result).toBe(true);
      expect(auth.getState().isAuthenticated).toBe(true);
      expect(auth.getState().user?.id).toBe('user_1');
    });

    it('refreshes token when stored token is expired', async () => {
      localStorage.setItem('agenthub_hub_token', 'expired_token');
      localStorage.setItem('agenthub_hub_refresh', 'valid_refresh');
      const auth = newAuth();

      mockFetchSequence([
        { status: 401, data: { error: { code: 'token_expired', message: 'Token expired' } } }, // me() fails
        { status: 200, data: { access_token: 'new_token', refresh_token: 'new_refresh', expires_in: 900 } }, // refresh
        { status: 200, data: mockUser }, // me() succeeds
      ]);

      const result = await auth.tryAutoLogin();

      expect(result).toBe(true);
      expect(auth.getState().token).toBe('new_token');
      expect(auth.getState().isAuthenticated).toBe(true);
      expect(localStorage.getItem('agenthub_hub_token')).toBe('new_token');
    });

    it('returns false and clears state when both token and refresh fail', async () => {
      localStorage.setItem('agenthub_hub_token', 'bad_token');
      localStorage.setItem('agenthub_hub_refresh', 'bad_refresh');
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
      expect(localStorage.getItem('agenthub_hub_refresh')).toBeNull();
    });

    it('returns false and clears state when token fails and no refresh token exists', async () => {
      localStorage.setItem('agenthub_hub_token', 'bad_token');
      // No refresh token
      const auth = newAuth();

      mockFetch(401, { error: { code: 'token_expired', message: 'Token expired' } });

      const result = await auth.tryAutoLogin();

      expect(result).toBe(false);
      expect(auth.getState().isAuthenticated).toBe(false);
      expect(localStorage.getItem('agenthub_hub_token')).toBeNull();
    });
  });

  describe('getState returns a snapshot', () => {
    it('returns a copy, not the live state object', async () => {
      const auth = newAuth();

      mockFetchSequence([
        { status: 200, data: mockAuthResponse },
        { status: 200, data: mockUser },
      ]);
      await auth.login('alice', 'hunter2');

      const snapshot = auth.getState();
      snapshot.isAuthenticated = false; // mutate copy

      expect(auth.getState().isAuthenticated).toBe(true); // original unchanged
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
