import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, WifiOff, RefreshCw } from 'lucide-react';
import styles from './ConnectionStatus.module.css';

interface Props {
  isConnected: boolean;
  isReconnecting: boolean;
  onReconnect: () => void;
}

export default memo(function ConnectionStatus({ isConnected, isReconnecting, onReconnect }: Props) {
  const { t } = useTranslation();

  const handleReconnect = useCallback(() => {
    onReconnect();
  }, [onReconnect]);

  // Hidden when fully connected
  if (isConnected && !isReconnecting) {
    return null;
  }

  return (
    <div className={styles.bar} role="status" aria-live="polite">
      <div className={styles.content}>
        {isReconnecting ? (
          <>
            <Loader2 size={14} className={styles.spinner} aria-hidden="true" />
            <span className={styles.text}>{t('connectionStatus.reconnecting')}</span>
          </>
        ) : (
          <>
            <WifiOff size={14} className={styles.icon} aria-hidden="true" />
            <span className={styles.text}>{t('connectionStatus.disconnected')}</span>
            <button
              type="button"
              className={styles.reconnectBtn}
              onClick={handleReconnect}
            >
              <RefreshCw size={12} aria-hidden="true" />
              <span>{t('connectionStatus.reconnect')}</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
});
