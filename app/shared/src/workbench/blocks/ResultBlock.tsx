import React from 'react';
import styles from './ResultBlock.module.css';

interface ResultBlockProps {
  /** Whether the run completed successfully */
  success: boolean;
  /** Optional human-readable duration, e.g. "8m12s" */
  duration?: string | undefined;
  /** Number of conversation turns the agent took */
  turns?: number | undefined;
  /** Brief summary line displayed below the header */
  summary?: string | undefined;
}

export const ResultBlock: React.FC<ResultBlockProps> = ({
  success,
  duration,
  turns,
  summary,
}) => {
  return (
    <div className={styles.row}>
      <div className={`${styles.block} ${success ? styles.completed : styles.failed}`} data-card-surface>
        <div className={styles.head}>
          <strong className={styles.headTitle}>
            {success ? '运行结果' : '运行失败'}
          </strong>
          <em className={`${styles.headStatus} ${success ? styles.statusSuccess : styles.statusFailed}`}>
            {success ? '完成' : '失败'}
          </em>
        </div>

        {(duration || turns != null) && (
          <div className={styles.meta}>
            {duration && <span className={styles.metaItem}>{duration}</span>}
            {turns != null && (
              <span className={styles.metaItem}>
                {turns} {turns === 1 ? 'turn' : 'turns'}
              </span>
            )}
          </div>
        )}

        {summary && (
          <p className={styles.summary}>{summary}</p>
        )}
      </div>
    </div>
  );
};
