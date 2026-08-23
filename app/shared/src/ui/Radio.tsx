import { type ReactNode } from 'react';
import { cx } from './cx';
import styles from './Radio.module.css';

export interface RadioProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'children'> {
  /** Unified error state (semantic + visual) — see FormField/Input. */
  invalid?: boolean;
  /**
   * Optional text rendered beside the control (implicit <label> association).
   * Inside clear that one accessible name wins: use FormField for field-level
   * labels, `label` here for standalone radios in a fieldset group.
   */
  label?: ReactNode;
}

/**
 * Radio — native radio input with design-system visuals. Same interaction
 * model as Checkbox: invisible native input overlays the visual circle.
 */
export function Radio({ invalid, label, className, ...props }: RadioProps) {
  const input = (
    <input
      type="radio"
      className={styles.control}
      {...(invalid ? { 'aria-invalid': true } : {})}
      {...props}
    />
  );
  const visual = <span className={styles.box} aria-hidden="true" />;

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
