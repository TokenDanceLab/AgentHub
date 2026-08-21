import { beforeEach, describe, expect, it, vi } from 'vitest';

const refreshMock = vi.hoisted(() => vi.fn());

// The refresh exchange goes through the shared Hub client; only `refresh` is
// exercised by webAuthTokenRefresh.
vi.mock('@shared/hub/hubClient', () => ({
  createHubClient: () => ({ refresh: refreshMock }),
}));

const ACCESS_TOKEN_KEY = 'agenthub_hub_token';
const REFRESH_TOKEN_KEY = 'agenthub_hub_refresh_token';

/**
 * Fresh module graph per test: webAuthTokenRefresh keeps a single-flight
 * cache and hubTokenStorage keeps a memory fallback, both of which would
 * otherwise leak state across tests.
 */
async function loadModules() {
  vi.resetModules();
  const { useHubStore } = await import('@/stores/hubStore');
  const { refreshWebHubAccessTokenOnce } = await import('./webAuthTokenRefresh');
  const { resetWebHubSession } = await import('./webAuthSessionReset');
  const tokenStorage = await import('@/api/hubTokenStorage');
  return { useHubStore, refreshWebHubAccessTokenOnce, resetWebHubSession, tokenStorage };
}

describe('refreshWebHubAccessTokenOnce (#1816)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    refreshMock.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('resets the auth state and surfaces the login entry when the refresh exchange fails', async () => {
    const { useHubStore, refreshWebHubAccessTokenOnce, tokenStorage } = await loadModules();
    await tokenStorage.saveStoredHubAccessToken('stale-access');
    await tokenStorage.saveStoredHubRefreshToken('dead-refresh');
    useHubStore.getState().setAuthenticated(true, 'user-1', 'alice');
    refreshMock.mockRejectedValueOnce(new Error('refresh token revoked'));

    const token = await refreshWebHubAccessTokenOnce();

    expect(token).toBeNull();
    // Stored tokens are dropped so the dead session cannot be retried.
    expect(await tokenStorage.loadStoredHubRefreshToken()).toBeNull();
    expect(await tokenStorage.loadStoredHubAccessToken()).toBeNull();
    expect(sessionStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
    expect(sessionStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
    // Hub auth state is reset and the login entry becomes visible.
    expect(useHubStore.getState().authenticated).toBe(false);
    expect(useHubStore.getState().userId).toBeNull();
    expect(useHubStore.getState().showAuthModal).toBe(true);
  });

  it('keeps the session and persists new tokens when the refresh exchange succeeds', async () => {
    const { useHubStore, refreshWebHubAccessTokenOnce, tokenStorage } = await loadModules();
    await tokenStorage.saveStoredHubRefreshToken('valid-refresh');
    useHubStore.getState().setAuthenticated(true, 'user-1', 'alice');
    refreshMock.mockResolvedValueOnce({
      access_token: 'fresh-access',
      refresh_token: 'fresh-refresh',
      expires_in: 3600,
    });

    const token = await refreshWebHubAccessTokenOnce();

    expect(token).toBe('fresh-access');
    expect(refreshMock).toHaveBeenCalledWith('valid-refresh');
    expect(await tokenStorage.loadStoredHubAccessToken()).toBe('fresh-access');
    expect(await tokenStorage.loadStoredHubRefreshToken()).toBe('fresh-refresh');
    // A successful refresh must not disturb the live session.
    expect(useHubStore.getState().authenticated).toBe(true);
    expect(useHubStore.getState().showAuthModal).toBe(false);
  });

  it('returns null without resetting the session when no refresh token is stored', async () => {
    const { useHubStore, refreshWebHubAccessTokenOnce } = await loadModules();
    useHubStore.getState().setAuthenticated(true, 'user-1', 'alice');

    const token = await refreshWebHubAccessTokenOnce();

    expect(token).toBeNull();
    expect(refreshMock).not.toHaveBeenCalled();
    expect(useHubStore.getState().authenticated).toBe(true);
    expect(useHubStore.getState().showAuthModal).toBe(false);
  });
});

describe('resetWebHubSession (#1816)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('clears stored tokens, resets the hub store, and opens the auth modal', async () => {
    const { useHubStore, resetWebHubSession, tokenStorage } = await loadModules();
    await tokenStorage.saveStoredHubAccessToken('access');
    await tokenStorage.saveStoredHubRefreshToken('refresh');
    useHubStore.getState().setAuthenticated(true, 'user-1', 'alice');

    await resetWebHubSession();

    expect(await tokenStorage.loadStoredHubAccessToken()).toBeNull();
    expect(await tokenStorage.loadStoredHubRefreshToken()).toBeNull();
    expect(useHubStore.getState().authenticated).toBe(false);
    expect(useHubStore.getState().showAuthModal).toBe(true);
  });
});
