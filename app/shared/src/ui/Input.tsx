import { forwardRef, type InputHTMLAttributes } from 'react';
import { cx } from './cx';
import styles from './Input.module.css';

// 'size' is our visual-density prop; the native numeric size attribute is
// intentionally not exposed (columns/width belong to layout, not the field).
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /**
   * Unified error state (semantic + visual): `aria-invalid` on the input
   * plus a `--td-danger` border. FormField sets this automatically from
   * its own `error` prop — use directly only for standalone fields.
   */
  invalid?: boolean;
  /** sm: compact field (8px/12px padding, 13px) for URL/token entry. */
  size?: 'sm' | 'md';
  /** Monospace typeface (URLs, tokens, identifiers). */
  mono?: boolean;
}

/**
 * Input — shared text field. Glass-surface default per the auth card
 * visual; both light and dark themes via `--glass-*`/`--td-*` tokens.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, size = 'md', mono, className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cx(styles.base, size === 'sm' && styles.sm, mono && styles.mono, invalid && styles.invalid, className)}
      {...(invalid ? { 'aria-invalid': true } : {})}
      {...props}
    />
  );
});
