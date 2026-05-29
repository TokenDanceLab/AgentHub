import React, { type ReactNode } from 'react';
import styles from './MetricGrid.module.css';

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
}: MetricGridProps) {
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
