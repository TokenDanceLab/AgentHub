import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchExecutionTargets } from './executionTargetQueries';
import { getAuthorization } from '@/__tests__/requestInitTestUtils';

const DEVICE_ID = '00000000-0000-0000-0000-00000000a101';

async function loadAuthModule() {
  vi.resetModules();
  return import('./hubAuth');
}

describe('web Hub auth token auto-login', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('agenthub_device_id', DEVICE_ID);
  });

  it('restores session from stored access token', async () => {
    // Simulate a stored access token from a previous session
    sessionStorage.setItem('agenthub_hub_token', 'stored-access-token');

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/client/auth/me')) {
        expect(getAuthorization(init)).toBe('Bearer stored-access-token');
        return new Response(
          JSON.stringify({
            id: '00000000-0000-0000-0000-00000000b101',
            username: 'alice',
            nickname: 'Alice',
            avatar_url: '',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { createHubAuth } = await loadAuthModule();
    const auth = createHubAuth();

    const ok = await auth.tryAutoLogin();
    expect(ok).toBe(true);
    expect(auth.getState().isAuthenticated).toBe(true);
    expect(auth.getState().user?.username).toBe('alice');
  });

  it('exchanges browser OIDC callback with web device type only', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
    window.history.pushState({}, '', '/auth/tokendance/callback?code=oidc-code&state=state-1');
    sessionStorage.setItem(
      'agenthub_oidc_pkce_pending',
      JSON.stringify({
        state: 'state-1',
        codeVerifier: 'verifier-1',
        deviceId: DEVICE_ID,
        redirectUri: `${window.location.origin}/auth/tokendance/callback`,
        createdAt: Date.now(),
      })
    );

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/client/auth/oidc/callback')) {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          code: 'oidc-code',
          state: 'state-1',
          code_verifier: 'verifier-1',
          device_type: 'web',
          device_id: DEVICE_ID,
        });
        return new Response(
          JSON.stringify({
            access_token: 'web-access-token',
            refresh_token: 'web-refresh-token',
            expires_in: 3600,
            user: {
              id: '00000000-0000-0000-0000-00000000b102',
              username: 'web-user',
              nickname: 'Web User',
              avatar_url: '',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { createHubAuth } = await loadAuthModule();
    const auth = createHubAuth();

    const ok = await auth.tryAutoLogin();
    expect(ok).toBe(true);
    expect(auth.getState().isAuthenticated).toBe(true);
    expect(auth.getState().user?.username).toBe('web-user');
  });

  it('uses Hub-issued OIDC session to address a registered Desktop Edge target', async () => {
    window.history.pushState(
      {},
      '',
      '/auth/tokendance/callback?code=web-code&state=state-web-fixture'
    );
    sessionStorage.setItem(
      'agenthub_oidc_pkce_pending',
      JSON.stringify({
        state: 'state-web-fixture',
        codeVerifier: 'web-verifier-fixture',
        deviceId: DEVICE_ID,
        redirectUri: `${window.location.origin}/auth/tokendance/callback`,
        createdAt: Date.now(),
      })
    );

    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requestedUrls.push(url);

      if (url.endsWith('/client/auth/oidc/callback')) {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          code: 'web-code',
          state: 'state-web-fixture',
          code_verifier: 'web-verifier-fixture',
          device_type: 'web',
          device_id: DEVICE_ID,
          redirect_uri: `${window.location.origin}/auth/tokendance/callback`,
        });
        return new Response(
          JSON.stringify({
            access_token: 'web-fixture-access-token',
            refresh_token: 'web-fixture-refresh-token',
            expires_in: 900,
            user: {
              id: '00000000-0000-0000-0000-00000000b103',
              username: 'fixture-web-user',
              nickname: 'Fixture Web User',
              avatar_url: '',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.endsWith('/web/execution-targets?pageSize=50')) {
        expect(getAuthorization(init)).toBe('Bearer web-fixture-access-token');
        return new Response(
          JSON.stringify({
            code: 'OK',
            data: {
              items: [
                {
                  id: '00000000-0000-0000-0000-00000000e501',
                  owner_id: '00000000-0000-0000-0000-00000000b103',
                  name: 'Packaged Desktop Edge',
                  target_type: 'local_edge',
                  workspace_allowlist: '["D:\\\\Code\\\\TokenDance"]',
                  trust_level: 'local',
                  health_state: 'healthy',
                  is_online: true,
                },
              ],
              page: { hasMore: false },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { createHubAuth } = await loadAuthModule();
    const auth = createHubAuth();

    await expect(auth.tryAutoLogin()).resolves.toBe(true);
    expect(auth.getState()).toMatchObject({
      isAuthenticated: true,
      token: 'web-fixture-access-token',
      refreshToken: 'web-fixture-refresh-token',
      tokenSource: 'tokendance',
    });
    expect(sessionStorage.getItem('agenthub_hub_token')).toBe('web-fixture-access-token');
    expect(sessionStorage.getItem('agenthub_hub_refresh_token')).toBe('web-fixture-refresh-token');
    expect(sessionStorage.getItem('agenthub_token_source')).toBe('tokendance');
    expect(localStorage.getItem('agenthub_hub_token')).toBeNull();
    expect(localStorage.getItem('agenthub_hub_refresh_token')).toBeNull();
    expect(localStorage.getItem('agenthub_token_source')).toBeNull();
    const targets = await fetchExecutionTargets(true, () => auth.getState().token);
    expect(targets.items).toHaveLength(1);
    expect(targets.items[0]).toMatchObject({
      name: 'Packaged Desktop Edge',
      target_type: 'local_edge',
      health_state: 'healthy',
      is_online: true,
      workspace_allowlist: ['D:\\Code\\TokenDance'],
    });

    const requestedUrlText = requestedUrls.join('\n');
    const localEdgeLoopback = ['localhost', '3210'].join(':');
    const edgeRunApi = ['/v1', 'runs'].join('/');
    const edgeEventsApi = ['/v1', 'events'].join('/');
    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrlText).not.toContain(localEdgeLoopback);
    expect(requestedUrlText).not.toContain(edgeRunApi);
    expect(requestedUrlText).not.toContain(edgeEventsApi);
  });

  it('refreshes an expired session, notifies subscribers, and logs out cleanly', async () => {
    sessionStorage.setItem('agenthub_hub_token', 'expired-token');
    sessionStorage.setItem('agenthub_hub_refresh_token', 'refresh-token');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/client/auth/me')) {
        const auth = getAuthorization(init);
        if (auth === 'Bearer expired-token')
          return new Response(
            JSON.stringify({ error: { code: 'token_expired', message: 'expired' } }),
            { status: 401 }
          );
        return new Response(
          JSON.stringify({
            id: 'user-refresh',
            username: 'refreshed',
            nickname: 'Refreshed',
            avatar_url: '',
          }),
          { status: 200 }
        );
      }
      if (url.endsWith('/client/auth/refresh')) {
        return new Response(
          JSON.stringify({
            access_token: 'fresh-token',
            refresh_token: 'fresh-refresh',
            expires_in: 3600,
          }),
          { status: 200 }
        );
      }
      if (url.endsWith('/client/auth/logout')) return new Response('{}', { status: 200 });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { createHubAuth } = await loadAuthModule();
    const auth = createHubAuth();
    const seen: boolean[] = [];
    const unsubscribe = auth.subscribe((state) => seen.push(state.isAuthenticated));

    await expect(auth.tryAutoLogin()).resolves.toBe(true);
    await auth.logout();
    unsubscribe();

    expect(auth.getState()).toMatchObject({
      token: null,
      refreshToken: null,
      user: null,
      isAuthenticated: false,
      tokenSource: null,
    });
    expect(seen).toEqual([true, false]);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/client/auth/refresh'))).toBe(
      true
    );
  });

  it('clears credentials when refresh fails after an unauthorized profile', async () => {
    sessionStorage.setItem('agenthub_hub_token', 'bad-token');
    sessionStorage.setItem('agenthub_hub_refresh_token', 'bad-refresh');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/client/auth/me'))
        return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'no' } }), {
          status: 401,
        });
      if (url.endsWith('/client/auth/refresh'))
        return new Response(JSON.stringify({ error: { code: 'refresh_failed', message: 'no' } }), {
          status: 401,
        });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { createHubAuth } = await loadAuthModule();

    await expect(createHubAuth().tryAutoLogin()).resolves.toBe(false);
    expect(sessionStorage.getItem('agenthub_hub_token')).toBeNull();
    expect(sessionStorage.getItem('agenthub_hub_refresh_token')).toBeNull();
  });

  it('rejects malformed, mismatched, and expired browser callbacks without exchanging tokens', async () => {
    const { createHubAuth } = await loadAuthModule();
    const auth = createHubAuth();

    window.history.pushState({}, '', '/auth/tokendance/callback?code=c&state=s');
    sessionStorage.setItem('agenthub_oidc_pkce_pending', '{bad-json');
    await expect(auth.tryAutoLogin()).resolves.toBe(false);

    sessionStorage.setItem(
      'agenthub_oidc_pkce_pending',
      JSON.stringify({
        state: 'expected',
        codeVerifier: 'v',
        deviceId: DEVICE_ID,
        redirectUri: `${window.location.origin}/auth/tokendance/callback`,
        createdAt: Date.now(),
      })
    );
    window.history.pushState({}, '', '/auth/tokendance/callback?code=c&state=other');
    await expect(auth.tryAutoLogin()).rejects.toThrow(/state mismatch/i);

    sessionStorage.setItem(
      'agenthub_oidc_pkce_pending',
      JSON.stringify({
        state: 'old',
        codeVerifier: 'v',
        deviceId: DEVICE_ID,
        redirectUri: `${window.location.origin}/auth/tokendance/callback`,
        createdAt: Date.now() - 11 * 60 * 1000,
      })
    );
    window.history.pushState({}, '', '/auth/tokendance/callback?code=c&state=old');
    await expect(auth.tryAutoLogin()).rejects.toThrow(/expired/i);
  });

  it('starts the OIDC PKCE login: authorize payload, sessionStorage pending state, and window redirect', async () => {
    const assignSpy = vi.fn();
    const realLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        href: 'http://localhost:5173/workbench/',
        origin: 'http://localhost:5173',
        pathname: '/workbench/',
        assign: assignSpy,
        replace: vi.fn(),
        reload: vi.fn(),
      },
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/client/auth/oidc/authorize')) {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          code_challenge_method: 'S256',
          device_type: 'web',
          device_id: DEVICE_ID,
          redirect_uri: 'http://localhost:5173/auth/tokendance/callback',
        });
        expect(body.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
        return new Response(
          JSON.stringify({
            state: 'server-state-1',
            authorization_url: 'https://id.example.com/authorize?state=server-state-1',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const { createHubAuth } = await loadAuthModule();
      const auth = createHubAuth();

      // Browser-redirect mode: the page unloads during the redirect, so the
      // returned promise never settles — assert the pre-redirect side effects.
      void auth.loginWithTokenDance();

      await vi.waitFor(() => {
        expect(assignSpy).toHaveBeenCalledWith(
          'https://id.example.com/authorize?state=server-state-1'
        );
      });
      const pending = JSON.parse(sessionStorage.getItem('agenthub_oidc_pkce_pending') ?? '{}');
      expect(pending).toMatchObject({
        state: 'server-state-1',
        deviceId: DEVICE_ID,
        redirectUri: 'http://localhost:5173/auth/tokendance/callback',
      });
      expect(pending.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(pending.createdAt).toBeGreaterThan(0);
      // No token material is persisted at login start.
      expect(sessionStorage.getItem('agenthub_hub_token')).toBeNull();
      expect(sessionStorage.getItem('agenthub_hub_refresh_token')).toBeNull();
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: realLocation,
      });
    }
  });
});
