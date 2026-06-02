import { useTranslation } from 'react-i18next';
import { UserCircle } from 'lucide-react';
import type { FriendRequestInfo } from '@/api/hubClient';
import { formatTimestamp } from '../utils';
import styles from '../../SettingsPage.module.css';

export default function HubFriendRequestRow({ request }: { request: FriendRequestInfo }) {
  const { t } = useTranslation();
  return (
    <div className={styles.taskRow}>
      <div className={styles.connectionIcon}>
        <UserCircle size={17} />
      </div>
      <div className={styles.settingCopy}>
        <strong>{request.nickname || request.username || request.user_id}</strong>
        <span>{request.message || t('settings.onlineImFriendRequestNoMessage')}</span>
        <div className={styles.taskMeta}>
          <span>{t('settings.onlineImFriendRequests')}</span>
          <span>{request.user_id}</span>
          <span>{formatTimestamp(request.created_at)}</span>
        </div>
      </div>
      <span className={styles.statusPill}>{t('settings.readOnly')}</span>
    </div>
  );
}
