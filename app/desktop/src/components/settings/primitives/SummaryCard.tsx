import { type ReactNode } from 'react';
import styles from './primitives.module.css';

interface SummaryCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}

export default function SummaryCard({ icon, label, value, detail }: SummaryCardProps) {
  return (
    <div className={styles.summaryCard}>
      <div className={styles.summaryIcon}>{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}
