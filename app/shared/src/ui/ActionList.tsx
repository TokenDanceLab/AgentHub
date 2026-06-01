import React, { type ReactNode } from 'react';
import styles from './ActionList.module.css';
import { SkeletonBar } from './SkeletonBar';

export interface ActionListItem {
  id: string;
  title: ReactNode;
  icon?: ReactNode;
  meta?: ReactNode[];
  trailing?: ReactNode;
  ariaLabel?: string;
  className?: string;
  iconClassName?: string;
  onClick?: () => void;
}

export interface ActionListProps {
  items: ActionListItem[];
  className?: string;
  itemClassName?: string;
  iconClassName?: string;
  bodyClassName?: string;
  titleClassName?: string;
  metaStackClassName?: string;
  metaClassName?: string;
  /** Show skeleton placeholder instead of items. Default loadingRows is 4. */
  isLoading?: boolean;
  /** Number of skeleton rows to render in loading state. */
  loadingRows?: number;
  /** Shown when items is empty and not loading or erring. */
  emptyState?: ReactNode;
  /** Shown instead of list content when truthy. Takes priority over loading/empty. */
  error?: string | ReactNode;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function ActionList({
  items,
  className,
  itemClassName,
  iconClassName,
  bodyClassName,
  titleClassName,
  metaStackClassName,
  metaClassName,
  isLoading,
  loadingRows,
  emptyState,
  error,
}: ActionListProps) {
  if (error) {
    return (
      <div className={cx(styles.list, className)} role="alert">
        {typeof error === 'string' ? (
          <span className={cx(styles.item, styles.title)} style={{ color: 'var(--destructive, #dc2626)' }}>{error}</span>
        ) : (
          error
        )}
      </div>
    );
  }

  if (isLoading) {
    const rows = loadingRows ?? 4;
    return (
      <div className={cx(styles.list, className)}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className={cx(styles.item, itemClassName)}>
            <SkeletonBar width="34px" height="34px" lines={1} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
              <SkeletonBar width="55%" height="14px" lines={1} />
              <SkeletonBar width="35%" height="10px" lines={1} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0 && emptyState !== undefined) {
    return <>{emptyState}</>;
  }

  return (
    <div className={cx(styles.list, className)}>
      {items.map((item) => (
        <button
          key={item.id}
          className={cx(styles.item, itemClassName, item.className)}
          type="button"
          aria-label={item.ariaLabel}
          onClick={item.onClick}
        >
          {item.icon ? (
            <span className={cx(styles.icon, iconClassName, item.iconClassName)}>
              {item.icon}
            </span>
          ) : null}
          <span className={cx(styles.body, bodyClassName)}>
            <span className={cx(styles.title, titleClassName)}>{item.title}</span>
            {item.meta && item.meta.length > 0 ? (
              <span className={cx(styles.metaStack, metaStackClassName)}>
                {item.meta.map((meta, index) => (
                  <span key={`${item.id}-meta-${index}`} className={cx(styles.meta, metaClassName)}>
                    {meta}
                  </span>
                ))}
              </span>
            ) : null}
          </span>
          {item.trailing}
        </button>
      ))}
    </div>
  );
}
