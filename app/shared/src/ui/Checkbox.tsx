import { type ReactNode } from 'react';
import { cx } from './cx';
import styles from './Checkbox.module.css';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'children'> {
  /** Unified error state (semantic + visual) — see FormField/Input. */
  invalid?: boolean;
  /**
   * Optional text rendered beside the control (implicit <label> association).
   * When used inside FormField, omit `label` and set the field label there —
   * one accessible name only.
   */
  label?: ReactNode;
}

/**
 * Checkbox — native input with design-system visuals (both themes via
 * `--td-*` tokens). The invisible input overlays the visual box, so clicks
 * hit the native checkbox directly (keyboard + click parity).
 */
export function Checkbox({ invalid, label, className, ...props }: CheckboxProps) {
  const input = (
    <input
      type="checkbox"
      className={styles.control}
      {...(invalid ? { 'aria-invalid': true } : {})}
      {...props}
    />
  );
  const visual = (
    <span className={styles.box} aria-hidden="true">
      <svg className={styles.check} width="10" height="8" viewBox="0 0 10 8" fill="none">
        <path d="M1 4l2.7 2.7L9 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );

  if (label == null) {
    return <span className={cx(styles.root, invalid && styles.invalid, className)}>{input}{visual}</span>;
  }
  return (
    <label className={cx(styles.root, invalid && styles.invalid, className)}>
      {input}
      {visual}
      <span className={styles.labelText}>{label}</span>
    </label>
  );
}
