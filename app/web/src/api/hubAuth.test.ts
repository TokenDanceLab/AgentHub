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
});
