import { useState, useCallback, useRef, useEffect } from 'react';
import { Bell, UserPlus, Bot, MessageSquare, Info, CheckCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ActivityCard, EmptyState } from '@shared/ui';
import { useNotificationStore } from '@/stores/notificationStore';
import type { Notification, NotificationType } from '@/stores/notificationStore';
import styles from './NotificationBell.module.css';

const TYPE_ICONS: Record<NotificationType, typeof Bell> = {
  friend_request: UserPlus,
  agent_task: Bot,
  message: MessageSquare,
  system: Info,
};

const TYPE_LABEL_KEYS: Record<NotificationType, string> = {
  friend_request: 'notification.type.friendRequest',
  agent_task: 'notification.type.agentTask',
  message: 'notification.type.message',
  system: 'notification.type.system',
};

function formatRelativeTime(iso: string, t: ReturnType<typeof useTranslation>['t']): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = now - then;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return t('time.justNow');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('time.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('time.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t('time.daysAgo', { count: days });
  return new Date(iso).toLocaleDateString();
}

export function NotificationBell() {
  const { t } = useTranslation();
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
        aria-label={unreadCount > 0 ? t('notification.bellUnread', { count: unreadCount }) : t('notification.bell')}
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className={styles.dropdown} role="menu" aria-label={t('notification.panel')}>
          <div className={styles.header}>
            <h3 className={styles.title}>{t('notification.title')}</h3>
            {unreadCount > 0 && (
              <button
                type="button"
                className={styles.markAllBtn}
                onClick={() => markAllRead()}
              >
                <CheckCheck size={14} />
                {t('notification.markAllRead')}
              </button>
            )}
          </div>

          <div className={styles.list}>
            {recentItems.length === 0 ? (
              <EmptyState
                className={styles.empty ?? ''}
                iconClassName={styles.emptyIcon ?? ''}
                titleClassName={styles.emptyTitle ?? ''}
                descriptionClassName={styles.emptyDescription ?? ''}
                icon={<Bell size={20} />}
                title={t('notification.emptyTitle')}
                description={t('notification.emptyDescription')}
                titleLevel={3}
              />
            ) : (
              recentItems.map((item) => (
                <NotificationItem
                  key={item.id}
                  notification={item}
                  onMarkRead={markRead}
                  t={t}
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
  t,
}: {
  notification: Notification;
  onMarkRead: (id: string) => void;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const Icon = TYPE_ICONS[notification.type];
  const label = t(TYPE_LABEL_KEYS[notification.type]);

  return (
    <div
      className={`${styles.item} ${!notification.read ? styles.unread : ''}`}
      role="menuitem"
    >
      <ActivityCard
        className={styles.itemCard ?? ''}
        iconClassName={styles.itemIcon ?? ''}
        bodyClassName={styles.itemBody ?? ''}
        metaClassName={styles.itemHeader ?? ''}
        labelClassName={styles.itemTitle ?? ''}
        contentClassName={styles.itemText ?? ''}
        actionsClassName={styles.itemActions ?? ''}
        icon={<Icon size={16} aria-label={label} />}
        label={notification.title}
        meta={<span className={styles.itemTime}>{formatRelativeTime(notification.createdAt, t)}</span>}
        contentAs="div"
        actions={!notification.read ? (
          <button
            type="button"
            className={styles.markReadBtn}
            onClick={() => onMarkRead(notification.id)}
            aria-label={t('notification.markRead')}
          >
            <CheckCheck size={14} />
          </button>
        ) : undefined}
      >
        {notification.body}
      </ActivityCard>
    </div>
  );
}
