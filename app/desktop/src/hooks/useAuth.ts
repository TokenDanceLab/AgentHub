// React hook wrapping createHubAuth() for use in components.
// Provides reactive auth state (TokenDance ID login/logout/autoLogin) backed by JWT tokens.

import { useSyncExternalStore, useCallback } from 'react';
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

  const loginWithTokenDance = useCallback(async () => {
    await auth.loginWithTokenDance();
  }, [auth]);

  const logout = useCallback(async () => {
    await auth.logout();
  }, [auth]);

  const tryAutoLogin = useCallback(async () => {
    return auth.tryAutoLogin();
  }, [auth]);

  return { ...state, loginWithTokenDance, logout, tryAutoLogin } as HubAuthState & {
    loginWithTokenDance: () => Promise<void>;
    logout: () => Promise<void>;
    tryAutoLogin: () => Promise<boolean>;
  };
}

export function getAccessToken(): string | null {
  return getAuth().getState().token;
}
