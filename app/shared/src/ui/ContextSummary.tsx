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
      {description ? <p className={cx(styles.description, descriptionClassName)}>{description}</p> : null}
      <dl className={cx(styles.list, listClassName)}>
        {items.map((item) => (
          <div key={item.id} className={cx(styles.item, itemClassName)}>
            <dt className={cx(styles.label, labelClassName)}>{item.label}</dt>
            <dd className={cx(styles.value, valueClassName)}>{item.value}</dd>
          </div>
        ))}
      </dl>
      {actions ? <div className={cx(styles.actions, actionsClassName)}>{actions}</div> : null}
    </section>
  );
}
