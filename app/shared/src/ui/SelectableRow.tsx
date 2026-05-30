import React, { type ReactNode } from 'react';
import styles from './SelectableRow.module.css';

export interface SelectableRowProps {
  title: ReactNode;
  meta?: ReactNode;
  icon?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  onSelect?: () => void;
  className?: string | undefined;
  buttonClassName?: string | undefined;
  selectedClassName?: string | undefined;
  leadingClassName?: string | undefined;
  iconClassName?: string | undefined;
  bodyClassName?: string | undefined;
  titleClassName?: string | undefined;
  metaClassName?: string | undefined;
  actionsClassName?: string | undefined;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function SelectableRow({
  title,
  meta,
  icon,
  leading,
  actions,
  selected = false,
  disabled = false,
  ariaLabel,
  onSelect,
  className,
  buttonClassName,
  selectedClassName,
  leadingClassName,
  iconClassName,
  bodyClassName,
  titleClassName,
  metaClassName,
  actionsClassName,
}: SelectableRowProps) {
  return (
    <div className={cx(styles.row, className)} data-selected={selected ? 'true' : undefined}>
      <button
        className={cx(styles.button, buttonClassName, selected && selectedClassName)}
        type="button"
        aria-label={ariaLabel}
        aria-current={selected ? 'true' : undefined}
        disabled={disabled}
        onClick={onSelect}
      >
        {leading ? <span className={cx(styles.leading, leadingClassName)} aria-hidden="true">{leading}</span> : null}
        {icon ? <span className={cx(styles.icon, iconClassName)} aria-hidden="true">{icon}</span> : null}
        <span className={cx(styles.body, bodyClassName)}>
          <span className={cx(styles.title, titleClassName)}>{title}</span>
          {meta ? <span className={cx(styles.meta, metaClassName)}>{meta}</span> : null}
        </span>
      </button>
      {actions ? <span className={cx(styles.actions, actionsClassName)}>{actions}</span> : null}
    </div>
  );
}
