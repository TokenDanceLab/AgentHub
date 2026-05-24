// Hub connection/authentication state store.
// Tracks whether the desktop client is authenticated against the Hub server.
// Reads initial state from localStorage (keys set by hubAuth.ts).

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

const TOKEN_KEY = 'agenthub_hub_token';
const USER_KEY = 'agenthub_hub_user';

function getStoredAuth(): { authenticated: boolean; userId: string | null; username: string | null } {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
  if (!token) return { authenticated: false, userId: null, username: null };
  try {
    const userRaw = typeof localStorage !== 'undefined' ? localStorage.getItem(USER_KEY) : null;
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

interface HubState {
  authenticated: boolean;
  userId: string | null;
  username: string | null;
  setAuthenticated: (v: boolean, userId?: string | null, username?: string | null) => void;
  clear: () => void;
}

const initial = getStoredAuth();

export const useHubStore = create<HubState>()(
  subscribeWithSelector((set) => ({
    authenticated: initial.authenticated,
    userId: initial.userId,
    username: initial.username,

    setAuthenticated: (v, userId, username) =>
      set({ authenticated: v, userId: userId ?? null, username: username ?? null }),
    clear: () => set({ authenticated: false, userId: null, username: null }),
  })),
);
