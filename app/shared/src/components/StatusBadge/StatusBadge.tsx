import styles from './StatusBadge.module.css';

export type StatusVariant = 'online' | 'offline' | 'running' | 'error' | 'pending' | 'done' | 'in progress' | 'review';

export interface StatusBadgeProps {
  status: StatusVariant;
  className?: string;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
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

export function StatusBadge({
  status,
  className,
}: StatusBadgeProps) {
  return (
    <span className={cx(styles.badge, styles[status], className)}>
      {statusLabel[status]}
    </span>
  );
}

export default StatusBadge;
