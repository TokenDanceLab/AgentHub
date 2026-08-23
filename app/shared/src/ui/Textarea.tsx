import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cx } from './cx';
import styles from './Textarea.module.css';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Unified error state (semantic + visual) — see FormField/Input. */
  invalid?: boolean;
  /** sm: compact field for dense surfaces. */
  size?: 'sm' | 'md';
  /** Monospace typeface (URLs, tokens, identifiers). */
  mono?: boolean;
}

/**
 * Textarea — shared multiline text field. Same glass-surface visual as
 * Input; vertical resize only so the layout never shifts horizontally.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, size = 'md', mono, className, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cx(styles.base, size === 'sm' && styles.sm, mono && styles.mono, invalid && styles.invalid, className)}
      {...(invalid ? { 'aria-invalid': true } : {})}
      {...props}
    />
  );
});
