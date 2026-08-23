import React from 'react';
import { cx } from '../cx';
import styles from './StatusBadge.module.css';

export type StatusVariant = 'online' | 'offline' | 'running' | 'error' | 'pending' | 'done' | 'in progress' | 'review';

export interface StatusBadgeProps {
  status: StatusVariant;
  label?: string;
  className?: string;
}

const statusLabel: Record<StatusVariant, string> = {
  online: 'Online',
  offline: 'Offline',
  running: 'Running',
  error: 'Error',
  pending: 'Pending',
  done: 'Done',
  'in progress': 'In progress',
  review: 'Review',
};

const statusClass: Record<StatusVariant, string> = {
  online: styles.online!,
  offline: styles.offline!,
  running: styles.running!,
  error: styles.error!,
  pending: styles.pending!,
  done: styles.done!,
  'in progress': styles.inProgress!,
  review: styles.review!,
};

export function getStatusVariantClassName(status: StatusVariant): string {
  return status.replace(/\s+/g, '-');
}

export function StatusBadge({
  status,
  label,
  className,
}: StatusBadgeProps) {
  return (
    <span className={cx(styles.badge, statusClass[status], className)}>
      {label ?? statusLabel[status]}
    </span>
  );
}

export default StatusBadge;
