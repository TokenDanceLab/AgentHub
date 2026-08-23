// Hub connection/authentication state store.
// Tracks whether the desktop client is authenticated against the Hub server.
// Reads recoverable UI/session hints from localStorage. Access tokens stay in memory.

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

const USER_KEY = 'agenthub_hub_user';
// First-run onboarding gate (#1819). Persisted so the overlay shows once.
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

function getStoredOnboardingSeen(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(ONBOARDING_SEEN_KEY) === 'true';
  } catch {
    return false;
  }
}

function persistOnboardingSeen(value: boolean) {
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
  onboardingSeen: boolean;
  setAuthenticated: (v: boolean, userId?: string | null, username?: string | null) => void;
  setShowAuthModal: (v: boolean) => void;
  setOnboardingSeen: (v: boolean) => void;
  clear: () => void;
}

const initial = getStoredAuth();
const onboardingSeen = getStoredOnboardingSeen();

export const useHubStore = create<HubState>()(
  subscribeWithSelector((set) => ({
    authenticated: initial.authenticated,
    userId: initial.userId,
    username: initial.username,
    showAuthModal: false,
    onboardingSeen,

    setAuthenticated: (v, userId, username) => {
      // Authentication is independent of first-run onboarding (#1819): logging
      // in must not silently mark the onboarding as seen.
      set({ authenticated: v, userId: userId ?? null, username: username ?? null, showAuthModal: false });
    },
    setShowAuthModal: (v) => set({ showAuthModal: v }),
    setOnboardingSeen: (v) => {
      persistOnboardingSeen(v);
      set({ onboardingSeen: v });
    },
    clear: () => set({ authenticated: false, userId: null, username: null, showAuthModal: false }),
  })),
);
