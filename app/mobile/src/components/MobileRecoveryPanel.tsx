import type { ReactNode } from "react";
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

  return (
    <section className="mobileRecoveryPanel" role="alert" aria-label={title}>
      <span className="mobileRecoveryIcon">{icon}</span>
      <div className="mobileRecoveryBody">
        <p className="mobileEyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p className="mobileRecoveryDescription">{description}</p>
        {meta && <span className="mobileRecoveryMeta">{meta}</span>}
      </div>
      <div className="mobileRecoveryActions">
        <button
          className="mobileActionButton mobileRecoveryAction"
          type="button"
          disabled={isRetrying}
          onClick={onRetry}
          aria-busy={isRetrying}
        >
          <RefreshCw size={16} className={isRetrying ? "mobileSpin" : undefined} />
          <span>{isRetrying ? t("common.actions.retrying") : t("common.actions.retry")}</span>
        </button>
        {secondaryLabel && onSecondaryAction && (
          <button
            className="mobileActionButton"
            type="button"
            onClick={onSecondaryAction}
          >
            {secondaryIcon}
            <span>{secondaryLabel}</span>
          </button>
        )}
      </div>
    </section>
  );
}
