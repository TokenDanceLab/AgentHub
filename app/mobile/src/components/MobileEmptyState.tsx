import type { ReactNode } from "react";

interface MobileEmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  actionIcon?: ReactNode;
  onAction?: () => void;
}

export function MobileEmptyState({
  icon,
  title,
  description,
  actionLabel,
  actionIcon,
  onAction,
}: MobileEmptyStateProps) {
  return (
    <section className="mobileEmptyView" aria-label={title}>
      <div className="mobileEmptyIcon" aria-hidden="true">{icon}</div>
      <h1>{title}</h1>
      <p>{description}</p>
      {actionLabel && onAction && (
        <button className="mobileEmptyAction" type="button" onClick={onAction}>
          {actionIcon}
          <span>{actionLabel}</span>
        </button>
      )}
    </section>
  );
}
