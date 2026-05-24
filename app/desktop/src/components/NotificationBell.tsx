import { useState, useCallback, useRef, useEffect } from 'react';
import { Bell, UserPlus, Bot, MessageSquare, Info, CheckCheck } from 'lucide-react';
import { useNotificationStore } from '@/stores/notificationStore';
import type { Notification, NotificationType } from '@/stores/notificationStore';
import styles from './NotificationBell.module.css';

const TYPE_ICONS: Record<NotificationType, typeof Bell> = {
  friend_request: UserPlus,
  agent_task: Bot,
  message: MessageSquare,
  system: Info,
};

const TYPE_LABEL: Record<NotificationType, string> = {
  friend_request: 'Friend request',
  agent_task: 'Agent task',
  message: 'Message',
  system: 'System',
};

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = now - then;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const notifications = useNotificationStore((s) => s.notifications);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);

  const containerRef = useRef<HTMLDivElement>(null);

  const toggleOpen = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const recentItems = notifications.slice(0, 10);

  return (
    <div className={styles.wrapper} ref={containerRef}>
      <button
        type="button"
        className={`${styles.bell} ${unreadCount > 0 ? styles.hasUnread : ''}`}
        onClick={toggleOpen}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className={styles.dropdown} role="menu" aria-label="Notifications panel">
          <div className={styles.header}>
            <h3 className={styles.title}>Notifications</h3>
            {unreadCount > 0 && (
              <button
                type="button"
                className={styles.markAllBtn}
                onClick={() => markAllRead()}
              >
                <CheckCheck size={14} />
                Mark all read
              </button>
            )}
          </div>

          <div className={styles.list}>
            {recentItems.length === 0 ? (
              <div className={styles.empty}>
                <Bell size={32} className={styles.emptyIcon} />
                <p>No notifications yet</p>
              </div>
            ) : (
              recentItems.map((item) => (
                <NotificationItem
                  key={item.id}
                  notification={item}
                  onMarkRead={markRead}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationItem({
  notification,
  onMarkRead,
}: {
  notification: Notification;
  onMarkRead: (id: string) => void;
}) {
  const Icon = TYPE_ICONS[notification.type];
  const label = TYPE_LABEL[notification.type];

  return (
    <div
      className={`${styles.item} ${!notification.read ? styles.unread : ''}`}
      role="menuitem"
    >
      <span className={styles.itemIcon} aria-label={label}>
        <Icon size={16} />
      </span>
      <div className={styles.itemBody}>
        <div className={styles.itemHeader}>
          <span className={styles.itemTitle}>{notification.title}</span>
          <span className={styles.itemTime}>
            {formatRelativeTime(notification.createdAt)}
          </span>
        </div>
        <p className={styles.itemText}>{notification.body}</p>
      </div>
      {!notification.read && (
        <button
          type="button"
          className={styles.markReadBtn}
          onClick={() => onMarkRead(notification.id)}
          aria-label="Mark as read"
        >
          <CheckCheck size={14} />
        </button>
      )}
    </div>
  );
}
