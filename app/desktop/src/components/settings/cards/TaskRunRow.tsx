import { useTranslation } from 'react-i18next';
import { Route, XCircle } from 'lucide-react';
import type { RunInfo } from '@shared/types';
import { isActiveRun, shortId, formatTimestamp } from '../utils';
import styles from '../../SettingsPage.module.css';

interface TaskRunRowProps {
  run: RunInfo;
  onCancel?: (runId: string) => void;
  cancelling?: boolean;
}

export default function TaskRunRow({ run, onCancel, cancelling = false }: TaskRunRowProps) {
  const { t } = useTranslation();
  const timestamp = run.finishedAt ?? run.startedAt ?? run.createdAt;
  return (
    <div className={styles.taskRow}>
      <div className={styles.connectionIcon}>
        <Route size={17} />
      </div>
      <div className={styles.settingCopy}>
        <strong>{shortId(run.runId)}</strong>
        <span>{run.projectId} / {run.threadId}</span>
        <div className={styles.taskMeta}>
          <span>{formatTimestamp(timestamp)}</span>
        </div>
      </div>
      <span className={`${styles.statusPill} ${isActiveRun(run) ? styles.statusPillOn : ''}`}>
        {t(`run.status.${run.status.toLowerCase()}`, { defaultValue: run.status })}
      </span>
      {onCancel ? (
        <button
          type="button"
          className={`${styles.secondaryBtn} ${styles.taskRowAction}`}
          onClick={() => onCancel(run.runId)}
          disabled={cancelling}
          aria-label={t('settings.taskCancelRun')}
          title={t('settings.taskCancelRun')}
        >
          <XCircle size={15} />
        </button>
      ) : null}
    </div>
  );
}
