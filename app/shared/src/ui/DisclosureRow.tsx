import React, { type ReactNode } from 'react';
import styles from './DisclosureRow.module.css';

export interface DisclosureRowProps {
  label: ReactNode;
  meta?: ReactNode;
  leading?: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  disabled?: boolean | undefined;
  children?: ReactNode;
  className?: string | undefined;
  buttonClassName?: string | undefined;
  leadingClassName?: string | undefined;
  chevronClassName?: string | undefined;
  labelClassName?: string | undefined;
  metaClassName?: string | undefined;
  bodyClassName?: string | undefined;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function DisclosureRow({
  label,
  meta,
  leading,
  expanded,
  onToggle,
  disabled = false,
  children,
  className,
  buttonClassName,
  leadingClassName,
  chevronClassName,
  labelClassName,
  metaClassName,
  bodyClassName,
}: DisclosureRowProps) {
  return (
    <div className={cx(styles.row, className)}>
      <button
        type="button"
        className={cx(styles.button, buttonClassName)}
        onClick={onToggle}
        aria-expanded={expanded}
        disabled={disabled}
      >
        {leading ? <span className={cx(styles.leading, leadingClassName)}>{leading}</span> : null}
        <span
          className={cx(styles.chevron, expanded && styles.chevronExpanded, chevronClassName)}
          aria-hidden="true"
        >
          ▸
        </span>
        <span className={cx(styles.label, labelClassName)}>{label}</span>
        {meta ? <span className={cx(styles.meta, metaClassName)}>{meta}</span> : null}
      </button>
      {expanded && children ? <div className={cx(styles.body, bodyClassName)}>{children}</div> : null}
    </div>
  );
}
