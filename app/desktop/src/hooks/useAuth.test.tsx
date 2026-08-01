import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccessToken, useAuth } from './useAuth';

const authState = {
  token: 'access-1',
  refreshToken: 'refresh-1',
  user: null,
  isAuthenticated: true,
  tokenSource: 'tokendance' as const,
};

const fakeAuth = {
  getState: vi.fn(() => authState),
  subscribe: vi.fn(() => () => {}),
  loginWithTokenDance: vi.fn(async () => {}),
  logout: vi.fn(async () => {}),
  tryAutoLogin: vi.fn(async () => true),
};

vi.mock('@/api/hubAuth', () => ({
  createHubAuth: vi.fn(() => fakeAuth),
}));

describe('useAuth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exposes reactive state and delegates session actions to the singleton auth service', async () => {
    const { result } = renderHook(() => useAuth());

    expect(result.current).toMatchObject(authState);
    expect(getAccessToken()).toBe('access-1');

    await act(async () => {
      await result.current.loginWithTokenDance();
      await result.current.logout();
      await expect(result.current.tryAutoLogin()).resolves.toBe(true);
    });

    expect(fakeAuth.loginWithTokenDance).toHaveBeenCalledOnce();
    expect(fakeAuth.logout).toHaveBeenCalledOnce();
    expect(fakeAuth.tryAutoLogin).toHaveBeenCalledOnce();
    expect(fakeAuth.subscribe).toHaveBeenCalled();
  });
});
