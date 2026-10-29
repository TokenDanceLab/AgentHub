// Hub connection/authentication state store.
// Tracks whether the web client is authenticated against the Hub server.
// Hydration always starts anonymous; only the server session can authenticate it.

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

const USER_KEY = 'agenthub_hub_user';

function getStoredAuth(): { authenticated: boolean; userId: string | null; username: string | null } {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(USER_KEY);
    }
    sessionStorage.removeItem(USER_KEY);
  } catch {
    /* storage disabled */
  }
  return { authenticated: false, userId: null, username: null };
}

function clearStoredUser(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(USER_KEY);
    }
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.removeItem(USER_KEY);
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
      clearStoredUser();
      set({ authenticated: v, userId: nextUserId, username: nextUsername, showAuthModal: false });
    },
    setShowAuthModal: (v) => set({ showAuthModal: v }),
    clear: () => {
      clearStoredUser();
      set({ authenticated: false, userId: null, username: null, showAuthModal: false });
    },
  })),
);
