import React from 'react';
import { DesignFileIcon } from '../designIcons';
import styles from './FileChangeCard.module.css';

export interface FileChangeCardProps {
  path: string;
  action: 'created' | 'modified' | 'deleted';
  additions?: number | undefined;
  deletions?: number | undefined;
  /** Optional callback for the "Review" button. When provided the button is rendered. */
  onReview?: (() => void) | undefined;
  diffExpanded?: boolean | undefined;
  onToggleDiff?: (() => void) | undefined;
}

export const FileChangeCard: React.FC<FileChangeCardProps> = ({
  path,
  action,
  additions,
  deletions,
  diffExpanded = false,
  onReview,
  onToggleDiff,
}) => {
  return (
    <div className={`${styles.card} file-change-card`} data-card-surface>
      <DesignFileIcon className={`${styles.fileIcon} file-icon`} name={path} />
      <span className={styles.action}>{action}</span>
      <code className={styles.path}>{path}</code>
      {additions !== undefined && (
        <em className={styles.add}>+{additions}</em>
      )}
      {deletions !== undefined && (
        <em className={styles.del}>-{deletions}</em>
      )}
      {onToggleDiff && (
        <button
          aria-expanded={diffExpanded}
          className={styles.expandBtn}
          type="button"
          onClick={onToggleDiff}
        >
          {diffExpanded ? '收起' : '展开'}
        </button>
      )}
      {onReview && (
        <button className={styles.reviewBtn} type="button" onClick={onReview}>
          Review
        </button>
      )}
    </div>
  );
};
