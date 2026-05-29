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
}

export function BottomNav({ activeView, onNavigate }: BottomNavProps) {
  const { t } = useTranslation();

  return (
    <nav className="mobileBottomNav" aria-label={t("nav.primary")}>
      {NAV_ITEMS.map((item) => {
        const isActive = item.view === activeView;
        const surface = getSurfaceMetadata(item.surfaceId);
        const label = t(surface.labelKey);
        const description = t(surface.descriptionKey);
        return (
          <button
            key={item.view}
            onClick={() => onNavigate(item.view)}
            className={`mobileNavButton${isActive ? " mobileNavButtonActive" : ""}`}
            aria-label={`${label}. ${description}`}
            aria-current={isActive ? "page" : undefined}
          >
            <item.icon size={22} strokeWidth={isActive ? 2.5 : 2} />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
