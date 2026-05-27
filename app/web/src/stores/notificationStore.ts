import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export type NotificationType = 'friend_request' | 'agent_task' | 'message' | 'system';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  actionUrl?: string;
}

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (n: Notification) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearAll: () => void;
}

function calcUnread(notifications: Notification[]): number {
  return notifications.filter((n) => !n.read).length;
}

export const useNotificationStore = create<NotificationState>()(
  subscribeWithSelector((set) => ({
    notifications: [],
    unreadCount: 0,

    addNotification: (n) =>
      set((state) => {
        const next = [n, ...state.notifications].slice(0, 100);
        return { notifications: next, unreadCount: calcUnread(next) };
      }),

    markRead: (id) =>
      set((state) => {
        const next = state.notifications.map((n) =>
          n.id === id ? { ...n, read: true } : n,
        );
        return { notifications: next, unreadCount: calcUnread(next) };
      }),

    markAllRead: () =>
      set((state) => {
        const next = state.notifications.map((n) => ({ ...n, read: true }));
        return { notifications: next, unreadCount: 0 };
      }),

    clearAll: () => set({ notifications: [], unreadCount: 0 }),
  })),
);
