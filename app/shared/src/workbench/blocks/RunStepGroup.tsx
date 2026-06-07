import React, { useState } from 'react';
import { DesignNavIcon } from '../designIcons';
import styles from './RunStepGroup.module.css';

interface RunStepGroupProps {
  icon: string;
  title: string;
  meta?: string | undefined;
  status?: string | undefined;
  defaultOpen?: boolean | undefined;
  children?: React.ReactNode;
}

function statusClass(status?: string): string {
  switch (status) {
    case 'running':
      return styles.running ?? '';
    case 'completed':
    case 'done':
      return styles.completed ?? '';
    case 'failed':
      return styles.failed ?? '';
    default:
      return '';
  }
}

function statusLabel(status?: string): string {
  switch (status) {
    case 'pending':
      return '待执行';
    case 'running':
      return '运行中';
    case 'completed':
    case 'done':
      return '完成';
    case 'failed':
      return '失败';
    default:
      return status ?? '';
  }
}

export const RunStepGroup: React.FC<RunStepGroupProps> = ({
  icon,
  title,
  meta,
  status = 'completed',
  defaultOpen = false,
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section
      className={[
        styles.step,
        'run-step',
        statusClass(status),
        status,
        open ? styles.open : '',
        open ? 'is-open' : '',
      ].filter(Boolean).join(' ')}
      data-run-step
    >
      <button
        aria-expanded={open}
        className={`${styles.toggle} run-step-toggle`}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className={`${styles.icon} run-step-icon`}>{icon}</span>
        <span className={`${styles.copy} run-step-copy`}>
          <strong>{title}</strong>
          {meta && <small>{meta}</small>}
        </span>
        <span className={`${styles.status} run-step-status`}>{statusLabel(status)}</span>
        <span className={`${styles.chevron} run-step-chevron`} aria-hidden="true">
          <DesignNavIcon name="chevron" size={14} />
        </span>
      </button>
      <div className={`${styles.detail} run-step-detail`}>
        <div className={`${styles.detailInner} run-step-detail-inner`}>{children}</div>
      </div>
    </section>
  );
};
