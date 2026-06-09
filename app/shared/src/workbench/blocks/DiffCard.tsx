import React from 'react';
import { DesignFileIcon } from '../designIcons';
import styles from './DiffCard.module.css';

interface DiffLine {
  type: 'add' | 'del' | 'ctx';
  content: string;
}

interface DiffCardProps {
  filename: string;
  additions: number;
  deletions: number;
  lines: DiffLine[];
  reviewStatus?: 'review' | 'approved' | 'rejected' | string | undefined;
  canApply?: boolean | undefined;
  canRevert?: boolean | undefined;
  editId?: string | undefined;
  hash?: string | undefined;
  artifactId?: string | undefined;
  approvalId?: string | undefined;
  correlationId?: string | undefined;
  onExportEvidence?: (() => void) | undefined;
}

const lineClassMap: Record<DiffLine['type'], string> = {
  add: styles.add ?? '',
  del: styles.del ?? '',
  ctx: styles.ctx ?? '',
};

export const DiffCard: React.FC<DiffCardProps> = ({
  filename,
  additions,
  deletions,
  lines,
  reviewStatus,
  canApply,
  canRevert,
  editId,
  hash,
  artifactId,
  approvalId,
  correlationId,
  onExportEvidence,
}) => {
  const normalizedReviewStatus = reviewStatusLabel(reviewStatus);
  return (
    <div className={`${styles.card} diff-card`} data-card-surface>
      <div className={`${styles.header} diff-header`}>
        <DesignFileIcon className={`${styles.fileIcon} file-icon`} name={filename} />
        <span className={styles.filename}>{filename}</span>
        <span className={styles.stat}>
          +{additions} -{deletions}
        </span>
      </div>
      {(reviewStatus || editId || hash || artifactId || approvalId || correlationId || onExportEvidence) && (
        <div className={styles.evidence}>
          {reviewStatus && <span className={styles.badge}>{normalizedReviewStatus}</span>}
          {typeof canApply === 'boolean' && <span className={styles.meta}>can_apply: {String(canApply)}</span>}
          {typeof canRevert === 'boolean' && <span className={styles.meta}>can_revert: {String(canRevert)}</span>}
          {editId && <span className={styles.meta}>edit {editId}</span>}
          {hash && <span className={styles.meta}>hash {hash}</span>}
          {artifactId && <span className={styles.meta}>artifact {artifactId}</span>}
          {approvalId && <span className={styles.meta}>approval {approvalId}</span>}
          {correlationId && <span className={styles.meta}>corr {correlationId}</span>}
          {onExportEvidence && (
            <button className={styles.exportButton} type="button" onClick={onExportEvidence}>
              Export evidence
            </button>
          )}
        </div>
      )}
      {lines.map((line, i) => (
        <div key={i} className={`${styles.line} diff-line ${lineClassMap[line.type]}`}>
          {line.content}
        </div>
      ))}
    </div>
  );
};

function reviewStatusLabel(status: string | undefined): string {
  switch (status) {
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'rejected';
    default:
      return 'review';
  }
}
