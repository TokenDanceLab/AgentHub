// Hub connection/authentication state store.
// Tracks whether the desktop client is authenticated against the Hub server.
// Reads recoverable UI/session hints from localStorage. Access tokens stay in memory.

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

const USER_KEY = 'agenthub_hub_user';
const ONBOARDING_SEEN_KEY = 'agenthub_onboarding_seen';

function getStoredAuth(): { authenticated: boolean; userId: string | null; username: string | null } {
  try {
    const userRaw = typeof localStorage !== 'undefined' ? localStorage.getItem(USER_KEY) : null;
    const user = userRaw ? JSON.parse(userRaw) : null;
    return {
      authenticated: false,
      userId: user?.userId ?? null,
      username: user?.username ?? null,
    };
  } catch {
    return { authenticated: false, userId: null, username: null };
  }
}

function getStoredLocalModeSelected(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(ONBOARDING_SEEN_KEY) === 'true';
  } catch {
    return false;
  }
}

function persistLocalModeSelected(value: boolean) {
  try {
    if (typeof localStorage !== 'undefined') {
      if (value) localStorage.setItem(ONBOARDING_SEEN_KEY, 'true');
      else localStorage.removeItem(ONBOARDING_SEEN_KEY);
    }
  } catch { /* ignore */ }
}

interface HubState {
  authenticated: boolean;
  userId: string | null;
  username: string | null;
  showAuthModal: boolean;
  localModeSelected: boolean;
  setAuthenticated: (v: boolean, userId?: string | null, username?: string | null) => void;
  setShowAuthModal: (v: boolean) => void;
  setLocalModeSelected: (v: boolean) => void;
  clear: () => void;
}

const initial = getStoredAuth();
const localModeSelected = getStoredLocalModeSelected();

export const useHubStore = create<HubState>()(
  subscribeWithSelector((set) => ({
    authenticated: initial.authenticated,
    userId: initial.userId,
    username: initial.username,
    showAuthModal: false,
    localModeSelected,

    setAuthenticated: (v, userId, username) => {
      if (v) persistLocalModeSelected(true);
      set({ authenticated: v, userId: userId ?? null, username: username ?? null, showAuthModal: false, localModeSelected: v || getStoredLocalModeSelected() });
    },
    setShowAuthModal: (v) => set({ showAuthModal: v }),
    setLocalModeSelected: (v) => {
      persistLocalModeSelected(v);
      set({ localModeSelected: v });
    },
    clear: () => set({ authenticated: false, userId: null, username: null, showAuthModal: false }),
  })),
);
