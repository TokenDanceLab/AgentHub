import { useTranslation } from 'react-i18next';
import type { Runner } from '@shared/types';
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
  const { t } = useTranslation();

  return (
    <nav className={styles.sidebar} aria-label={t('runner.title')}>
      <div className={styles.title}>{t('runner.title')}</div>
      {runners.length === 0 ? (
        <div className={styles.empty}>
          {online ? t('runner.emptyOnline') : t('runner.emptyOffline')}
        </div>
      ) : (
        <ul className={styles.list}>
          {runners.map((r) => (
            <li key={r.id} className={styles.item}>
              <div className={styles.itemName}>{r.name || r.id}</div>
              <div
                className={`${styles.itemStatus} ${statusClass(r.status)}`}
                aria-label={`${r.name || r.id}: ${r.status}`}
              >
                {r.status}
              </div>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
