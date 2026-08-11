import React, { type ReactNode } from 'react';
import { cx } from './cx';
import { Button } from './Button';
import styles from './RecoveryPanel.module.css';

export interface RecoveryPanelAction {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  busy?: boolean;
  busyLabel?: string;
  disabled?: boolean;
  className?: string;
}

export interface RecoveryPanelProps {
  icon: ReactNode;
  eyebrow?: string;
  title: string;
  description: string;
  meta?: string;
  primaryAction: RecoveryPanelAction;
  secondaryAction?: RecoveryPanelAction;
  className?: string;
  iconClassName?: string;
  bodyClassName?: string;
  eyebrowClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  metaClassName?: string;
  actionsClassName?: string;
  actionClassName?: string;
}


function RecoveryActionButton({
  action,
  variant,
  baseClassName,
}: {
  action: RecoveryPanelAction;
  variant: 'primary' | 'secondary';
  baseClassName?: string;
}) {
  const label = action.busy && action.busyLabel ? action.busyLabel : action.label;

  return (
    <Button
      variant={variant}
      className={cx(baseClassName, action.className)}
      type="button"
      disabled={action.disabled || action.busy}
      aria-busy={action.busy || undefined}
      onClick={action.onClick}
    >
      {action.icon}
      <span>{label}</span>
    </Button>
  );
}

export function RecoveryPanel({
  icon,
  eyebrow = 'Recovery',
  title,
  description,
  meta,
  primaryAction,
  secondaryAction,
  className,
  iconClassName,
  bodyClassName,
  eyebrowClassName,
  titleClassName,
  descriptionClassName,
  metaClassName,
  actionsClassName,
  actionClassName,
}: RecoveryPanelProps) {
  return (
    <section className={cx(styles.panel, className)} role="alert" aria-label={title}>
      <span className={cx(styles.icon, iconClassName)} aria-hidden="true">
        {icon}
      </span>
      <div className={cx(styles.body, bodyClassName)}>
        <p className={cx(styles.eyebrow, eyebrowClassName)}>{eyebrow}</p>
        <h2 className={cx(styles.title, titleClassName)}>{title}</h2>
        <p className={cx(styles.description, descriptionClassName)}>{description}</p>
        {meta ? <span className={cx(styles.meta, metaClassName)}>{meta}</span> : null}
      </div>
      <div className={cx(styles.actions, actionsClassName)}>
        <RecoveryActionButton
          action={primaryAction}
          variant="primary"
          {...(actionClassName ? { baseClassName: actionClassName } : {})}
        />
        {secondaryAction ? (
          <RecoveryActionButton
            action={secondaryAction}
            variant="secondary"
            {...(actionClassName ? { baseClassName: actionClassName } : {})}
          />
        ) : null}
      </div>
    </section>
  );
}
