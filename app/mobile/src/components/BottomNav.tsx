import type { MobileView } from "../App";
import { MessageSquare, Play, Settings, Hash } from "lucide-react";

const NAV_ITEMS: { view: MobileView; label: string; icon: typeof MessageSquare }[] = [
  { view: "threads", label: "Threads", icon: Hash },
  { view: "chat", label: "Chat", icon: MessageSquare },
  { view: "runs", label: "Runs", icon: Play },
  { view: "settings", label: "Settings", icon: Settings },
];

interface BottomNavProps {
  activeView: MobileView;
  onNavigate: (view: MobileView) => void;
}

export function BottomNav({ activeView, onNavigate }: BottomNavProps) {
  return (
    <nav
      className="glass flex justify-around items-center shrink-0"
      style={{
        height: "calc(64px + env(safe-area-inset-bottom))",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {NAV_ITEMS.map((item) => {
        const isActive = item.view === activeView;
        return (
          <button
            key={item.view}
            onClick={() => onNavigate(item.view)}
            className="flex flex-col items-center justify-center gap-0.5 px-3 py-1
                       transition-colors duration-150"
            style={{
              color: isActive ? "var(--td-plum)" : "var(--td-ink-50)",
              minWidth: 64,
              minHeight: 48,
            }}
            aria-label={item.label}
            aria-current={isActive ? "page" : undefined}
          >
            <item.icon size={22} strokeWidth={isActive ? 2.5 : 2} />
            <span className="text-[11px] leading-none font-medium">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
