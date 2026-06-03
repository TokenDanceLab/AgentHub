import { useTranslation } from 'react-i18next';
import { MessageSquareText } from 'lucide-react';
import type { Session } from '@/api/hubClient';
import { shortId, formatTimestamp } from '../utils';
import styles from '../primitives/primitives.module.css';

function sessionIdOfSettings(session: Session) {
  return session.session_id ?? session.id ?? 'session';
}

export default function HubSessionRow({ session }: { session: Session }) {
  const { t } = useTranslation();
  const sessionId = sessionIdOfSettings(session);
  const timestamp = session.last_message_at ?? session.updated_at ?? session.created_at;
  return (
    <div className={styles.taskRow}>
      <div className={styles.connectionIcon}>
        <MessageSquareText size={17} />
      </div>
      <div className={styles.settingCopy}>
        <strong>{session.name || shortId(sessionId)}</strong>
        <span>{sessionId}</span>
        <div className={styles.taskMeta}>
          <span>{session.type}</span>
          <span>{t('settings.memberCount', { count: session.member_count ?? session.members?.length ?? 0 })}</span>
          <span>{formatTimestamp(timestamp)}</span>
        </div>
      </div>
      <span className={`${styles.statusPill} ${styles.statusPillOn}`}>
        {t('settings.enabled')}
      </span>
    </div>
  );
}
