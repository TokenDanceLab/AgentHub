// JWT token management for Hub Server authentication.
// Handles login, logout, token refresh, and localStorage persistence.

import type { UserProfile } from './hubClient';
import { createHubClient } from './hubClient';
import type { HubClient } from './hubClient';

const TOKEN_KEY = 'agenthub_hub_token';
const REFRESH_KEY = 'agenthub_hub_refresh';

export interface HubAuthState {
  token: string | null;
  refreshToken: string | null;
  user: UserProfile | null;
  isAuthenticated: boolean;
}

export interface HubAuth {
  getState: () => HubAuthState;
  subscribe: (fn: (state: HubAuthState) => void) => () => void;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  tryAutoLogin: () => Promise<boolean>;
}

export function createHubAuth(client?: HubClient): HubAuth {
  const hubClient = client || createHubClient();

  const state: HubAuthState = {
    token: typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null,
    refreshToken: typeof localStorage !== 'undefined' ? localStorage.getItem(REFRESH_KEY) : null,
    user: null,
    isAuthenticated: false,
  };

  const listeners = new Set<(s: HubAuthState) => void>();

  function notify() {
    const snapshot: HubAuthState = { ...state };
    listeners.forEach((fn) => fn(snapshot));
  }

  function getToken(): string | null {
    return state.token;
  }

  // Rebind client with current token getter
  let authClient = createHubClient({ getToken });

  return {
    getState: () => ({ ...state }),

    subscribe(fn: (s: HubAuthState) => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    async login(username: string, password: string) {
      const deviceId = `desktop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const res = await hubClient.login({
        username,
        password,
        device_type: 'desktop',
        device_id: deviceId,
      });

      state.token = res.access_token;
      state.refreshToken = res.refresh_token;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(TOKEN_KEY, res.access_token);
        localStorage.setItem(REFRESH_KEY, res.refresh_token);
      }

      // Rebind client so subsequent calls use the new token
      authClient = createHubClient({ getToken });
      state.user = await authClient.me();
      state.isAuthenticated = true;
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
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(REFRESH_KEY);
      }
      notify();
    },

    async tryAutoLogin() {
      if (!state.token) return false;
      authClient = createHubClient({ getToken });
      try {
        state.user = await authClient.me();
        state.isAuthenticated = true;
        notify();
        return true;
      } catch {
        // Token expired, try refresh
        if (state.refreshToken) {
          try {
            const refreshClient = createHubClient();
            const res = await refreshClient.refresh(state.refreshToken);
            state.token = res.access_token;
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem(TOKEN_KEY, res.access_token);
            }
            authClient = createHubClient({ getToken });
            state.user = await authClient.me();
            state.isAuthenticated = true;
            notify();
            return true;
          } catch {
            // refresh also failed
          }
        }
        state.token = null;
        state.refreshToken = null;
        state.user = null;
        state.isAuthenticated = false;
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(REFRESH_KEY);
        }
        notify();
        return false;
      }
    },
  };
}
