import { beforeEach, describe, expect, it, vi } from 'vitest';

const DEVICE_ID = '00000000-0000-0000-0000-00000000a101';

async function loadAuthModule() {
  vi.resetModules();
  return import('./hubAuth');
}

describe('web Hub auth device boundary', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('agenthub_device_id', DEVICE_ID);
  });

  it('uses web device_type for legacy Hub password login', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/client/auth/login')) {
        return new Response(
          JSON.stringify({
            access_token: 'hub-access',
            refresh_token: 'hub-refresh',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.endsWith('/client/auth/me')) {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer hub-access' });
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

    await auth.login('alice', 'correct horse battery staple');

    const loginCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/client/auth/login'));
    expect(loginCall).toBeDefined();
    const [, init] = loginCall!;
    const body = JSON.parse(String(init?.body));

    expect(body).toMatchObject({
      username: 'alice',
      password: 'correct horse battery staple',
      device_type: 'web',
      device_id: DEVICE_ID,
    });
    expect(sessionStorage.getItem('agenthub_token_source')).toBe('hub');
    expect(auth.getState().isAuthenticated).toBe(true);
  });
});
