import React, { type ReactNode } from 'react';
import styles from './ActionList.module.css';

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
}: ActionListProps) {
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
