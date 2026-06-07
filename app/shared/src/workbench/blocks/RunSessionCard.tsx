import React from 'react';
import styles from './RunSessionCard.module.css';

interface RunSessionCardProps {
  /** Card title  */
  title: string;
  /** Secondary metadata line (e.g. "Orchestrator · Builder · DeepSeek-V4-Pro") */
  meta?: string | undefined;
  /** Run ID displayed as a right-aligned mono pill */
  runId?: string | undefined;
  /** Visual state of the run marker pill */
  status?: 'running' | 'completed' | 'failed' | undefined;
}

/** Maps status prop to the CSS module class for the run marker pill. */
function markClass(status?: RunSessionCardProps['status']): string {
  switch (status) {
    case 'completed':
      return styles.markCompleted ?? '';
    case 'failed':
      return styles.markFailed ?? '';
    default:
      return styles.markDefault ?? '';
  }
}

/**
 * RunSessionCard — a compact card summarising an Agent run.
 *
 * Mirrors the `.run-session-card` block from the AgentHub Desktop demo:
 *   - left run marker pill
 *   - centre title + meta
 *   - right run ID in monospace
 */
export const RunSessionCard: React.FC<RunSessionCardProps> = ({
  title,
  meta,
  runId,
  status,
}) => {
  return (
    <div className={styles.row}>
      <div className={`${styles.card} run-session-card`} data-card-surface data-run-status={status ?? 'running'}>
        <span className={`${styles.mark} run-session-mark ${markClass(status)}`}>Run</span>

        <div className={styles.body}>
          <strong className={styles.title}>{title}</strong>
          {meta && <span className={styles.meta}>{meta}</span>}
        </div>

        {runId && <em className={styles.runId}>{runId}</em>}
      </div>
    </div>
  );
};
