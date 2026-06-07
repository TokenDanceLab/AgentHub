import React from 'react';
import styles from './ChildAgentBlock.module.css';
import { STATUS_LABELS } from './RouteDecisionBlock';

interface ChildAgentBlockProps {
  parentRunId?: string | undefined;
  runId?: string | undefined;
  agent: string;
  status: string;
  /** Optional title/label for what the child agent is doing */
  title?: string | undefined;
  task?: string | undefined;
  summary?: string | undefined;
}

export const ChildAgentBlock: React.FC<ChildAgentBlockProps> = ({
  parentRunId,
  runId,
  agent,
  status,
  title,
  task,
  summary,
}) => {
  const statusLabel = STATUS_LABELS[status] || status;
  const stateClass = styles[status] ?? '';
  const heading = title ?? task ?? agent;
  const body = summary ?? (title ? task : undefined);

  return (
    <div className={styles.row}>
      <div className={`${styles.block} ${stateClass}`} data-card-surface>
        <div className={styles.head}>
          <span className={styles.kind}>Child Agent</span>
          <strong className={styles.agent}>{heading}</strong>
          <em className={styles.status}>{statusLabel}</em>
        </div>
        {body && <p className={styles.task}>{body}</p>}
        <div className={styles.meta}>
          {runId && <code className={styles.metaCode}>{runId}</code>}
          <span className={styles.metaText}>{agent}</span>
          {parentRunId && (
            <span className={styles.metaText}>parent: {parentRunId}</span>
          )}
        </div>
      </div>
    </div>
  );
};
