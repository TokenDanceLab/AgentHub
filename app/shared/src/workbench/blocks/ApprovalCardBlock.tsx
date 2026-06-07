import React from 'react';
import styles from './ApprovalCardBlock.module.css';

type ApprovalStatus = 'pending' | 'running' | 'completed' | 'failed';
type ApprovalRisk = 'low' | 'medium' | 'high' | 'critical';

interface ApprovalCardBlockProps {
  id: string;
  status: ApprovalStatus;
  title?: string | undefined;
  toolName?: string | undefined;
  risk?: ApprovalRisk | undefined;
  reason?: string | undefined;
}

const riskLabels: Record<ApprovalRisk, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  critical: '关键风险',
};

const statusLabels: Record<ApprovalStatus, string> = {
  pending: '待执行',
  running: '运行中',
  completed: '已批准',
  failed: '已拒绝',
};

const riskClassMap: Record<ApprovalRisk, string> = {
  low: styles.badgeSuccess ?? '',
  medium: styles.badgeWarning ?? '',
  high: styles.badgeDanger ?? '',
  critical: styles.badgeDanger ?? '',
};

export const ApprovalCardBlock: React.FC<ApprovalCardBlockProps> = ({
  id,
  status,
  title = '部署/写入审批',
  toolName,
  risk = 'medium',
  reason = '需要用户确认后继续执行。',
}) => {
  const statusLabel = statusLabels[status] ?? status;
  const isPending = status === 'pending' || status === 'running';

  return (
    <div className={styles.row}>
      <div className={styles.card} data-card-surface>
        <div className={styles.title}>
          {title}
          <span className={`${styles.badge} ${riskClassMap[risk]}`}>
            <span className={styles.dot} />
            {riskLabels[risk]}
          </span>
        </div>
        <div className={styles.body}>
          <strong>{toolName ?? title}</strong>
          {' · '}
          {reason}
          <br />
          <code>{id}</code>
        </div>
        <div className={styles.actions}>
          {isPending ? (
            <>
              <button className={`${styles.btn} ${styles.primary}`} type="button">批准</button>
              <button className={`${styles.btn} ${styles.danger}`} type="button">拒绝</button>
            </>
          ) : (
            <span className={`${styles.badge} ${status === 'completed' ? styles.badgeSuccess : styles.badgeDanger}`}>
              <span className={styles.dot} />
              {statusLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
