import { describe, it, expect, beforeEach } from 'vitest';
import { useNotificationStore } from '@/stores/notificationStore';
import type { Notification } from '@/stores/notificationStore';

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'n-1',
    type: 'system',
    title: 'Test',
    body: 'Test body',
    read: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('notificationStore', () => {
  beforeEach(() => {
    useNotificationStore.setState({ notifications: [], unreadCount: 0 });
  });

  // ── addNotification ───────────────────────────────

  it('adds notification to the front of the list', () => {
    const store = useNotificationStore.getState();
    const n1 = makeNotification({ id: 'n-1' });
    const n2 = makeNotification({ id: 'n-2' });
    store.addNotification(n1);
    store.addNotification(n2);
    const { notifications } = useNotificationStore.getState();
    expect(notifications).toHaveLength(2);
    expect(notifications[0].id).toBe('n-2');
    expect(notifications[1].id).toBe('n-1');
  });

  it('increments unreadCount for unread notifications', () => {
    const store = useNotificationStore.getState();
    store.addNotification(makeNotification({ id: 'n-1', read: false }));
    store.addNotification(makeNotification({ id: 'n-2', read: false }));
    expect(useNotificationStore.getState().unreadCount).toBe(2);
  });

  it('does not increment unreadCount for read notifications', () => {
    const store = useNotificationStore.getState();
    store.addNotification(makeNotification({ id: 'n-1', read: true }));
    expect(useNotificationStore.getState().unreadCount).toBe(0);
  });

  it('caps the list at 100 items', () => {
    const store = useNotificationStore.getState();
    for (let i = 0; i < 120; i++) {
      store.addNotification(makeNotification({ id: `n-${i}` }));
    }
    const { notifications } = useNotificationStore.getState();
    expect(notifications).toHaveLength(100);
  });

  // ── markRead ──────────────────────────────────────

  it('marks a single notification as read', () => {
    const store = useNotificationStore.getState();
    store.addNotification(makeNotification({ id: 'n-1', read: false }));
    store.addNotification(makeNotification({ id: 'n-2', read: false }));
    store.markRead('n-1');
    const { notifications, unreadCount } = useNotificationStore.getState();
    expect(notifications.find((n) => n.id === 'n-1')?.read).toBe(true);
    expect(notifications.find((n) => n.id === 'n-2')?.read).toBe(false);
    expect(unreadCount).toBe(1);
  });

  it('markRead is idempotent', () => {
    const store = useNotificationStore.getState();
    store.addNotification(makeNotification({ id: 'n-1', read: false }));
    store.markRead('n-1');
    store.markRead('n-1');
    expect(useNotificationStore.getState().unreadCount).toBe(0);
  });

  // ── markAllRead ───────────────────────────────────

  it('marks all notifications as read', () => {
    const store = useNotificationStore.getState();
    store.addNotification(makeNotification({ id: 'n-1', read: false }));
    store.addNotification(makeNotification({ id: 'n-2', read: false }));
    store.addNotification(makeNotification({ id: 'n-3', read: true }));
    store.markAllRead();
    const { notifications, unreadCount } = useNotificationStore.getState();
    expect(notifications.every((n) => n.read)).toBe(true);
    expect(unreadCount).toBe(0);
  });

  // ── clearAll ──────────────────────────────────────

  it('clears all notifications', () => {
    const store = useNotificationStore.getState();
    store.addNotification(makeNotification({ id: 'n-1' }));
    store.addNotification(makeNotification({ id: 'n-2' }));
    store.clearAll();
    const { notifications, unreadCount } = useNotificationStore.getState();
    expect(notifications).toHaveLength(0);
    expect(unreadCount).toBe(0);
  });

  // ── unreadCount accuracy ──────────────────────────

  it('unreadCount is accurate after mixed operations', () => {
    const store = useNotificationStore.getState();
    store.addNotification(makeNotification({ id: 'n-1', read: false }));
    store.addNotification(makeNotification({ id: 'n-2', read: false }));
    store.addNotification(makeNotification({ id: 'n-3', read: true }));
    expect(useNotificationStore.getState().unreadCount).toBe(2);
    store.markRead('n-1');
    expect(useNotificationStore.getState().unreadCount).toBe(1);
    store.markAllRead();
    expect(useNotificationStore.getState().unreadCount).toBe(0);
  });

  // ── Notification types ────────────────────────────

  it.each(['friend_request', 'agent_task', 'message', 'system'] as const)(
    'supports notification type: %s',
    (type) => {
      const store = useNotificationStore.getState();
      store.addNotification(makeNotification({ id: `n-${type}`, type }));
      const { notifications } = useNotificationStore.getState();
      expect(notifications[0].type).toBe(type);
    },
  );

  // ── actionUrl is preserved ────────────────────────

  it('preserves actionUrl', () => {
    const store = useNotificationStore.getState();
    store.addNotification(
      makeNotification({ id: 'n-1', actionUrl: '/agents/task-1' }),
    );
    const { notifications } = useNotificationStore.getState();
    expect(notifications[0].actionUrl).toBe('/agents/task-1');
  });
});
