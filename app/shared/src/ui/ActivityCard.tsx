import React, { type ReactNode } from 'react';
import styles from './ActivityCard.module.css';

export interface ActivityCardProps {
  icon?: ReactNode;
  label: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  iconClassName?: string;
  bodyClassName?: string;
  metaClassName?: string;
  labelClassName?: string;
  contentClassName?: string;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function ActivityCard({
  icon,
  label,
  meta,
  children,
  className,
  iconClassName,
  bodyClassName,
  metaClassName,
  labelClassName,
  contentClassName,
}: ActivityCardProps) {
  return (
    <article className={cx(styles.card, className)}>
      {icon ? <span className={cx(styles.icon, iconClassName)}>{icon}</span> : null}
      <span className={cx(styles.body, bodyClassName)}>
        <span className={cx(styles.meta, metaClassName)}>
          <strong className={cx(styles.label, labelClassName)}>{label}</strong>
          {meta ? <span>{meta}</span> : null}
        </span>
        <span className={cx(styles.content, contentClassName)}>{children}</span>
      </span>
    </article>
  );
}
