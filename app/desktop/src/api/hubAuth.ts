// JWT token management for Hub Server authentication.
// Access tokens stay in memory; refresh tokens use the desktop keyring bridge.

import type { UserProfile } from './hubClient';
import { createHubClient } from './hubClient';
import type { HubClient } from './hubClient';
import { open as openShellUrl } from '@tauri-apps/plugin-shell';
import { TOKENDANCE_LOGIN_URL } from '@/config';
import { clearStoredHubRefreshToken, loadStoredHubRefreshToken, saveStoredHubRefreshToken } from './hubTokenStorage';
import { useHubStore } from '@/stores/hubStore';

const TOKEN_KEY = 'agenthub_hub_token';
const USER_KEY = 'agenthub_hub_user';

export type AuthStatus = 'checking' | 'anonymous' | 'local' | 'authenticated' | 'tokenDancePending' | 'error';
export type CloudLockedReason = 'not_signed_in' | 'hub_unreachable' | 'tokenDance_pending' | 'none';
type TokenSource = 'hub' | 'tokendance' | null;

export interface HubAuthState {
  token: string | null;
  refreshToken: string | null;
  user: UserProfile | null;
  isAuthenticated: boolean;
  authStatus: AuthStatus;
  cloudLockedReason: CloudLockedReason;
  tokenSource: TokenSource;
}

export interface HubAuth {
  getState: () => HubAuthState;
  subscribe: (fn: (state: HubAuthState) => void) => () => void;
  login: (username: string, password: string) => Promise<void>;
  loginWithTokenDance: () => Promise<void>;
  continueLocalMode: () => void;
  logout: () => Promise<void>;
  tryAutoLogin: () => Promise<boolean>;
}

function getStableDeviceId(): string {
  if (typeof localStorage === 'undefined') return makeId('desktop');
  const stored = localStorage.getItem('agenthub_device_id');
  if (stored) return stored;
  const next = makeId('desktop');
  localStorage.setItem('agenthub_device_id', next);
  return next;
}

function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function persistUser(user: UserProfile | null) {
  if (typeof localStorage === 'undefined') return;
  if (!user) {
    localStorage.removeItem(USER_KEY);
    return;
  }
  localStorage.setItem(USER_KEY, JSON.stringify({ userId: user.id, username: user.username }));
}

function clearLegacyTokenStorage() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem('agenthub_hub_refresh');
}

export function createHubAuth(client?: HubClient): HubAuth {
  const hubClient = client || createHubClient();

  const state: HubAuthState = {
    token: null,
    refreshToken: null,
    user: null,
    isAuthenticated: false,
    authStatus: 'checking',
    cloudLockedReason: 'not_signed_in',
    tokenSource: null,
  };

  const listeners = new Set<(s: HubAuthState) => void>();
  let snapshot: HubAuthState = Object.freeze({ ...state });

  function notify() {
    snapshot = Object.freeze({ ...state });
    listeners.forEach((fn) => fn(snapshot));
  }

  function getToken(): string | null {
    return state.token;
  }

  // Rebind client with current token getter
  let authClient = createHubClient({ getToken });

  return {
    getState: () => snapshot,

    subscribe(fn: (s: HubAuthState) => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    async login(username: string, password: string) {
      clearLegacyTokenStorage();
      state.authStatus = 'checking';
      state.cloudLockedReason = 'not_signed_in';
      notify();
      const deviceId = getStableDeviceId();
      const res = await hubClient.login({
        username,
        password,
        device_type: 'desktop',
        device_id: deviceId,
      });

      state.token = res.access_token;
      state.refreshToken = res.refresh_token;
      state.tokenSource = 'hub';
      state.authStatus = 'authenticated';
      state.cloudLockedReason = 'none';
      await saveStoredHubRefreshToken(res.refresh_token);

      // Rebind client so subsequent calls use the new token
      authClient = createHubClient({ getToken });
      try {
        state.user = await authClient.me();
        state.isAuthenticated = true;
        persistUser(state.user);
        // Sync to Zustand store for StatusBar indicator
        useHubStore.getState().setAuthenticated(true, state.user?.id, state.user?.username);
        notify();
      } catch (err) {
        state.token = null;
        state.refreshToken = null;
        state.user = null;
        state.isAuthenticated = false;
        state.authStatus = 'error';
        state.cloudLockedReason = 'hub_unreachable';
        state.tokenSource = null;
        clearLegacyTokenStorage();
        persistUser(null);
        await clearStoredHubRefreshToken();
        useHubStore.getState().clear();
        notify();
        throw err;
      }
    },

    async loginWithTokenDance() {
      state.authStatus = 'tokenDancePending';
      state.cloudLockedReason = 'tokenDance_pending';
      notify();
      if (!TOKENDANCE_LOGIN_URL) {
        throw new Error('TokenDance ID desktop callback is not connected yet.');
      }
      await openShellUrl(TOKENDANCE_LOGIN_URL);
    },

    continueLocalMode() {
      state.token = null;
      state.refreshToken = null;
      state.user = null;
      state.isAuthenticated = false;
      state.authStatus = 'local';
      state.cloudLockedReason = 'not_signed_in';
      state.tokenSource = null;
      clearLegacyTokenStorage();
      useHubStore.getState().setLocalModeSelected(true);
      notify();
    },

    async logout() {
      if (state.token) {
        await authClient.request('/client/auth/logout', { method: 'POST' }).catch(() => {});
      }
      state.token = null;
      state.refreshToken = null;
      state.user = null;
      state.isAuthenticated = false;
      state.authStatus = 'anonymous';
      state.cloudLockedReason = 'not_signed_in';
      state.tokenSource = null;
      clearLegacyTokenStorage();
      persistUser(null);
      await clearStoredHubRefreshToken();
      useHubStore.getState().clear();
      notify();
    },

    async tryAutoLogin() {
      clearLegacyTokenStorage();
      state.authStatus = 'checking';
      state.cloudLockedReason = 'not_signed_in';
      notify();
      state.refreshToken = await loadStoredHubRefreshToken();
      if (!state.refreshToken) {
        state.authStatus = 'anonymous';
        state.cloudLockedReason = 'not_signed_in';
        notify();
        return false;
      }
      try {
        const refreshClient = createHubClient();
        const res = await refreshClient.refresh(state.refreshToken);
        state.token = res.access_token;
        state.refreshToken = res.refresh_token;
        state.tokenSource = 'hub';
        state.authStatus = 'authenticated';
        state.cloudLockedReason = 'none';
        await saveStoredHubRefreshToken(res.refresh_token);
        authClient = createHubClient({ getToken });
        state.user = await authClient.me();
        state.isAuthenticated = true;
        persistUser(state.user);
        useHubStore.getState().setAuthenticated(true, state.user?.id, state.user?.username);
        notify();
        return true;
      } catch {
        state.token = null;
        state.refreshToken = null;
        state.user = null;
        state.isAuthenticated = false;
        state.authStatus = 'error';
        state.cloudLockedReason = 'hub_unreachable';
        state.tokenSource = null;
        clearLegacyTokenStorage();
        persistUser(null);
        await clearStoredHubRefreshToken();
        useHubStore.getState().clear();
        notify();
        return false;
      }
    },
  };
}
