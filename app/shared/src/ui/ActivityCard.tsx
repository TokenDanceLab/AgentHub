import React, { type ReactNode } from 'react';
import styles from './ActivityCard.module.css';

export interface ActivityCardProps {
  leading?: ReactNode;
  icon?: ReactNode;
  label: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  contentAs?: 'span' | 'div';
  className?: string | undefined;
  leadingClassName?: string | undefined;
  iconClassName?: string | undefined;
  bodyClassName?: string | undefined;
  metaClassName?: string | undefined;
  labelClassName?: string | undefined;
  contentClassName?: string | undefined;
  actionsClassName?: string | undefined;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function ActivityCard({
  leading,
  icon,
  label,
  meta,
  children,
  actions,
  contentAs = 'span',
  className,
  leadingClassName,
  iconClassName,
  bodyClassName,
  metaClassName,
  labelClassName,
  contentClassName,
  actionsClassName,
}: ActivityCardProps) {
  const Content = contentAs;
  return (
    <article
      className={cx(styles.card, className)}
      data-has-actions={actions ? 'true' : undefined}
      data-has-icon={icon ? 'true' : undefined}
      data-has-leading={leading ? 'true' : undefined}
    >
      {leading ? <span className={cx(styles.leading, leadingClassName)}>{leading}</span> : null}
      {icon ? <span className={cx(styles.icon, iconClassName)}>{icon}</span> : null}
      <span className={cx(styles.body, bodyClassName)}>
        <span className={cx(styles.meta, metaClassName)}>
          <strong className={cx(styles.label, labelClassName)}>{label}</strong>
          {meta ? <span>{meta}</span> : null}
        </span>
        {children ? <Content className={cx(styles.content, contentClassName)}>{children}</Content> : null}
      </span>
      {actions ? <span className={cx(styles.actions, actionsClassName)}>{actions}</span> : null}
    </article>
  );
}
