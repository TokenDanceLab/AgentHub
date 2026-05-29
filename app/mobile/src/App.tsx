import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { listRuns, listThreads, type Run, type Thread } from "@agenthub/shared";
import { BottomNav } from "./components/BottomNav";
import { ThreadListView } from "./views/ThreadListView";
import { ChatView } from "./views/ChatView";
import { RunListView } from "./views/RunListView";
import { RunStatusView } from "./views/RunStatusView";
import { AccountView } from "./views/AccountView";
import { MobileEmptyState } from "./components/MobileEmptyState";
import { Hash } from "lucide-react";
import { useTranslation } from "react-i18next";

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
    <div className="mobileAppShell">
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
          <MobileEmptyState
            icon={<Hash size={24} />}
            title={t("empty.selectThread.title")}
            description={t("empty.selectThread.description")}
            actionLabel={t("empty.selectThread.action")}
            onAction={() => setActiveView("threads")}
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
