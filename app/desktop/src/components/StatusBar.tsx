import { HealthResponse } from '../api/edgeClient';
import styles from './StatusBar.module.css';

interface Props {
  online: boolean;
  health: HealthResponse | null;
  isConnected: boolean;
  error: string | null;
}

export default function StatusBar({ online, health, isConnected, error }: Props) {
  return (
    <>
      <div className={styles.bar}>
        <span className={`${styles.dot} ${online ? styles.dotOnline : styles.dotOffline}`} />
        <span>
          {online
            ? `Local Edge: Online — ${health?.version ?? 'v1'} (${health?.edgeId ?? '?'})`
            : 'Local Edge: Offline'}
        </span>
        <span className={styles.spacer} />
        <span className={styles.wsStatus}>
          WS: {isConnected ? 'Connected' : '—'}
        </span>
      </div>
      {error && <div className={styles.error}>{error}</div>}
    </>
  );
}
