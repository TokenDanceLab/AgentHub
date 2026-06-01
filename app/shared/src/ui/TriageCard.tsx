import React, { type ReactNode } from 'react';
import styles from './TriageCard.module.css';
import { SkeletonBar } from './SkeletonBar';

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
  /** Show skeleton placeholder instead of content. */
  isLoading?: boolean;
  /** Shown instead of card content when truthy. Takes priority over loading. */
  error?: string | ReactNode;
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
  isLoading,
  error,
}: TriageCardProps) {
  if (error) {
    return (
      <div className={cx(styles.card, className)} role="alert">
        <span className={cx(styles.body, bodyClassName)}>
          <span className={cx(styles.eyebrow, eyebrowClassName)} style={{ color: 'var(--destructive, #dc2626)' }}>
            {typeof error === 'string' ? error : error}
          </span>
        </span>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={cx(styles.card, className)} aria-busy="true">
        {icon ? <span className={cx(styles.icon, iconClassName)}>{icon}</span> : null}
        <span className={cx(styles.body, bodyClassName)}>
          <span className={cx(styles.eyebrow, eyebrowClassName)}>
            <SkeletonBar width="30%" height="10px" lines={1} />
          </span>
          <strong className={cx(styles.title, titleClassName)}>
            <SkeletonBar width="65%" height="16px" lines={1} />
          </strong>
          {meta ? (
            <span className={cx(styles.meta, metaClassName)}>
              <SkeletonBar width="40%" height="10px" lines={1} />
            </span>
          ) : null}
        </span>
        {actionIcon ? (
          <span className={cx(styles.action, actionClassName)} aria-hidden="true">
            {actionIcon}
          </span>
        ) : null}
      </div>
    );
  }

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
