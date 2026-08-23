import { type ReactNode } from 'react';
import { cx } from './cx';
import styles from './Switch.module.css';

export interface SwitchProps {
  checked: boolean;
  /** Called with the NEXT value when the user toggles. */
  onChange: (checked: boolean) => void;
  /** Disabled switches keep their current state visible but ignore clicks (#1818). */
  disabled?: boolean;
  /** Accessible name — required unless the switch sits inside a labeled row. */
  'aria-label'?: string;
  className?: string;
  children?: ReactNode;
}

/**
 * Switch — settings-style toggle (42x24 pill). Same visuals as the former
 * SettingsPage hand-rolled .switch so the migration is pixel-equivalent;
 * adds the a11y-critical ':focus-visible' ring.
 */
export function Switch({
  checked,
  onChange,
  disabled = false,
  className,
  children,
  'aria-label': ariaLabel,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(styles.root, checked && styles.on, disabled && styles.disabled, className)}
    >
      <span className={styles.thumb} aria-hidden="true" />
      {children}
    </button>
  );
}
