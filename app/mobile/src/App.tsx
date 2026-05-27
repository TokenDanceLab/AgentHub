import { useState, useCallback } from "react";
import type { Run, Thread } from "@agenthub/shared";
import { BottomNav } from "./components/BottomNav";
import { ThreadListView } from "./views/ThreadListView";
import { ChatView } from "./views/ChatView";
import { RunStatusView } from "./views/RunStatusView";
import { SettingsView } from "./views/SettingsView";

export type MobileView = "threads" | "chat" | "runs" | "settings";

export function App() {
  const [activeView, setActiveView] = useState<MobileView>("threads");
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);

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

  return (
    <div className="flex flex-col h-dvh bg-[var(--td-canvas)]">
      {/* Main content area */}
      <main className="flex-1 min-h-0">
        {activeView === "threads" && (
          <ThreadListView
            onThreadSelect={handleThreadSelect}
            onRunSelect={handleRunSelect}
          />
        )}
        {activeView === "chat" && selectedThread && (
          <ChatView
            thread={selectedThread}
            onBack={handleBackToThreads}
          />
        )}
        {activeView === "runs" && selectedRun && (
          <RunStatusView
            run={selectedRun}
            onBack={() => setActiveView("threads")}
          />
        )}
        {activeView === "settings" && <SettingsView />}
      </main>

      {/* Bottom navigation */}
      <BottomNav activeView={activeView} onNavigate={setActiveView} />
    </div>
  );
}
