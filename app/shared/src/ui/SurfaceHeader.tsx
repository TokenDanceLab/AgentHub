import React, { type ReactNode } from 'react';
import styles from './SurfaceHeader.module.css';

export interface SurfaceHeaderStatus {
  label: ReactNode;
  tone?: 'online' | 'offline' | 'pending' | 'neutral';
  dotColor?: string;
  icon?: ReactNode;
}

export interface SurfaceHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  status?: SurfaceHeaderStatus;
  action?: ReactNode;
  className?: string;
  titleGroupClassName?: string;
  eyebrowClassName?: string;
  titleClassName?: string;
  statusClassName?: string;
  statusDotClassName?: string;
  statusLabelClassName?: string;
  actionClassName?: string;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

function toneColor(tone: SurfaceHeaderStatus['tone']): string | undefined {
  switch (tone) {
    case 'online':
      return 'var(--td-moss, currentColor)';
    case 'offline':
      return 'var(--td-danger, currentColor)';
    case 'pending':
      return 'var(--td-amber, currentColor)';
    default:
      return undefined;
  }
}

export function SurfaceHeader({
  eyebrow,
  title,
  status,
  action,
  className,
  titleGroupClassName,
  eyebrowClassName,
  titleClassName,
  statusClassName,
  statusDotClassName,
  statusLabelClassName,
  actionClassName,
}: SurfaceHeaderProps) {
  const dotColor = status?.dotColor ?? toneColor(status?.tone);

  return (
    <header className={cx(styles.header, className)}>
      <div className={cx(styles.titleGroup, titleGroupClassName)}>
        {eyebrow ? <p className={cx(styles.eyebrow, eyebrowClassName)}>{eyebrow}</p> : null}
        <h1 className={cx(styles.title, titleClassName)}>{title}</h1>
      </div>
      {status ? (
        <div className={cx(styles.status, statusClassName)}>
          {status.icon ? <span className={styles.statusIcon}>{status.icon}</span> : null}
          <span
            className={cx(styles.statusDot, statusDotClassName)}
            style={dotColor ? { backgroundColor: dotColor } : undefined}
            aria-hidden="true"
          />
          <span className={cx(styles.statusLabel, statusLabelClassName)}>{status.label}</span>
        </div>
      ) : null}
      {action ? <div className={cx(styles.action, actionClassName)}>{action}</div> : null}
    </header>
  );
}
