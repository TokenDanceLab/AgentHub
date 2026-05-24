import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

interface PresenceState {
  onlineUsers: Set<string>;
  setOnline: (userId: string) => void;
  setOffline: (userId: string) => void;
  isOnline: (userId: string) => boolean;
  updateFromHub: (users: string[]) => void;
}

export const usePresenceStore = create<PresenceState>()(
  subscribeWithSelector((set, get) => ({
    onlineUsers: new Set<string>(),

    setOnline: (userId) =>
      set((state) => {
        const next = new Set(state.onlineUsers);
        next.add(userId);
        return { onlineUsers: next };
      }),

    setOffline: (userId) =>
      set((state) => {
        const next = new Set(state.onlineUsers);
        next.delete(userId);
        return { onlineUsers: next };
      }),

    isOnline: (userId) => get().onlineUsers.has(userId),

    updateFromHub: (users) =>
      set({ onlineUsers: new Set(users) }),
  })),
);
