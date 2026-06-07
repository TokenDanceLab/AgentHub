import React from 'react';
import styles from './RouteDecisionBlock.module.css';

/** Status labels matching the demo's statusLabel() mapping */
const STATUS_LABELS: Record<string, string> = {
  running: '运行中',
  draining: '收尾中',
  completed: '完成',
  pending: '待执行',
  failed: '失败',
};

interface RouteDecisionBlockProps {
  action: string;
  summary?: string | undefined;
  targetAgent?: string | undefined;
}

export const RouteDecisionBlock: React.FC<RouteDecisionBlockProps> = ({
  action,
  summary,
  targetAgent,
}) => {
  return (
    <div className={styles.row}>
      <div className={styles.block} data-card-surface>
        <div className={styles.head}>
          <span className={styles.kind}>Route Decision</span>
          <strong className={styles.action}>{action}</strong>
          {targetAgent && <em className={styles.target}>{targetAgent}</em>}
        </div>
        {summary && <p className={styles.summary}>{summary}</p>}
      </div>
    </div>
  );
};

export { STATUS_LABELS };
