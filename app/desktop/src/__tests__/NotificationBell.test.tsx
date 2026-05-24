import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { NotificationBell } from '@/components/NotificationBell';
import { useNotificationStore } from '@/stores/notificationStore';
import type { Notification } from '@/stores/notificationStore';

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'n-1',
    type: 'system',
    title: 'Test notification',
    body: 'This is a test body',
    read: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('NotificationBell', () => {
  beforeEach(() => {
    useNotificationStore.setState({ notifications: [], unreadCount: 0 });
  });

  // ── Basic rendering ───────────────────────────────

  it('renders a bell button', () => {
    render(<NotificationBell />);
    expect(screen.getByLabelText('Notifications')).toBeInTheDocument();
  });

  it('shows badge when there are unread notifications', () => {
    useNotificationStore.getState().addNotification(
      makeNotification({ id: 'n-1', read: false }),
    );
    render(<NotificationBell />);
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('does not show badge when no unread notifications', () => {
    render(<NotificationBell />);
    expect(screen.queryByText('1')).toBeNull();
  });

  it('shows "99+" when unread count exceeds 99', () => {
    const store = useNotificationStore.getState();
    for (let i = 0; i < 100; i++) {
      store.addNotification(makeNotification({ id: `n-${i}`, read: false }));
    }
    render(<NotificationBell />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  // ── Dropdown open/close ───────────────────────────

  it('opens dropdown on bell click', () => {
    useNotificationStore.getState().addNotification(
      makeNotification({ id: 'n-1' }),
    );
    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText(/Notifications/));
    expect(screen.getByText('Notifications')).toBeInTheDocument();
  });

  it('closes dropdown on second bell click', () => {
    useNotificationStore.getState().addNotification(
      makeNotification({ id: 'n-1' }),
    );
    render(<NotificationBell />);
    const bell = screen.getByLabelText(/Notifications/);
    fireEvent.click(bell);
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    fireEvent.click(bell);
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
  });

  it('closes dropdown on Escape key', () => {
    useNotificationStore.getState().addNotification(
      makeNotification({ id: 'n-1' }),
    );
    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText(/Notifications/));
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
  });

  it('closes dropdown on outside click', () => {
    useNotificationStore.getState().addNotification(
      makeNotification({ id: 'n-1' }),
    );
    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText(/Notifications/));
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
  });

  // ── Notification items in dropdown ────────────────

  it('shows notification title and body in dropdown', () => {
    useNotificationStore.getState().addNotification(
      makeNotification({ id: 'n-1', title: 'Hello', body: 'World' }),
    );
    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText(/Notifications/));
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('World')).toBeInTheDocument();
  });

  it('shows relative time in dropdown', () => {
    useNotificationStore.getState().addNotification(
      makeNotification({ id: 'n-1', createdAt: new Date().toISOString() }),
    );
    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText(/Notifications/));
    expect(screen.getByText('just now')).toBeInTheDocument();
  });

  it('shows type icon for each notification type', () => {
    const store = useNotificationStore.getState();
    store.addNotification(makeNotification({ id: 'fn', type: 'friend_request', title: 'Friend' }));
    store.addNotification(makeNotification({ id: 'at', type: 'agent_task', title: 'Task' }));
    store.addNotification(makeNotification({ id: 'msg', type: 'message', title: 'Msg' }));
    store.addNotification(makeNotification({ id: 'sys', type: 'system', title: 'Sys' }));
    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText(/Notifications/));
    expect(screen.getByLabelText('Friend request')).toBeInTheDocument();
    expect(screen.getByLabelText('Agent task')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeInTheDocument();
    expect(screen.getByLabelText('System')).toBeInTheDocument();
  });

  it('shows mark read button on unread items', () => {
    useNotificationStore.getState().addNotification(
      makeNotification({ id: 'n-1', read: false }),
    );
    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText(/Notifications \(1 unread\)/));
    expect(screen.getByLabelText('Mark as read')).toBeInTheDocument();
  });

  // ── Empty state ───────────────────────────────────

  it('shows empty state when there are no notifications', () => {
    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText('Notifications'));
    expect(screen.getByText('No notifications yet')).toBeInTheDocument();
  });

  // ── markRead action ───────────────────────────────

  it('markRead button marks notification as read', () => {
    useNotificationStore.getState().addNotification(
      makeNotification({ id: 'n-1', read: false }),
    );
    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText(/Notifications \(1 unread\)/));
    fireEvent.click(screen.getByLabelText('Mark as read'));
    const { notifications } = useNotificationStore.getState();
    expect(notifications[0].read).toBe(true);
  });

  // ── markAllRead action ────────────────────────────

  it('markAllRead button marks all notifications as read', () => {
    const store = useNotificationStore.getState();
    store.addNotification(makeNotification({ id: 'n-1', read: false }));
    store.addNotification(makeNotification({ id: 'n-2', read: false }));
    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText(/Notifications \(2 unread\)/));
    fireEvent.click(screen.getByText('Mark all read'));
    const { notifications, unreadCount } = useNotificationStore.getState();
    expect(notifications.every((n) => n.read)).toBe(true);
    expect(unreadCount).toBe(0);
  });

  // ── Max 10 recent items ───────────────────────────

  it('shows at most 10 recent notifications', () => {
    const store = useNotificationStore.getState();
    for (let i = 0; i < 15; i++) {
      store.addNotification(
        makeNotification({ id: `n-${i}`, title: `Title ${i}` }),
      );
    }
    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText(/Notifications/));
    // Items are prepended: newest (Title 14) first, oldest (Title 0) last.
    // slice(0, 10) shows Title 14 down to Title 5 — only 10 items.
    expect(screen.getByText('Title 14')).toBeInTheDocument();
    expect(screen.getByText('Title 5')).toBeInTheDocument();
    expect(screen.queryByText('Title 4')).toBeNull();
    expect(screen.queryByText('Title 0')).toBeNull();
  });

  // ── actionUrl ─────────────────────────────────────

  it('renders notification with actionUrl', () => {
    useNotificationStore.getState().addNotification(
      makeNotification({
        id: 'n-1',
        title: 'Task done',
        body: 'Your task completed',
        actionUrl: '/agents/task-1',
      }),
    );
    render(<NotificationBell />);
    fireEvent.click(screen.getByLabelText(/Notifications/));
    expect(screen.getByText('Task done')).toBeInTheDocument();
    expect(screen.getByText('Your task completed')).toBeInTheDocument();
  });
});
