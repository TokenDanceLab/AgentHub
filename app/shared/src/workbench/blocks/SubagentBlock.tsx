import React from 'react';
import styles from './SubagentBlock.module.css';
import { STATUS_LABELS } from './RouteDecisionBlock';

interface SubagentBlockProps {
  title?: string | undefined;
  worker: string;
  status: string;
  task?: string | undefined;
  summary?: string | undefined;
  /** Unique run ID for the subagent spawn, displayed as monospace code */
  runId?: string | undefined;
}

export const SubagentBlock: React.FC<SubagentBlockProps> = ({
  title,
  worker,
  status,
  task,
  summary,
  runId,
}) => {
  const statusLabel = STATUS_LABELS[status] || status;
  const stateClass = styles[status] ?? '';
  const heading = title ?? task ?? worker;
  const body = summary ?? (title ? task : undefined);

  return (
    <div className={styles.row}>
      <div className={`${styles.block} ${stateClass}`} data-card-surface>
        <div className={styles.head}>
          <span className={styles.kind}>Subagent</span>
          <strong className={styles.worker}>{heading}</strong>
          <em className={styles.status}>{statusLabel}</em>
        </div>
        {body && <p className={styles.task}>{body}</p>}
        <div className={styles.meta}>
          {runId && <code className={styles.metaCode}>{runId}</code>}
          <span className={styles.metaText}>子Agent: {worker}</span>
        </div>
      </div>
    </div>
  );
};
