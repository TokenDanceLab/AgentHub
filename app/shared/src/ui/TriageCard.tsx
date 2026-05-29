import React, { type ReactNode } from 'react';
import styles from './TriageCard.module.css';

export interface TriageCardProps {
  eyebrow: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  icon?: ReactNode;
  actionIcon?: ReactNode;
  ariaLabel?: string;
  onClick?: () => void;
  className?: string;
  iconClassName?: string;
  bodyClassName?: string;
  eyebrowClassName?: string;
  titleClassName?: string;
  metaClassName?: string;
  actionClassName?: string;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function TriageCard({
  eyebrow,
  title,
  meta,
  icon,
  actionIcon,
  ariaLabel,
  onClick,
  className,
  iconClassName,
  bodyClassName,
  eyebrowClassName,
  titleClassName,
  metaClassName,
  actionClassName,
}: TriageCardProps) {
  return (
    <button
      className={cx(styles.card, className)}
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {icon ? <span className={cx(styles.icon, iconClassName)}>{icon}</span> : null}
      <span className={cx(styles.body, bodyClassName)}>
        <span className={cx(styles.eyebrow, eyebrowClassName)}>{eyebrow}</span>
        <strong className={cx(styles.title, titleClassName)}>{title}</strong>
        {meta ? <span className={cx(styles.meta, metaClassName)}>{meta}</span> : null}
      </span>
      {actionIcon ? (
        <span className={cx(styles.action, actionClassName)} aria-hidden="true">
          {actionIcon}
        </span>
      ) : null}
    </button>
  );
}
