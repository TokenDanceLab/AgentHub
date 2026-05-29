import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listRuns } from "@agenthub/shared";
import type { Run, RunStatus } from "@agenthub/shared";
import { getStatusVariantClassName, StatusBadge } from "@agenthub/shared/components";
import { EmptyState, SegmentedControl } from "@agenthub/shared/ui";
import type { StatusVariant } from "@agenthub/shared/components";
import { useTranslation } from "react-i18next";
import { AlertCircle, ArrowRight, CheckCircle2, Clock3, GitPullRequestArrow, Play, Radio, RefreshCw, ShieldAlert, TerminalSquare, UserRound } from "lucide-react";
import { MobileRecoveryPanel } from "../components/MobileRecoveryPanel";
import { getMobileHubHealth } from "../native/hubHealth";

interface RunListViewProps {
  onRunSelect: (run: Run) => void;
  onOpenAccount: () => void;
}

function runStatusToVariant(status: RunStatus): StatusVariant {
  switch (status) {
    case "queued":
    case "starting":
      return "pending";
    case "running":
      return "running";
    case "waiting_approval":
      return "review";
    case "finished":
      return "done";
    case "failed":
      return "error";
    case "cancelled":
      return "offline";
    default:
      return "pending";
  }
}

function runStatusLabelKey(status: RunStatus): string {
  switch (status) {
    case "queued":
      return "queue.statusLabels.queued";
    case "starting":
      return "queue.statusLabels.starting";
    case "running":
      return "queue.statusLabels.running";
    case "waiting_approval":
      return "queue.statusLabels.review";
    case "finished":
      return "queue.statusLabels.done";
    case "failed":
      return "queue.statusLabels.error";
    case "cancelled":
      return "queue.statusLabels.cancelled";
    default:
      return "queue.statusLabels.pending";
  }
}

function formatRunTime(run: Run): string {
  const timestamp = run.startedAt ?? run.createdAt;
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function runRowClassName(status: RunStatus): string {
  if (status === "waiting_approval") {
    return "mobileRunItem mobileRunItemReview";
  }
  if (["queued", "starting", "running"].includes(status)) {
    return "mobileRunItem mobileRunItemActive";
  }
  if (status === "finished") {
    return "mobileRunItem mobileRunItemDone";
  }
  return "mobileRunItem mobileRunItemIssue";
}

type RunFilter = "all" | "review" | "active" | "closed";

function matchesRunFilter(run: Run, filter: RunFilter): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "review") {
    return run.status === "waiting_approval";
  }
  if (filter === "active") {
    return ["queued", "starting", "running"].includes(run.status);
  }
  return isClosedRun(run);
}

function isClosedRun(run: Run): boolean {
  return ["finished", "failed", "cancelled"].includes(run.status);
}

export function RunListView({ onRunSelect, onOpenAccount }: RunListViewProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<RunFilter>("all");
  const health = useQuery({ queryKey: ["mobile-hub-health"], queryFn: getMobileHubHealth, retry: false });
  const runs = useQuery({
    queryKey: ["runs"],
    queryFn: () => listRuns({ pageSize: 30 }),
    refetchInterval: 5000,
    retry: false,
  });

  const isConnected = health.data?.status === "ok";
  const workflowUnavailable = isConnected && runs.isError;
  const isRefreshing = runs.isFetching && !runs.isLoading;
  const items = runs.data?.items ?? [];
  const reviewRuns = items.filter((run) => run.status === "waiting_approval").length;
  const activeRuns = items.filter((run) => ["queued", "starting", "running"].includes(run.status)).length;
  const closedRuns = items.filter(isClosedRun).length;
  const nextReviewRun = items.find((run) => run.status === "waiting_approval");
  const visibleItems = useMemo(
    () => items.filter((run) => matchesRunFilter(run, filter)),
    [filter, items],
  );

  const filterOptions: Array<{
    value: RunFilter;
    label: string;
    count: number;
    icon: typeof Play;
  }> = [
    { value: "all", label: t("queue.common.all"), count: items.length, icon: Play },
    { value: "review", label: t("queue.common.review"), count: reviewRuns, icon: ShieldAlert },
    { value: "active", label: t("queue.common.active"), count: activeRuns, icon: TerminalSquare },
    { value: "closed", label: t("queue.common.closed"), count: closedRuns, icon: CheckCircle2 },
  ];

  return (
    <div className="mobileView">
      <header className="mobileHeader">
        <div>
          <p className="mobileEyebrow">{t("common.appName")}</p>
          <h1>{t("queue.runs.title")}</h1>
        </div>
        <div className="mobileStatusBadge">
          <div
            className="mobileStatusDot"
            style={{
              backgroundColor: isConnected ? "var(--td-moss)" : "var(--td-danger)",
            }}
          />
          <span>
            {isConnected
              ? workflowUnavailable
                ? t("queue.status.reachable")
                : t("queue.status.connected")
              : t("queue.status.offline")}
          </span>
        </div>
      </header>

      <div className="mobileScroll mobileRunsSurface">
        <section className="mobileOverviewPanel">
          <div className="mobileOverviewTitleRow">
            <div>
              <p className="mobileEyebrow">{t("queue.runs.eyebrow")}</p>
              <h2>{t("queue.runs.overviewTitle")}</h2>
            </div>
            <button
              className="mobileIconButton"
              type="button"
              aria-label={t("queue.runs.refresh")}
              aria-busy={isRefreshing}
              onClick={() => runs.refetch()}
            >
              <RefreshCw size={18} className={isRefreshing ? "mobileSpin" : undefined} />
            </button>
          </div>
          <div className="mobileMetricGrid">
            <div className="mobileMetricTile">
              <strong>{activeRuns}</strong>
              <span>{t("queue.runs.metricActive")}</span>
            </div>
            <div className="mobileMetricTile">
              <strong>{reviewRuns}</strong>
              <span>{t("queue.runs.metricReview")}</span>
            </div>
            <div className="mobileMetricTile">
              <strong>{items.length}</strong>
              <span>{t("queue.common.total")}</span>
            </div>
          </div>
          <div className="mobileSignalRow">
            <Radio size={14} />
            <span>
              {isConnected
                ? workflowUnavailable
                  ? t("queue.runs.signalPending")
                  : t("queue.runs.signalOnline")
                : t("queue.runs.signalOffline")}
            </span>
          </div>
          {isRefreshing && (
            <div className="mobileRefreshStatus" role="status" aria-live="polite">
              <RefreshCw size={13} className="mobileSpin" />
              <span>{t("queue.runs.refreshing")}</span>
            </div>
          )}
        </section>

        {nextReviewRun && (filter === "all" || filter === "review") && (
          <button
            className="mobileRunTriageCard"
            type="button"
            aria-label={t("queue.runs.nextReviewAria", { runId: nextReviewRun.runId })}
            onClick={() => onRunSelect(nextReviewRun)}
          >
            <span className="mobileRunTriageIcon">
              <ShieldAlert size={18} />
            </span>
            <div className="mobileRunTriageBody">
              <p>{t("queue.runs.nextReview")}</p>
              <h2>{t("queue.runs.runLabel", { runId: nextReviewRun.runId.slice(0, 8) })}</h2>
              <span>
                <Clock3 size={12} />
                {formatRunTime(nextReviewRun)}
              </span>
            </div>
            <span className="mobileRunTriageAction" aria-hidden="true">
              <ArrowRight size={17} />
            </span>
          </button>
        )}

        <SegmentedControl
          ariaLabel={t("queue.runs.filters")}
          value={filter}
          onChange={setFilter}
          className="mobileSegmentedToolbar mobileRunFilterToolbar"
          optionClassName="mobileSegmentButton"
          activeOptionClassName="mobileSegmentButtonActive"
          options={filterOptions.map((option) => {
            const Icon = option.icon;
            return {
              value: option.value,
              label: option.label,
              meta: option.count,
              icon: <Icon size={14} />,
            };
          })}
        />

        {runs.isLoading && (
          <div className="mobileCenterState">
            <RefreshCw size={24} className="mobileSpin" />
            <strong>{t("queue.runs.loadingTitle")}</strong>
            <p>{t("queue.runs.loadingDescription")}</p>
          </div>
        )}

        {runs.isError && (
          <MobileRecoveryPanel
            icon={<AlertCircle size={18} />}
            eyebrow={isConnected ? t("queue.runs.recoveryEyebrowReachable") : t("queue.runs.recoveryEyebrowOffline")}
            title={t("queue.runs.recoveryTitle")}
            description={
              isConnected
                ? t("queue.runs.recoveryReachable")
                : t("queue.runs.recoveryOffline")
            }
            meta={runs.errorUpdatedAt ? t("queue.common.lastAttempt", { time: new Date(runs.errorUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }) : undefined}
            isRetrying={runs.isFetching}
            onRetry={() => {
              void health.refetch();
              void runs.refetch();
            }}
            secondaryLabel={t("queue.common.account")}
            secondaryIcon={<UserRound size={16} />}
            onSecondaryAction={onOpenAccount}
          />
        )}

        {!runs.isLoading && !runs.isError && items.length === 0 && (
          <EmptyState
            icon={<Play size={24} />}
            title={t("queue.runs.emptyTitle")}
            description={t("queue.runs.emptyDescription")}
            className="mobileCenterState"
            iconClassName="mobileEmptyIcon"
          />
        )}

        {!runs.isLoading && !runs.isError && items.length > 0 && visibleItems.length === 0 && (
          <EmptyState
            icon={<TerminalSquare size={24} />}
            title={t("queue.runs.emptyFilterTitle", { filter: t(`queue.common.${filter}`) })}
            description={t("queue.runs.emptyFilterDescription")}
            className="mobileCenterState"
            iconClassName="mobileEmptyIcon"
            actionClassName="mobileActionButton"
            action={{ label: t("queue.common.showAll"), icon: <Play size={16} />, onClick: () => setFilter("all") }}
          />
        )}

        {!runs.isError && (
          <div className="mobileListStack">
            {visibleItems.map((run) => (
              <button
                key={run.runId}
                className={runRowClassName(run.status)}
                type="button"
                onClick={() => onRunSelect(run)}
              >
                <span className="mobileRunIcon">
                  <TerminalSquare size={18} />
                </span>
                <span className="mobileListItemBody">
                  <span className="mobileListItemTitle">{t("queue.runs.runLabel", { runId: run.runId.slice(0, 8) })}</span>
                  <span className="mobileRunMetaStack">
                    <span className="mobileListItemMeta">
                      <Clock3 size={12} />
                      {formatRunTime(run)}
                    </span>
                    <span className="mobileListItemMeta">
                      <GitPullRequestArrow size={12} />
                      {run.threadId}
                    </span>
                  </span>
                </span>
                <StatusBadge
                  status={runStatusToVariant(run.status)}
                  label={t(runStatusLabelKey(run.status))}
                  className={`mobileQueueStatusBadge mobileQueueStatusBadge-${getStatusVariantClassName(runStatusToVariant(run.status))}`}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
