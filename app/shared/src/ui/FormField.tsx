import { cloneElement, useId, type ReactElement, type ReactNode } from 'react';
import { cx } from './cx';
import styles from './FormField.module.css';

export interface FormFieldProps {
  /** Field label — rendered as a <label htmlFor> bound to the child control's id. */
  label?: ReactNode;
  /** Helper text shown below the control (hidden while an error is active). */
  hint?: ReactNode;
  /** Unified error text — wires aria-invalid + aria-describedby to the child control. */
  error?: ReactNode;
  /** Renders a danger asterisk after the label. */
  required?: boolean;
  /** The control (Input/Textarea/Select/...). id/aria props are injected when absent. */
  children: ReactElement;
  className?: string;
}

/**
 * FormField — layout + semantic error wiring for a single form control.
 *
 * The child control receives an auto-generated `id` (used by the label's
 * htmlFor), and when `error` is present a `aria-invalid="true"` plus an
 * `aria-describedby` pointing at the error message. The unified error
 * state is the single way fields surface validation in this design system:
 * plain text + `--td-danger` token, no ad-hoc per-field error patterns.
 */
export function FormField({ label, hint, error, required, children, className }: FormFieldProps) {
  const autoId = useId();
  const childId = (children.props as Record<string, unknown>).id;
  const controlId = typeof childId === 'string' && childId !== '' ? childId : autoId;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;

  const describedBy =
    error != null ? errorId : hint != null ? hintId : null;

  const mergedProps: Record<string, unknown> = {
    id: controlId,
  };
  if (describedBy != null) {
    mergedProps['aria-describedby'] = describedBy;
  }
  if (error != null) {
    mergedProps['aria-invalid'] = true;
  }

  return (
    <div className={cx(styles.field, className)}>
      {label != null && (
        <label className={styles.label} htmlFor={controlId}>
          {label}
          {required && (
            <span className={styles.required} aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      {cloneElement(children, mergedProps)}
      {hint != null && error == null && (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      )}
      {error != null && (
        <p className={styles.error} id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}
