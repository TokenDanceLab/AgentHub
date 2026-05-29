import { ArrowLeft, RefreshCw } from "lucide-react";
import { StatusBadge } from "@agenthub/shared/components";
import type { StatusVariant } from "@agenthub/shared/components";
import type { Run, RunStatus } from "@agenthub/shared";
import { useQuery } from "@tanstack/react-query";
import { getRun, getRunLogs } from "@agenthub/shared";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
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
    <div className="mobileView">
      <header className="mobileHeader mobileChatHeader">
        <button
          onClick={onBack}
          className="mobileIconButton"
          type="button"
          aria-label={t("runDetail.actions.back")}
        >
          <ArrowLeft size={20} />
        </button>
        <div className="mobileHeaderTitle">
          <p className="mobileEyebrow">{t("runDetail.header.eyebrow")}</p>
          <h1>{t("runDetail.header.title", { runId: run.runId.slice(0, 8) })}</h1>
        </div>
        <div className="mobileStatusBadge">
          <StatusBadge status={runStatusToVariant(status)} />
        </div>
        {runDetail.isFetching && (
          <RefreshCw size={14} className="mobileSpin" />
        )}
      </header>

      <div className="mobileScroll">
        <section className="mobileOverviewPanel">
          <p className="mobileEyebrow">{t("runDetail.context.eyebrow")}</p>
          <h2>{run.projectId}</h2>
          <div className="mobileMetricGrid">
            <div className="mobileMetricTile">
              <strong>{status}</strong>
              <span>{t("runDetail.context.status")}</span>
            </div>
            <div className="mobileMetricTile">
              <strong>{run.threadId.slice(0, 8)}</strong>
              <span>{t("runDetail.context.thread")}</span>
            </div>
            <div className="mobileMetricTile">
              <strong>{new Date(run.startedAt ?? run.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong>
              <span>{t("runDetail.context.started")}</span>
            </div>
          </div>
        </section>

        <pre className="mobileLogBlock">
          {logs.data?.stdout ?? t("runDetail.context.waitingOutput")}
        </pre>
      </div>
    </div>
  );
}
