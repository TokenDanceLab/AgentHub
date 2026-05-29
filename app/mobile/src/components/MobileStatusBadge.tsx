import type { StatusVariant } from "@agenthub/shared/components";

interface MobileStatusBadgeProps {
  status: StatusVariant;
  label: string;
}

function statusClassName(status: StatusVariant): string {
  return status.replace(/\s+/g, "-");
}

export function MobileStatusBadge({ status, label }: MobileStatusBadgeProps) {
  return (
    <span className={`mobileQueueStatusBadge mobileQueueStatusBadge-${statusClassName(status)}`}>
      {label}
    </span>
  );
}
