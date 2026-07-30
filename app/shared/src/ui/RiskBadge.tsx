import styles from './RiskBadge.module.css';
import { cx } from './cx';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface RiskBadgeProps {
  /** Risk severity level */
  level: RiskLevel;
  /** Visible label text (caller handles i18n) */
  children: string;
  /** Optional additional class name */
  className?: string;
}

function levelClass(level: RiskLevel): string {
  switch (level) {
    case 'low':
      return styles.low!;
    case 'medium':
      return styles.medium!;
    case 'high':
      return styles.high!;
    case 'critical':
      return styles.critical!;
  }
}

/**
 * Risk severity badge — pill-shaped label with semantic color.
 *
 * Levels:
 * - low: green
 * - medium: amber/yellow
 * - high: red
 * - critical: red with border (strongest warning)
 *
 * RiskBadge is stateless — the caller provides the translated label via children.
 */
export function RiskBadge({ level, children, className }: RiskBadgeProps) {
  return (
    <span className={cx(styles.badge!, levelClass(level), className)}>
      {children}
    </span>
  );
}
