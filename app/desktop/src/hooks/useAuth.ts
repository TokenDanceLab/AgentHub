// React hook wrapping createHubAuth() for use in components.
// Provides reactive auth state (login/register/logout/autoLogin) backed by JWT tokens.

import { useSyncExternalStore, useCallback, useMemo } from 'react';
import { createHubAuth } from '@/api/hubAuth';
import type { HubAuthState } from '@/api/hubAuth';

let singleton: ReturnType<typeof createHubAuth> | null = null;

function getAuth() {
  if (!singleton) singleton = createHubAuth();
  return singleton;
}

export function useAuth() {
  const auth = getAuth();

  const state = useSyncExternalStore(
    auth.subscribe,
    auth.getState,
  );

  const login = useCallback(
    async (username: string, password: string) => {
      await auth.login(username, password);
    },
    [],
  );

  const logout = useCallback(async () => {
    await auth.logout();
  }, []);

  const tryAutoLogin = useCallback(async () => {
    return auth.tryAutoLogin();
  }, []);

  return useMemo(
    () => ({ ...state, login, logout, tryAutoLogin }),
    [state.token, state.isAuthenticated, state.user, login, logout, tryAutoLogin],
  );
}

export function getAccessToken(): string | null {
  return getAuth().getState().token;
}
