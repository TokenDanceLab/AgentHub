import { useQuery } from "@tanstack/react-query";
import { listThreads, getHealth } from "@agenthub/shared";
import type { Thread, Run } from "@agenthub/shared";
import { StatusBadge } from "@agenthub/shared/components";
import type { StatusVariant } from "@agenthub/shared/components";
import { MessageSquare, AlertCircle, RefreshCw } from "lucide-react";

interface ThreadListViewProps {
  onThreadSelect: (thread: Thread) => void;
  onRunSelect: (run: Run) => void;
}

function threadStatusToVariant(status: Thread["status"]): StatusVariant {
  return status === "active" ? "online" : "offline";
}

export function ThreadListView({ onThreadSelect }: ThreadListViewProps) {
  const health = useQuery({ queryKey: ["health"], queryFn: getHealth });
  const threads = useQuery({
    queryKey: ["threads"],
    queryFn: () => listThreads({ pageSize: 50 }),
  });

  const isConnected = health.data?.status === "ok";

  return (
    <div className="flex flex-col h-full">
      <header
        className="glass shrink-0 flex items-center justify-between px-4"
        style={{
          height: "calc(56px + env(safe-area-inset-top))",
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        <h1 className="text-lg font-semibold" style={{ color: "var(--td-ink)" }}>
          AgentHub
        </h1>
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{
              backgroundColor: isConnected ? "var(--td-moss)" : "var(--td-danger)",
            }}
          />
          <span className="text-xs" style={{ color: "var(--td-ink-50)" }}>
            {isConnected ? "Connected" : "Offline"}
          </span>
        </div>
      </header>

      <div className="flex-1 scroll-container px-3 py-2">
        {threads.isLoading && (
          <div className="flex items-center justify-center py-12">
            <RefreshCw size={24} className="animate-spin" style={{ color: "var(--td-ink-30)" }} />
          </div>
        )}

        {threads.isError && (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <AlertCircle size={32} style={{ color: "var(--td-danger)" }} />
            <p className="text-sm" style={{ color: "var(--td-ink-50)" }}>
              Failed to load threads
            </p>
          </div>
        )}

        {threads.data?.items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <MessageSquare size={32} style={{ color: "var(--td-ink-30)" }} />
            <p className="text-sm" style={{ color: "var(--td-ink-50)" }}>
              No threads yet
            </p>
          </div>
        )}

        {threads.data?.items.map((thread) => (
          <button
            key={thread.id}
            onClick={() => onThreadSelect(thread)}
            className="w-full text-left flex items-center gap-3 px-3 py-3 rounded-lg
                       transition-colors duration-150 mb-1"
            style={{
              backgroundColor: "var(--td-surface)",
              border: "1px solid var(--td-line)",
            }}
          >
            <MessageSquare size={20} style={{ color: "var(--td-ink-50)" }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: "var(--td-ink)" }}>
                {thread.title || thread.id}
              </p>
              <p className="text-xs truncate" style={{ color: "var(--td-ink-50)" }}>
                {thread.projectId}
              </p>
            </div>
            <StatusBadge status={threadStatusToVariant(thread.status)} />
          </button>
        ))}
      </div>
    </div>
  );
}
