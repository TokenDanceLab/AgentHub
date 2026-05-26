import { type ReactNode } from 'react';
import styles from '../../SettingsPage.module.css';

interface ExecutionTargetCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  status: string;
  metric: string;
  connected?: boolean;
}

export default function ExecutionTargetCard({
  icon,
  title,
  description,
  status,
  metric,
  connected = false,
}: ExecutionTargetCardProps) {
  return (
    <div className={styles.targetCard}>
      <div className={styles.targetTop}>
        <div className={styles.targetIcon}>{icon}</div>
        <span className={`${styles.statusPill} ${connected ? styles.statusPillOn : ''}`}>{status}</span>
      </div>
      <strong>{title}</strong>
      <span>{description}</span>
      <em>{metric}</em>
    </div>
  );
}
