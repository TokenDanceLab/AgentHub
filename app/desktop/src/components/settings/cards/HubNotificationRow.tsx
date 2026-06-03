import { useTranslation } from 'react-i18next';
import { Globe2 } from 'lucide-react';
import type { HubNotification } from '@/api/hubClient';
import { formatTimestamp, parseNotificationPayload } from '../utils';
import styles from '../primitives/primitives.module.css';

export default function HubNotificationRow({ notification }: { notification: HubNotification }) {
  const { t } = useTranslation();
  const payload = parseNotificationPayload(notification.payload);
  const title = payload.title || payload.subject || notification.type || notification.id;
  const body =
    payload.content ||
    payload.message ||
    payload.text ||
    payload.body ||
    t('settings.onlineImNotificationNoBody');
  return (
    <div className={styles.taskRow}>
      <div className={styles.connectionIcon}>
        <Globe2 size={17} />
      </div>
      <div className={styles.settingCopy}>
        <strong>{title}</strong>
        <span>{body}</span>
        <div className={styles.taskMeta}>
          <span>{notification.read ? t('settings.onlineImNotificationRead') : t('settings.onlineImNotificationUnread')}</span>
          <span>{notification.type || t('settings.onlineImNotifications')}</span>
          <span>{formatTimestamp(notification.created_at)}</span>
        </div>
      </div>
      <span className={styles.statusPill}>{t('settings.readOnly')}</span>
    </div>
  );
}
