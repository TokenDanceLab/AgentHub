import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { getAccessToken, useAuth } from './useAuth';
import { clearStoredHubAccessToken, clearStoredHubRefreshToken } from '@/api/hubTokenStorage';

describe('useAuth hook boundary', () => {
  beforeEach(async () => {
    sessionStorage.clear();
    localStorage.clear();
    await clearStoredHubAccessToken();
    await clearStoredHubRefreshToken();
  });

  it('exposes the singleton auth state and command callbacks', async () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.token).toBeNull();
    expect(getAccessToken()).toBeNull();

    await act(async () => {
      await result.current.logout();
      await expect(result.current.tryAutoLogin()).resolves.toBe(false);
    });
    expect(result.current.isAuthenticated).toBe(false);
  });
});
