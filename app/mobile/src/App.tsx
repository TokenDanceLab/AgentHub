import { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { listRuns, listThreads, type Run, type Thread } from "@agenthub/shared";
import { BottomNav } from "./components/BottomNav";
import { ThreadListView } from "./views/ThreadListView";
import { ChatView } from "./views/ChatView";
import { RunListView } from "./views/RunListView";
import { RunStatusView } from "./views/RunStatusView";
import { AccountView } from "./views/AccountView";
import { EmptyState } from "@agenthub/shared/ui";
import { Hash } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useKeyboardAvoidance } from "./hooks/useKeyboardAvoidance";
import { useRunNotifications } from "./hooks/useRunNotifications";

export type MobileView = "threads" | "chat" | "runs" | "account";

export function App() {
  const { t } = useTranslation();
  const [activeView, setActiveView] = useState<MobileView>("threads");
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const threadsBadge = useQuery({
    queryKey: ["threads"],
    queryFn: () => listThreads({ pageSize: 50 }),
    retry: false,
  });
  const runsBadge = useQuery({
    queryKey: ["runs"],
    queryFn: () => listRuns({ pageSize: 30 }),
    retry: false,
    refetchInterval: 5000,
  });
  const cachedThreads = threadsBadge.data?.items ?? [];
  const cachedRuns = runsBadge.data?.items ?? [];
  const activeThreadCount = cachedThreads.filter((thread) => thread.status === "active").length;
  const pendingReviewCount = cachedRuns.filter((run) => run.status === "waiting_approval").length;

  const { visualViewportHeight, isKeyboardVisible, keyboardHeight, cssVars } = useKeyboardAvoidance();

  // Background poller — triggers native notifications on run status changes.
  useRunNotifications();

  // Apply keyboard-aware CSS custom properties to <html> so the whole layout can react.
  useEffect(() => {
    const root = document.documentElement;
    for (const [prop, value] of Object.entries(cssVars)) {
      root.style.setProperty(prop, value);
    }
  }, [cssVars]);

  const handleThreadSelect = useCallback((thread: Thread) => {
    setSelectedThread(thread);
    setActiveView("chat");
  }, []);

  const handleRunSelect = useCallback((run: Run) => {
    setSelectedRun(run);
    setActiveView("runs");
  }, []);

  const handleBackToThreads = useCallback(() => {
    setSelectedThread(null);
    setActiveView("threads");
  }, []);

  const handleNavigate = useCallback((view: MobileView) => {
    if (view === "chat") {
      setSelectedThread(null);
    }
    if (view === "runs") {
      setSelectedRun(null);
    }
    setActiveView(view);
  }, []);

  return (
    <div
      className="mobileAppShell"
      style={{
        height: `${visualViewportHeight}px`,
        // When keyboard is visible, allow the main area to shrink so the composer stays visible
        // The scroll container inside will handle overflow
      }}
    >
      <main className="mobileAppMain">
        {activeView === "threads" && (
          <ThreadListView
            onThreadSelect={handleThreadSelect}
            onOpenAccount={() => setActiveView("account")}
          />
        )}
        {activeView === "chat" && selectedThread && (
          <ChatView
            thread={selectedThread}
            onBack={handleBackToThreads}
          />
        )}
        {activeView === "chat" && !selectedThread && (
          <EmptyState
            icon={<Hash size={24} />}
            title={t("empty.selectThread.title")}
            description={t("empty.selectThread.description")}
            titleLevel={1}
            className="mobileEmptyView"
            iconClassName="mobileEmptyIcon"
            actionClassName="mobileEmptyAction"
            action={{ label: t("empty.selectThread.action"), onClick: () => setActiveView("threads") }}
          />
        )}
        {activeView === "runs" && !selectedRun && (
          <RunListView
            onRunSelect={handleRunSelect}
            onOpenAccount={() => setActiveView("account")}
          />
        )}
        {activeView === "runs" && selectedRun && (
          <RunStatusView
            run={selectedRun}
            onBack={() => setSelectedRun(null)}
          />
        )}
        {activeView === "account" && <AccountView />}
      </main>

      <BottomNav
        activeView={activeView}
        onNavigate={handleNavigate}
        activeThreadCount={activeThreadCount}
        pendingReviewCount={pendingReviewCount}
      />
    </div>
  );
}
