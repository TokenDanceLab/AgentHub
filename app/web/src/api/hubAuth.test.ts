import { beforeEach, describe, expect, it, vi } from 'vitest';

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
});
