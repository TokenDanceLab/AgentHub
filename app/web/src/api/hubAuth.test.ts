import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHubAuth } from './hubAuth';
import { getBrowserCsrfToken } from './browserSessionRuntime';
import { useHubStore } from '@/stores/hubStore';

const user = { id: 'user-a', username: 'alice', nickname: 'Alice' };
const session = { user, expires_at: '2099-01-01T00:00:00Z', csrf_token: 'csrf-proof' };

describe('Web browser sessions', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', '/');
    localStorage.clear();
    sessionStorage.clear();
    useHubStore.getState().clear();
  });

  it('restores only from Hub and removes legacy browser credentials', async () => {
    sessionStorage.setItem('agenthub_hub_token', 'legacy-access');
    localStorage.setItem('agenthub_hub_refresh_token', 'legacy-refresh');
    const fetchMock = vi.fn(async () => Response.json({ code: 'ok', data: session }));
    vi.stubGlobal('fetch', fetchMock);
    const auth = createHubAuth();
    expect(auth.getState().isAuthenticated).toBe(false);
    await expect(auth.tryAutoLogin()).resolves.toBe(true);
    expect(auth.getState()).toMatchObject({ user, token: null, refreshToken: null, isAuthenticated: true });
    expect(fetchMock).toHaveBeenCalledWith('/client/auth/browser/session', expect.objectContaining({ credentials: 'same-origin' }));
    expect(sessionStorage.getItem('agenthub_hub_token')).toBeNull();
    expect(localStorage.getItem('agenthub_hub_refresh_token')).toBeNull();
    expect(getBrowserCsrfToken()).toBe('csrf-proof');
  });

  it('exchanges code, state and issuer without putting PKCE or tokens in JS storage', async () => {
    window.history.replaceState({}, '', '/auth/account/callback?code=code&state=state&iss=https%3A%2F%2Faccount.example.test');
    const fetchMock = vi.fn(async () => Response.json({ code: 'ok', data: session }));
    vi.stubGlobal('fetch', fetchMock);
    const auth = createHubAuth();
    await expect(auth.tryAutoLogin()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/client/auth/browser/callback', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ code: 'code', state: 'state', iss: 'https://account.example.test' }),
    }));
    expect(window.location.search).toBe('');
    expect(sessionStorage.getItem('agenthub_oidc_pkce_pending')).toBeNull();
  });

  it('fails closed when the server reports no session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'auth_required' }, { status: 401 })));
    const auth = createHubAuth();
    await expect(auth.tryAutoLogin()).resolves.toBe(false);
    expect(auth.getState().isAuthenticated).toBe(false);
  });

  it('sends CSRF on logout and only clears state after successful server revocation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ code: 'ok', data: session }))
      .mockResolvedValueOnce(Response.json({ code: 'unavailable' }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ code: 'ok', data: null }));
    vi.stubGlobal('fetch', fetchMock);
    const auth = createHubAuth();
    await auth.tryAutoLogin();
    await expect(auth.logout()).rejects.toMatchObject({ status: 503 });
    expect(auth.getState().isAuthenticated).toBe(true);
    await auth.logout();
    expect(auth.getState().isAuthenticated).toBe(false);
    expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get('X-Hub-CSRF')).toBe('csrf-proof');
    expect(getBrowserCsrfToken()).toBeNull();
  });
});
