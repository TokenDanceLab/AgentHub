import { ArrowLeft, RefreshCw } from "lucide-react";
import { StatusBadge } from "@agenthub/shared/components";
import type { StatusVariant } from "@agenthub/shared/components";
import type { Run, RunStatus } from "@agenthub/shared";
import { useQuery } from "@tanstack/react-query";
import { getRun, getRunLogs } from "@agenthub/shared";

interface RunStatusViewProps {
  run: Run;
  onBack: () => void;
}

function runStatusToVariant(s: RunStatus): StatusVariant {
  switch (s) {
    case "queued": return "pending";
    case "starting": return "pending";
    case "running": return "running";
    case "waiting_approval": return "review";
    case "finished": return "done";
    default: return "pending";
  }
}

export function RunStatusView({ run, onBack }: RunStatusViewProps) {
  const runDetail = useQuery({
    queryKey: ["run", run.runId],
    queryFn: () => getRun(run.runId),
    refetchInterval: 5000,
  });

  const logs = useQuery({
    queryKey: ["run-logs", run.runId],
    queryFn: () => getRunLogs(run.runId),
  });

  const status = runDetail.data?.status ?? run.status;

  return (
    <div className="flex flex-col h-full">
      <header
        className="glass shrink-0 flex items-center gap-3 px-3"
        style={{
          height: "calc(56px + env(safe-area-inset-top))",
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        <button
          onClick={onBack}
          className="flex items-center justify-center rounded-lg"
          style={{ width: 40, height: 40, color: "var(--td-ink-70)" }}
          aria-label="Back"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <h2 className="text-base font-semibold truncate" style={{ color: "var(--td-ink)" }}>
            Run {run.runId.slice(0, 8)}
          </h2>
          <StatusBadge status={runStatusToVariant(status)} />
        </div>
        {runDetail.isFetching && (
          <RefreshCw size={14} className="animate-spin" style={{ color: "var(--td-ink-30)" }} />
        )}
      </header>

      <div className="flex-1 scroll-container px-3 py-3">
        <pre
          className="text-xs font-mono whitespace-pre-wrap rounded-lg p-3"
          style={{
            backgroundColor: "var(--td-surface)",
            border: "1px solid var(--td-line)",
            color: "var(--td-ink-70)",
            minHeight: 100,
          }}
        >
          {logs.data?.stdout ?? "Waiting for output..."}
        </pre>
      </div>
    </div>
  );
}
