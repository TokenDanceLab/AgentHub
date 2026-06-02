import React, { type ReactNode } from 'react';
import styles from './SectionHeader.module.css';

export interface SectionHeaderAction {
  icon: ReactNode;
  ariaLabel: string;
  onClick?: () => void;
  busy?: boolean;
}

export interface SectionHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  action?: SectionHeaderAction;
  className?: string;
  titleGroupClassName?: string;
  eyebrowClassName?: string;
  titleClassName?: string;
  actionClassName?: string;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function SectionHeader({
  eyebrow,
  title,
  action,
  className,
  titleGroupClassName,
  eyebrowClassName,
  titleClassName,
  actionClassName,
}: SectionHeaderProps) {
  return (
    <div className={cx(styles.header, className)}>
      <div className={cx(styles.titleGroup, titleGroupClassName)}>
        {eyebrow ? <p className={cx(styles.eyebrow, eyebrowClassName)}>{eyebrow}</p> : null}
        <h2 className={cx(styles.title, titleClassName)}>{title}</h2>
      </div>
      {action ? (
        <button
          className={cx(styles.action, actionClassName)}
          type="button"
          aria-label={action.ariaLabel}
          aria-busy={action.busy}
          onClick={action.onClick}
        >
          {action.icon}
        </button>
      ) : null}
    </div>
  );
}
