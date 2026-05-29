import React, { type ReactNode } from 'react';
import styles from './ContextSummary.module.css';

export interface ContextSummaryItem {
  id: string;
  label: ReactNode;
  value: ReactNode;
}

export interface ContextSummaryProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  items: ContextSummaryItem[];
  className?: string;
  headerClassName?: string;
  eyebrowClassName?: string;
  titleClassName?: string;
  listClassName?: string;
  itemClassName?: string;
  labelClassName?: string;
  valueClassName?: string;
  ariaLabel?: string;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function ContextSummary({
  eyebrow,
  title,
  items,
  className,
  headerClassName,
  eyebrowClassName,
  titleClassName,
  listClassName,
  itemClassName,
  labelClassName,
  valueClassName,
  ariaLabel,
}: ContextSummaryProps) {
  return (
    <section className={cx(styles.summary, className)} aria-label={ariaLabel}>
      <div className={cx(styles.header, headerClassName)}>
        {eyebrow ? <p className={cx(styles.eyebrow, eyebrowClassName)}>{eyebrow}</p> : null}
        <h2 className={cx(styles.title, titleClassName)}>{title}</h2>
      </div>
      <dl className={cx(styles.list, listClassName)}>
        {items.map((item) => (
          <div key={item.id} className={cx(styles.item, itemClassName)}>
            <dt className={cx(styles.label, labelClassName)}>{item.label}</dt>
            <dd className={cx(styles.value, valueClassName)}>{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
