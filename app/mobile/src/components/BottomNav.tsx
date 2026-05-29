import type { MobileView } from "../App";
import { MessageSquare, Play, UserRound, Hash } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getSurfaceMetadata, type SurfaceId } from "@agenthub/shared";

const NAV_ITEMS: { view: MobileView; surfaceId: SurfaceId; icon: typeof MessageSquare }[] = [
  { view: "threads", surfaceId: "mobile.threads", icon: Hash },
  { view: "chat", surfaceId: "mobile.chat", icon: MessageSquare },
  { view: "runs", surfaceId: "mobile.runs", icon: Play },
  { view: "account", surfaceId: "mobile.account", icon: UserRound },
];

interface BottomNavProps {
  activeView: MobileView;
  onNavigate: (view: MobileView) => void;
  activeThreadCount?: number;
  pendingReviewCount?: number;
}

export function BottomNav({ activeView, onNavigate, activeThreadCount = 0, pendingReviewCount = 0 }: BottomNavProps) {
  const { t } = useTranslation();

  return (
    <nav className="mobileBottomNav" aria-label={t("nav.primary")}>
      {NAV_ITEMS.map((item) => {
        const isActive = item.view === activeView;
        const surface = getSurfaceMetadata(item.surfaceId);
        const label = t(surface.labelKey);
        const description = t(surface.descriptionKey);
        const badge =
          item.view === "threads" && activeThreadCount > 0
            ? String(activeThreadCount)
            : item.view === "runs" && pendingReviewCount > 0
              ? String(pendingReviewCount)
              : null;
        const countLabel =
          item.view === "threads" && activeThreadCount > 0
            ? `${label}, ${activeThreadCount} ${t("nav.activeThreads")}`
            : item.view === "runs" && pendingReviewCount > 0
              ? `${label}, ${pendingReviewCount} ${t("nav.pendingReviews")}`
              : `${label}. ${description}`;
        return (
          <button
            key={item.view}
            onClick={() => onNavigate(item.view)}
            className={`mobileNavButton${isActive ? " mobileNavButtonActive" : ""}`}
            aria-label={countLabel}
            aria-current={isActive ? "page" : undefined}
          >
            <span className="mobileNavIconWrap">
              <item.icon size={22} strokeWidth={isActive ? 2.5 : 2} />
              {badge && <span className="mobileNavBadge">{badge}</span>}
            </span>
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
