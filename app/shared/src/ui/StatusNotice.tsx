import React, { type ReactNode } from 'react';
import styles from './StatusNotice.module.css';

export interface StatusNoticeProps {
  children: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  role?: 'status' | 'alert' | 'note';
  ariaLive?: 'off' | 'polite' | 'assertive';
  className?: string;
  iconClassName?: string;
  contentClassName?: string;
  actionClassName?: string;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function StatusNotice({
  children,
  icon,
  action,
  role = 'status',
  ariaLive,
  className,
  iconClassName,
  contentClassName,
  actionClassName,
}: StatusNoticeProps) {
  const live = ariaLive ?? (role === 'status' ? 'polite' : undefined);

  return (
    <div className={cx(styles.notice, className)} role={role} aria-live={live}>
      {icon ? <span className={cx(styles.icon, iconClassName)}>{icon}</span> : null}
      <span className={cx(styles.content, contentClassName)}>{children}</span>
      {action ? <span className={cx(styles.action, actionClassName)}>{action}</span> : null}
    </div>
  );
}
