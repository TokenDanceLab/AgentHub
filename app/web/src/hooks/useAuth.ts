// React hook wrapping createHubAuth() for use in components.
// Provides reactive auth state backed by the server-owned browser session.

import { useSyncExternalStore, useCallback } from 'react';
import { createHubAuth } from '@/api/hubAuth';
import type { HubAuthState } from '@/api/hubAuth';
import { onBrowserSessionInvalidated } from '@/api/browserSessionRuntime';

let singleton: ReturnType<typeof createHubAuth> | null = null;

function getAuth() {
  if (!singleton) {
    singleton = createHubAuth();
    onBrowserSessionInvalidated(() => singleton?.invalidate());
  }
  return singleton;
}

export function useAuth() {
  const auth = getAuth();

  const state = useSyncExternalStore(
    auth.subscribe,
    auth.getState,
  );

  const loginWithAccount = useCallback(async () => {
    await auth.loginWithAccount();
  }, [auth]);

  const logout = useCallback(async () => {
    await auth.logout();
  }, [auth]);
  const logoutAccount = useCallback(async () => { await auth.logoutAccount(); }, [auth]);

  const tryAutoLogin = useCallback(async () => {
    return auth.tryAutoLogin();
  }, [auth]);

  return { ...state, loginWithAccount, logout, logoutAccount, tryAutoLogin } as HubAuthState & {
    loginWithAccount: () => Promise<void>;
    logout: () => Promise<void>;
    logoutAccount: () => Promise<void>;
    tryAutoLogin: () => Promise<boolean>;
  };
}

export function getAccessToken(): string | null {
  return null;
}

export function isHubAuthenticated(): boolean { return getAuth().getState().isAuthenticated; }
