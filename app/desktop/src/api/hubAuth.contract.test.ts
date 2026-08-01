import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HubClient } from './hubClient';
import {
  clearStoredHubAccessToken,
  clearStoredHubRefreshToken,
  saveStoredHubAccessToken,
  saveStoredHubRefreshToken,
} from './hubTokenStorage';
import { createHubAuth, OidcError } from './hubAuth';

function clientFor(overrides: Partial<HubClient> = {}): HubClient {
  return {
    me: vi
      .fn()
      .mockResolvedValue({ id: 'user-1', username: 'alice', nickname: 'Alice', avatar_url: '' }),
    refresh: vi
      .fn()
      .mockResolvedValue({
        access_token: 'access-refreshed',
        refresh_token: 'refresh-refreshed',
        expires_in: 3600,
      }),
    request: vi.fn().mockResolvedValue(undefined),
    oidcAuthorize: vi.fn(),
    oidcCallback: vi.fn(),
    ...overrides,
  } as unknown as HubClient;
}

describe('createHubAuth contract', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    await clearStoredHubAccessToken();
    await clearStoredHubRefreshToken();
    window.history.replaceState({}, '', '/');
  });

  it('publishes immutable auth snapshots and unsubscribes cleanly', async () => {
    const auth = createHubAuth(clientFor());
    const snapshots: string[] = [];
    const unsubscribe = auth.subscribe((state) => snapshots.push(state.token ?? 'none'));

    await auth.logout();
    unsubscribe();
    await auth.logout();

    expect(snapshots).toEqual(['none']);
    expect(Object.isFrozen(auth.getState())).toBe(true);
    expect(auth.getState().isAuthenticated).toBe(false);
  });

  it('restores a stored token after Hub profile validation', async () => {
    await saveStoredHubAccessToken('access-1');
    localStorage.setItem('agenthub_token_source', 'hub');
    const auth = createHubAuth(clientFor());

    await expect(auth.tryAutoLogin()).resolves.toBe(true);
    expect(auth.getState()).toMatchObject({
      token: 'access-1',
      isAuthenticated: true,
      tokenSource: 'hub',
    });
    expect(auth.getState().user?.username).toBe('alice');
  });

  it('refreshes an expired access token and retries the profile request', async () => {
    await saveStoredHubAccessToken('access-expired');
    await saveStoredHubRefreshToken('refresh-1');
    const me = vi
      .fn()
      .mockRejectedValueOnce(new Error('expired'))
      .mockResolvedValueOnce({ id: 'user-2', username: 'bob', nickname: 'Bob', avatar_url: '' });
    const refresh = vi
      .fn()
      .mockResolvedValue({
        access_token: 'access-2',
        refresh_token: 'refresh-2',
        expires_in: 3600,
      });
    const auth = createHubAuth(clientFor({ me, refresh }));

    await expect(auth.tryAutoLogin()).resolves.toBe(true);
    expect(refresh).toHaveBeenCalledWith('refresh-1');
    expect(auth.getState()).toMatchObject({
      token: 'access-2',
      refreshToken: 'refresh-2',
      isAuthenticated: true,
    });
  });

  it('clears invalid credentials when profile and refresh both fail', async () => {
    await saveStoredHubAccessToken('access-invalid');
    await saveStoredHubRefreshToken('refresh-invalid');
    const auth = createHubAuth(
      clientFor({
        me: vi.fn().mockRejectedValue(new Error('unauthorized')),
        refresh: vi.fn().mockRejectedValue(new Error('refresh rejected')),
      }),
    );

    await expect(auth.tryAutoLogin()).resolves.toBe(false);
    expect(auth.getState()).toMatchObject({
      token: null,
      refreshToken: null,
      user: null,
      isAuthenticated: false,
      tokenSource: null,
    });
    expect(sessionStorage.getItem('agenthub_hub_token')).toBeNull();
  });

  it('logs out remotely when authenticated and clears all local state', async () => {
    await saveStoredHubAccessToken('access-logout');
    const request = vi.fn().mockResolvedValue(undefined);
    const auth = createHubAuth(clientFor({ request }));
    await auth.tryAutoLogin();

    await auth.logout();
    expect(request).toHaveBeenCalledWith('/client/auth/logout', { method: 'POST' });
    expect(auth.getState().isAuthenticated).toBe(false);
    expect(sessionStorage.getItem('agenthub_hub_token')).toBeNull();
  });

  it('completes the browser callback exchange and removes the callback URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          code: 'OK',
          data: {
            access_token: 'access-oidc',
            refresh_token: 'refresh-oidc',
            expires_in: 3600,
            user: { id: 'user-oidc', username: 'oidc-user', nickname: 'OIDC', avatar_url: '' },
          },
        }),
      }),
    );
    const auth = createHubAuth(clientFor());
    sessionStorage.setItem(
      'agenthub_oidc_pkce_pending',
      JSON.stringify({
        state: 'state-1',
        codeVerifier: 'verifier-1',
        deviceId: 'device-1',
        redirectUri: 'http://localhost:5173/auth/tokendance/callback',
        createdAt: Date.now(),
      }),
    );
    window.history.pushState({}, '', '/auth/tokendance/callback?code=code-1&state=state-1');

    await expect(auth.tryAutoLogin()).resolves.toBe(true);
    expect(window.location.pathname).toBe('/');
    expect(auth.getState()).toMatchObject({ token: 'access-oidc', isAuthenticated: true });
  });

  it('rejects browser callbacks with a missing pending state, mismatch, or expiry', async () => {
    const auth = createHubAuth(clientFor());
    window.history.pushState({}, '', '/auth/tokendance/callback?code=code-1&state=state-1');
    await expect(auth.tryAutoLogin()).resolves.toBe(false);

    sessionStorage.setItem(
      'agenthub_oidc_pkce_pending',
      JSON.stringify({
        state: 'state-expected',
        codeVerifier: 'v',
        deviceId: 'd',
        redirectUri: '',
        createdAt: Date.now(),
      }),
    );
    window.history.pushState({}, '', '/auth/tokendance/callback?code=code-1&state=state-other');
    await expect(auth.tryAutoLogin()).rejects.toMatchObject({ code: 'stateMismatch' });

    sessionStorage.setItem(
      'agenthub_oidc_pkce_pending',
      JSON.stringify({
        state: 'state-old',
        codeVerifier: 'v',
        deviceId: 'd',
        redirectUri: '',
        createdAt: Date.now() - 11 * 60 * 1000,
      }),
    );
    window.history.pushState({}, '', '/auth/tokendance/callback?code=code-1&state=state-old');
    await expect(auth.tryAutoLogin()).rejects.toMatchObject({ code: 'timeout' });
    expect(auth.getState().isAuthenticated).toBe(false);
  });

  it('wraps authorize failures as an OIDC start error', async () => {
    const authorize = vi.fn().mockRejectedValue(new Error('hub unavailable'));
    const auth = createHubAuth(clientFor({ oidcAuthorize: authorize }));
    await expect(auth.loginWithTokenDance()).rejects.toBeInstanceOf(OidcError);
    await expect(auth.loginWithTokenDance()).rejects.toMatchObject({
      code: 'startFailed',
      detail: 'hub unavailable',
    });
    expect(authorize).toHaveBeenCalled();
  });
});
