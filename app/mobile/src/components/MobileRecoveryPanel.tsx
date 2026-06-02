import type { ReactNode } from "react";
import { RecoveryPanel } from "@agenthub/shared/ui";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

interface MobileRecoveryPanelProps {
  icon: ReactNode;
  eyebrow?: string;
  title: string;
  description: string;
  meta?: string;
  isRetrying: boolean;
  onRetry: () => void;
  secondaryLabel?: string;
  secondaryIcon?: ReactNode;
  onSecondaryAction?: () => void;
}

export function MobileRecoveryPanel({
  icon,
  eyebrow = "Recovery",
  title,
  description,
  meta,
  isRetrying,
  onRetry,
  secondaryLabel,
  secondaryIcon,
  onSecondaryAction,
}: MobileRecoveryPanelProps) {
  const { t } = useTranslation();
  const secondaryAction = secondaryLabel && onSecondaryAction
    ? {
        label: secondaryLabel,
        icon: secondaryIcon,
        onClick: onSecondaryAction,
      }
    : undefined;

  return (
    <RecoveryPanel
      icon={icon}
      eyebrow={eyebrow}
      title={title}
      description={description}
      meta={meta}
      className="mobileRecoveryPanel"
      iconClassName="mobileRecoveryIcon"
      bodyClassName="mobileRecoveryBody"
      eyebrowClassName="mobileEyebrow"
      descriptionClassName="mobileRecoveryDescription"
      metaClassName="mobileRecoveryMeta"
      actionsClassName="mobileRecoveryActions"
      actionClassName="mobileActionButton"
      primaryAction={{
        label: t("common.actions.retry"),
        busyLabel: t("common.actions.retrying"),
        icon: <RefreshCw size={16} className={isRetrying ? "mobileSpin" : undefined} />,
        busy: isRetrying,
        className: "mobileRecoveryAction",
        onClick: onRetry,
      }}
      {...(secondaryAction ? { secondaryAction } : {})}
    />
  );
}
