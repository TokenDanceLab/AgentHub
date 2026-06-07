import React, { useState } from 'react';
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
        statusClass(status),
        open ? styles.open : '',
      ].filter(Boolean).join(' ')}
      data-run-step
    >
      <button
        aria-expanded={open}
        className={styles.toggle}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className={styles.icon}>{icon}</span>
        <span className={styles.copy}>
          <strong>{title}</strong>
          {meta && <small>{meta}</small>}
        </span>
        <span className={styles.status}>{statusLabel(status)}</span>
        <span className={styles.chevron}>⌄</span>
      </button>
      <div className={styles.detail}>
        <div className={styles.detailInner}>{children}</div>
      </div>
    </section>
  );
};
