import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HubAuth, HubAuthState } from '@/api/hubAuth';

const authHarness = vi.hoisted(() => {
  let state: HubAuthState = {
    token: null,
    refreshToken: null,
    user: null,
    isAuthenticated: false,
    tokenSource: null,
  };
  const listeners = new Set<(next: HubAuthState) => void>();

  const api: HubAuth = {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    loginWithTokenDance: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
    tryAutoLogin: vi.fn(async () => false),
  };

  return {
    api,
    setState(next: Partial<HubAuthState>) {
      state = { ...state, ...next };
      listeners.forEach((fn) => fn(state));
    },
    reset() {
      state = {
        token: null,
        refreshToken: null,
        user: null,
        isAuthenticated: false,
        tokenSource: null,
      };
      listeners.clear();
      vi.mocked(api.loginWithTokenDance).mockClear();
      vi.mocked(api.logout).mockClear();
      vi.mocked(api.tryAutoLogin).mockClear();
    },
  };
});

vi.mock('@/api/hubAuth', () => ({
  createHubAuth: () => authHarness.api,
}));

describe('useAuth', () => {
  beforeEach(() => {
    authHarness.reset();
  });

  it('exposes reactive auth state through useSyncExternalStore', async () => {
    const { useAuth, getAccessToken } = await import('./useAuth');
    const { result } = renderHook(() => useAuth());

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.token).toBeNull();
    expect(getAccessToken()).toBeNull();

    act(() => {
      authHarness.setState({
        token: 'hub-access',
        isAuthenticated: true,
        tokenSource: 'tokendance',
        user: {
          id: 'user-1',
          username: 'alice',
          nickname: 'Alice',
          avatar_url: '',
        },
      });
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.token).toBe('hub-access');
    expect(result.current.user?.username).toBe('alice');
    expect(getAccessToken()).toBe('hub-access');
  });

  it('delegates login/logout/auto-login to the Hub auth singleton', async () => {
    vi.mocked(authHarness.api.tryAutoLogin).mockResolvedValueOnce(true);
    const { useAuth } = await import('./useAuth');
    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.loginWithTokenDance();
      await result.current.logout();
      await expect(result.current.tryAutoLogin()).resolves.toBe(true);
    });

    expect(authHarness.api.loginWithTokenDance).toHaveBeenCalledTimes(1);
    expect(authHarness.api.logout).toHaveBeenCalledTimes(1);
    expect(authHarness.api.tryAutoLogin).toHaveBeenCalledTimes(1);
  });

  it('returns null access token when signed out (fail-closed for Hub calls)', async () => {
    const { getAccessToken } = await import('./useAuth');
    authHarness.setState({ token: null, isAuthenticated: false });
    expect(getAccessToken()).toBeNull();
  });
});
