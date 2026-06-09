import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchExecutionTargets } from './executionTargetQueries';

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
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer stored-access-token' });
        return new Response(
          JSON.stringify({
            id: '00000000-0000-0000-0000-00000000b101',
            username: 'alice',
            nickname: 'Alice',
            avatar_url: '',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
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
      }),
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
          { status: 200, headers: { 'Content-Type': 'application/json' } },
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
    window.history.pushState({}, '', '/auth/tokendance/callback?code=web-code&state=state-web-fixture');
    sessionStorage.setItem(
      'agenthub_oidc_pkce_pending',
      JSON.stringify({
        state: 'state-web-fixture',
        codeVerifier: 'web-verifier-fixture',
        deviceId: DEVICE_ID,
        redirectUri: `${window.location.origin}/auth/tokendance/callback`,
        createdAt: Date.now(),
      }),
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
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.endsWith('/web/execution-targets?pageSize=50')) {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer web-fixture-access-token' });
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
          { status: 200, headers: { 'Content-Type': 'application/json' } },
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
});
