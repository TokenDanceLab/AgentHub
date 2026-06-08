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
  /** Explicit replay/source labels so mock, fixture, and real runs are distinguishable. */
  sourceLabel?: string | undefined;
  modeLabel?: string | undefined;
  targetLabel?: string | undefined;
  taskId?: string | undefined;
  edgeRunId?: string | undefined;
  adapterId?: string | undefined;
  deviceId?: string | undefined;
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
  adapterId,
  deviceId,
  edgeRunId,
  modeLabel,
  title,
  meta,
  runId,
  sourceLabel,
  status,
  targetLabel,
  taskId,
}) => {
  const evidence = [
    sourceLabel ? { label: 'Source', value: sourceLabel } : undefined,
    modeLabel ? { label: 'Mode', value: modeLabel } : undefined,
    targetLabel ? { label: 'Target', value: targetLabel } : undefined,
    taskId ? { label: 'Hub task', value: taskId } : undefined,
    edgeRunId ? { label: 'Edge run', value: edgeRunId } : undefined,
    adapterId ? { label: 'Adapter', value: adapterId } : undefined,
    deviceId ? { label: 'Device', value: deviceId } : undefined,
  ].filter((item): item is { label: string; value: string } => Boolean(item));

  return (
    <div className={styles.row}>
      <div className={`${styles.card} run-session-card`} data-card-surface data-run-status={status ?? 'running'}>
        <span className={`${styles.mark} run-session-mark ${markClass(status)}`}>Run</span>

        <div className={styles.body}>
          <strong className={styles.title}>{title}</strong>
          {meta && <span className={styles.meta}>{meta}</span>}
          {evidence.length > 0 && (
            <span className={styles.evidence} aria-label="Run replay evidence">
              {evidence.map((item) => (
                <span className={styles.evidencePill} key={`${item.label}:${item.value}`}>
                  {item.label}: {item.value}
                </span>
              ))}
            </span>
          )}
        </div>

        {runId && <em className={styles.runId}>{runId}</em>}
      </div>
    </div>
  );
};
