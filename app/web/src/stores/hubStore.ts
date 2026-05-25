// Hub connection/authentication state store.
// Tracks whether the web client is authenticated against the Hub server.
// Sensitive Hub tokens are tab-scoped in sessionStorage; legacy localStorage
// auth keys are cleared by the auth storage layer.

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

const TOKEN_KEY = 'agenthub_hub_token';
const USER_KEY = 'agenthub_hub_user';

function getStoredAuth(): { authenticated: boolean; userId: string | null; username: string | null } {
  const token = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(TOKEN_KEY) : null;
  if (!token) return { authenticated: false, userId: null, username: null };
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(USER_KEY);
    }
    const userRaw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(USER_KEY) : null;
    const user = userRaw ? JSON.parse(userRaw) : null;
    return {
      authenticated: true,
      userId: user?.userId ?? null,
      username: user?.username ?? null,
    };
  } catch {
    return { authenticated: true, userId: null, username: null };
  }
}

function saveStoredUser(userId: string | null, username: string | null): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(USER_KEY);
    }
    if (typeof sessionStorage === 'undefined') return;
    if (userId || username) {
      sessionStorage.setItem(USER_KEY, JSON.stringify({ userId, username }));
    } else {
      sessionStorage.removeItem(USER_KEY);
    }
  } catch {
    /* storage disabled */
  }
}

interface HubState {
  authenticated: boolean;
  userId: string | null;
  username: string | null;
  showAuthModal: boolean;
  setAuthenticated: (v: boolean, userId?: string | null, username?: string | null) => void;
  setShowAuthModal: (v: boolean) => void;
  clear: () => void;
}

const initial = getStoredAuth();

export const useHubStore = create<HubState>()(
  subscribeWithSelector((set) => ({
    authenticated: initial.authenticated,
    userId: initial.userId,
    username: initial.username,
    showAuthModal: false,

    setAuthenticated: (v, userId, username) => {
      const nextUserId = userId ?? null;
      const nextUsername = username ?? null;
      saveStoredUser(nextUserId, nextUsername);
      set({ authenticated: v, userId: nextUserId, username: nextUsername, showAuthModal: false });
    },
    setShowAuthModal: (v) => set({ showAuthModal: v }),
    clear: () => {
      saveStoredUser(null, null);
      set({ authenticated: false, userId: null, username: null, showAuthModal: false });
    },
  })),
);
