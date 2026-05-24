import styles from './ProgressBar.module.css';

interface ProgressBarProps {
  value: number;
  paused?: boolean;
  label?: string;
  className?: string;
}

export function ProgressBar({ value, paused = false, label, className }: ProgressBarProps) {
  const safeValue = Math.max(0, Math.min(100, value));
  const cls = [styles.track, paused ? styles.paused : '', className].filter(Boolean).join(' ');

  return (
    <div>
      <div
        className={cls}
        role="progressbar"
        aria-valuenow={safeValue}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? `${safeValue}%`}
      >
        <span className={styles.fill} style={{ width: `${safeValue}%` }} />
      </div>
      {label ? <span className={styles.label}>{label}</span> : null}
    </div>
  );
}
