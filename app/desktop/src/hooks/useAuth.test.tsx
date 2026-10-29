import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccessToken, invalidateAccessSession, useAuth } from './useAuth';

const authState = {
  token: 'access-1',
  refreshToken: 'refresh-1',
  user: null,
  isAuthenticated: true,
  tokenSource: 'account' as const,
};

const fakeAuth = {
  getState: vi.fn(() => authState),
  subscribe: vi.fn(() => () => {}),
  loginWithAccount: vi.fn(async () => {}),
  logout: vi.fn(async () => {}),
  invalidate: vi.fn(async () => {}),
  tryAutoLogin: vi.fn(async () => true),
};

vi.mock('@/api/hubAuth', () => ({
  createHubAuth: vi.fn(() => fakeAuth),
}));

describe('useAuth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invalidates only the native session that received revocation', async () => {
    await invalidateAccessSession('retired-access');
    expect(fakeAuth.invalidate).not.toHaveBeenCalled();
    await invalidateAccessSession('access-1');
    expect(fakeAuth.invalidate).toHaveBeenCalledOnce();
    expect(fakeAuth.logout).not.toHaveBeenCalled();
  });

  it('exposes reactive state and delegates session actions to the singleton auth service', async () => {
    const { result } = renderHook(() => useAuth());

    expect(result.current).toMatchObject(authState);
    expect(getAccessToken()).toBe('access-1');

    await act(async () => {
      await result.current.loginWithAccount();
      await result.current.logout();
      await expect(result.current.tryAutoLogin()).resolves.toBe(true);
    });

    expect(fakeAuth.loginWithAccount).toHaveBeenCalledOnce();
    expect(fakeAuth.logout).toHaveBeenCalledOnce();
    expect(fakeAuth.tryAutoLogin).toHaveBeenCalledOnce();
    expect(fakeAuth.subscribe).toHaveBeenCalled();
  });
});
