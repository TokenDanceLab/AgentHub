import { Runner } from '../api/edgeClient';
import styles from './RunnerList.module.css';

interface Props {
  runners: Runner[];
  online: boolean;
}

function statusClass(status: string): string {
  switch (status) {
    case 'online':
    case 'idle':
      return styles.online;
    case 'offline':
      return styles.offline;
    default:
      return '';
  }
}

export default function RunnerList({ runners, online }: Props) {
  return (
    <div className={styles.sidebar}>
      <div className={styles.title}>Runners</div>
      {runners.length === 0 ? (
        <div className={styles.empty}>
          {online ? 'No runners connected' : 'Waiting for Edge...'}
        </div>
      ) : (
        runners.map((r) => (
          <div key={r.id} className={styles.item}>
            <div className={styles.itemName}>{r.name || r.id}</div>
            <div className={`${styles.itemStatus} ${statusClass(r.status)}`}>
              {r.status}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
