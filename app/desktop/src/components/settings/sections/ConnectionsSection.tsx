import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import Panel from '../primitives/Panel';
import ConnectionRow from '../primitives/ConnectionRow';
import styles from '../primitives/primitives.module.css';

interface ConnectionsSectionProps {
  edgeOnline: boolean;
  hubSessionActive: boolean;
  edgeAddress: string;
  healthStatus: string;
  availableRunners: number;
  totalRunners: number;
  onRefresh: () => void;
}

export default function ConnectionsSection({
  edgeOnline,
  hubSessionActive,
  edgeAddress,
  healthStatus,
  availableRunners,
  totalRunners,
  onRefresh,
}: ConnectionsSectionProps) {
  const { t } = useTranslation();
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);

  // Auto-refresh every 30s while mounted
  useEffect(() => {
    mountedRef.current = true;
    const id = setInterval(() => {
      if (mountedRef.current) {
        onRefresh();
      }
    }, 30_000);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [onRefresh]);

  const handleRefresh = () => {
    setRefreshing(true);
    onRefresh();
    setTimeout(() => {
      if (mountedRef.current) {
        setRefreshing(false);
      }
    }, 800);
  };

  const healthIsOk = healthStatus === 'ok' || healthStatus === 'healthy';
  const runnersText = edgeOnline
    ? totalRunners > 0
      ? t('settings.edgeRunnersAvailable', { available: availableRunners, total: totalRunners })
      : t('settings.edgeNoRunners')
    : t('settings.edgeOffline');

  return (
    <Panel title={t('settings.connections')} description={t('settings.connectionsDesc')}>
      <ConnectionRow
        name="Hub"
        description={hubSessionActive ? t('status.hubConnected') : t('status.hubDisconnected')}
        connected={hubSessionActive}
        onlineLabel={t('settings.online')}
        offlineLabel={t('settings.offline')}
      />

      {/* ── Edge connection detail ── */}
      <div className={styles.settingRow}>
        <div className={styles.settingCopy}>
          <strong>{t('settings.edgeLocal')}</strong>
          <span>{edgeAddress}</span>
        </div>
        <span className={`${styles.statusPill} ${edgeOnline ? styles.statusPillOn : ''}`}>
          {edgeOnline ? t('settings.online') : t('settings.offline')}
        </span>
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingCopy}>
          <strong>{t('settings.edgeHealthStatus')}</strong>
          <span>
            {edgeOnline
              ? t('settings.edgeHealthDesc', { status: healthStatus })
              : t('settings.edgeOffline')}
          </span>
        </div>
        <span
          className={`${styles.statusPill} ${
            edgeOnline && healthIsOk ? styles.statusPillOn : ''
          }`}
        >
          {edgeOnline ? healthStatus : t('settings.offline')}
        </span>
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingCopy}>
          <strong>{t('settings.edgeAvailableRunners')}</strong>
          <span>{runnersText}</span>
        </div>
        {edgeOnline && totalRunners > 0 ? (
          <span className={styles.settingValue}>
            {availableRunners}/{totalRunners}
          </span>
        ) : null}
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingCopy}>
          <strong>{t('settings.connectionRefresh')}</strong>
          <span>{t('settings.connectionRefreshDesc')}</span>
        </div>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw size={14} className={refreshing ? styles.spinIcon : undefined} />
          {refreshing ? t('settings.edgeRefreshing') : t('settings.edgeRefresh')}
        </button>
      </div>

      <ConnectionRow
        name="WebSocket"
        description={t('status.wsConnected')}
        connected={edgeOnline}
        onlineLabel={t('settings.online')}
        offlineLabel={t('settings.offline')}
      />
    </Panel>
  );
}
