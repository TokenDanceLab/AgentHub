import React, { type ReactNode } from 'react';
import styles from './MetricGrid.module.css';
import { SkeletonBar } from './SkeletonBar';

export interface MetricGridItem {
  id: string;
  value: ReactNode;
  label: ReactNode;
  icon?: ReactNode;
  ariaLabel?: string;
  onClick?: () => void;
}

export interface MetricGridProps {
  items: MetricGridItem[];
  className?: string;
  itemClassName?: string;
  interactiveItemClassName?: string;
  valueClassName?: string;
  labelClassName?: string;
  iconClassName?: string;
  /** Show skeleton placeholder instead of items. Default loadingRows is 6. */
  isLoading?: boolean;
  /** Number of skeleton items to render in loading state. */
  loadingRows?: number;
  /** Shown when items is empty and not loading or erring. */
  emptyState?: ReactNode;
  /** Shown instead of grid content when truthy. Takes priority over loading/empty. */
  error?: string | ReactNode;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function MetricGrid({
  items,
  className,
  itemClassName,
  interactiveItemClassName,
  valueClassName,
  labelClassName,
  iconClassName,
  isLoading,
  loadingRows,
  emptyState,
  error,
}: MetricGridProps) {
  if (error) {
    return (
      <div className={cx(styles.grid, className)} role="alert">
        <div className={cx(styles.item)} style={{ gridColumn: '1 / -1' }}>
          {typeof error === 'string' ? (
            <span className={styles.label}>{error}</span>
          ) : (
            error
          )}
        </div>
      </div>
    );
  }

  if (isLoading) {
    const rows = loadingRows ?? 6;
    return (
      <div className={cx(styles.grid, className)}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className={cx(styles.item, itemClassName)}>
            <SkeletonBar width="40%" height="14px" lines={1} />
            <SkeletonBar width="65%" height="10px" lines={1} gap="4px" />
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0 && emptyState !== undefined) {
    return <>{emptyState}</>;
  }

  return (
    <div className={cx(styles.grid, className)}>
      {items.map((item) => {
        const readableValue = typeof item.value === 'string' || typeof item.value === 'number'
          ? item.value
          : undefined;
        const readableLabel = typeof item.label === 'string' || typeof item.label === 'number'
          ? item.label
          : undefined;
        const ariaName = item.ariaLabel
          ?? (readableValue !== undefined && readableLabel !== undefined ? `${readableValue} ${readableLabel}` : undefined);
        const content = (
          <>
            {item.icon ? <span className={cx(styles.icon, iconClassName)}>{item.icon}</span> : null}
            <strong className={cx(styles.value, valueClassName)}>{item.value}</strong>
            <span className={cx(styles.label, labelClassName)}>{item.label}</span>
          </>
        );

        if (item.onClick) {
          return (
            <button
              key={item.id}
              className={cx(styles.item, styles.itemButton, itemClassName, interactiveItemClassName)}
              type="button"
              aria-label={ariaName}
              onClick={item.onClick}
            >
              {content}
            </button>
          );
        }

        return (
          <div key={item.id} className={cx(styles.item, itemClassName)}>
            {content}
          </div>
        );
      })}
    </div>
  );
}
