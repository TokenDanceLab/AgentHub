import { useTranslation } from 'react-i18next';
import type { HealthResponse } from '@shared/types';
import styles from './StatusBar.module.css';

interface Props {
  online: boolean;
  health: HealthResponse | null;
  isConnected: boolean;
  error: string | null;
}

export default function StatusBar({ online, health, isConnected, error }: Props) {
  const { t } = useTranslation();

  return (
    <>
      <div className={styles.bar} role="status" aria-atomic="true">
        <span
          className={`${styles.dot} ${online ? styles.dotOnline : styles.dotOffline}`}
          aria-hidden="true"
          data-testid={online ? 'status-dot-online' : 'status-dot-offline'}
        />
        <span>
          {online
            ? t('status.online', { version: health?.version ?? 'v1', edgeId: health?.edgeId ?? '?' })
            : t('status.offline')}
        </span>
        <span className={styles.spacer} />
        <span className={styles.wsStatus} aria-label={isConnected ? t('status.wsConnected') : t('status.wsDisconnected')}>
          {isConnected ? t('status.wsConnected') : t('status.wsDisconnected')}
        </span>
      </div>
      {error && <div className={styles.error} role="alert">{error}</div>}
    </>
  );
}
