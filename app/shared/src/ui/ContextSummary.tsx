import React, { type ReactNode } from 'react';
import styles from './ContextSummary.module.css';
import { SkeletonBar } from './SkeletonBar';

export interface ContextSummaryItem {
  id: string;
  label: ReactNode;
  value: ReactNode;
}

export interface ContextSummaryProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  icon?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  items: ContextSummaryItem[];
  className?: string | undefined;
  headerClassName?: string | undefined;
  iconClassName?: string | undefined;
  titleGroupClassName?: string | undefined;
  eyebrowClassName?: string | undefined;
  titleClassName?: string | undefined;
  descriptionClassName?: string | undefined;
  listClassName?: string | undefined;
  itemClassName?: string | undefined;
  labelClassName?: string | undefined;
  valueClassName?: string | undefined;
  actionsClassName?: string | undefined;
  ariaLabel?: string | undefined;
  /** Show skeleton placeholder instead of items. Default loadingRows is 4. */
  isLoading?: boolean;
  /** Number of skeleton item rows to render in loading state. */
  loadingRows?: number;
  /** Shown when items is empty and not loading or erring. */
  emptyState?: ReactNode;
  /** Shown instead of body content when truthy. Takes priority over loading/empty. */
  error?: string | ReactNode;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function ContextSummary({
  eyebrow,
  title,
  icon,
  description,
  actions,
  items,
  className,
  headerClassName,
  iconClassName,
  titleGroupClassName,
  eyebrowClassName,
  titleClassName,
  descriptionClassName,
  listClassName,
  itemClassName,
  labelClassName,
  valueClassName,
  actionsClassName,
  ariaLabel,
  isLoading,
  loadingRows,
  emptyState,
  error,
}: ContextSummaryProps) {
  return (
    <section className={cx(styles.summary, className)} aria-label={ariaLabel}>
      <div className={cx(styles.header, headerClassName)}>
        {icon ? <span className={cx(styles.icon, iconClassName)}>{icon}</span> : null}
        <div className={cx(styles.titleGroup, titleGroupClassName)}>
          {eyebrow ? <p className={cx(styles.eyebrow, eyebrowClassName)}>{eyebrow}</p> : null}
          <h2 className={cx(styles.title, titleClassName)}>{title}</h2>
        </div>
      </div>
      {error ? (
        <div className={cx(styles.description, descriptionClassName)} role="alert">
          {error}
        </div>
      ) : isLoading ? (
        <dl className={cx(styles.list, listClassName)}>
          {Array.from({ length: loadingRows ?? 4 }, (_, i) => (
            <div key={i} className={cx(styles.item, itemClassName)}>
              <dt className={cx(styles.label, labelClassName)}>
                <SkeletonBar width="45%" height="12px" lines={1} />
              </dt>
              <dd className={cx(styles.value, valueClassName)}>
                <SkeletonBar width="70%" height="14px" lines={1} />
              </dd>
            </div>
          ))}
        </dl>
      ) : items.length > 0 ? (
        <>
          {description ? <p className={cx(styles.description, descriptionClassName)}>{description}</p> : null}
          <dl className={cx(styles.list, listClassName)}>
            {items.map((item) => (
              <div key={item.id} className={cx(styles.item, itemClassName)}>
                <dt className={cx(styles.label, labelClassName)}>{item.label}</dt>
                <dd className={cx(styles.value, valueClassName)}>{item.value}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : emptyState !== undefined ? (
        <div>{emptyState}</div>
      ) : (
        <>
          {description ? <p className={cx(styles.description, descriptionClassName)}>{description}</p> : null}
          <dl className={cx(styles.list, listClassName)} />
        </>
      )}
      {actions ? <div className={cx(styles.actions, actionsClassName)}>{actions}</div> : null}
    </section>
  );
}
