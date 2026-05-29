import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listThreads } from "@agenthub/shared";
import type { Thread } from "@agenthub/shared";
import { getStatusVariantClassName, StatusBadge } from "@agenthub/shared/components";
import { EmptyState, MetricGrid, SegmentedControl, StatusNotice } from "@agenthub/shared/ui";
import type { StatusVariant } from "@agenthub/shared/components";
import { MessageSquare, AlertCircle, RefreshCw, Radio, Clock3, Play, Archive, UserRound, ArrowRight } from "lucide-react";
import { MobileRecoveryPanel } from "../components/MobileRecoveryPanel";
import { getMobileHubHealth } from "../native/hubHealth";
import { useTranslation } from "react-i18next";

interface ThreadListViewProps {
  onThreadSelect: (thread: Thread) => void;
  onOpenAccount: () => void;
}

function threadStatusToVariant(status: Thread["status"]): StatusVariant {
  return status === "active" ? "online" : "offline";
}

function threadStatusLabelKey(status: Thread["status"]): string {
  return status === "active" ? "queue.statusLabels.online" : "queue.statusLabels.offline";
}

type ThreadFilter = "all" | "active" | "archived";

function matchesThreadFilter(thread: Thread, filter: ThreadFilter): boolean {
  if (filter === "all") return true;
  return thread.status === filter;
}

function formatThreadTime(thread: Thread): string {
  return new Date(thread.updatedAt ?? thread.createdAt).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ThreadListView({ onThreadSelect, onOpenAccount }: ThreadListViewProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<ThreadFilter>("all");
  const health = useQuery({ queryKey: ["mobile-hub-health"], queryFn: getMobileHubHealth, retry: false });
  const threads = useQuery({
    queryKey: ["threads"],
    queryFn: () => listThreads({ pageSize: 50 }),
    retry: false,
  });

  const isConnected = health.data?.status === "ok";
  const workflowUnavailable = isConnected && threads.isError;
  const isRefreshing = threads.isFetching && !threads.isLoading;
  const items = threads.data?.items ?? [];
  const activeCount = items.filter((thread) => thread.status === "active").length;
  const archivedCount = items.filter((thread) => thread.status === "archived").length;
  const visibleItems = useMemo(
    () => items.filter((thread) => matchesThreadFilter(thread, filter)),
    [filter, items],
  );
  const nextActiveThread = items.find((thread) => thread.status === "active");
  const filterOptions: Array<{
    value: ThreadFilter;
    label: string;
    count: number;
    icon: typeof Play;
  }> = [
    { value: "all", label: t("queue.common.all"), count: items.length, icon: Play },
    { value: "active", label: t("queue.common.active"), count: activeCount, icon: MessageSquare },
    { value: "archived", label: t("queue.threads.filterArchived"), count: archivedCount, icon: Archive },
  ];

  return (
    <div className="mobileView">
      <header className="mobileHeader">
        <div>
          <p className="mobileEyebrow">{t("queue.threads.eyebrow")}</p>
          <h1>{t("queue.threads.title")}</h1>
        </div>
        <div className="mobileStatusBadge">
          <span
            className="mobileStatusDot"
            style={{ backgroundColor: isConnected ? "var(--td-moss)" : "var(--td-danger)" }}
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

      <div className="mobileScroll mobileThreadSurface">
        <section className="mobileOverviewPanel">
          <div className="mobileOverviewTitleRow">
            <div>
              <p className="mobileEyebrow">{t("queue.threads.eyebrow")}</p>
              <h2>{t("queue.threads.overviewTitle")}</h2>
            </div>
            <button
              className="mobileIconButton"
              type="button"
              aria-label={t("queue.threads.refresh")}
              aria-busy={threads.isFetching}
              onClick={() => threads.refetch()}
            >
              <RefreshCw size={18} className={threads.isFetching ? "mobileSpin" : undefined} />
            </button>
          </div>
          <MetricGrid
            className="mobileMetricGrid"
            itemClassName="mobileMetricTile"
            items={[
              { id: "active", value: activeCount, label: t("queue.common.active") },
              { id: "archived", value: archivedCount, label: t("queue.common.archived") },
              {
                id: "hub",
                value: isConnected ? t("queue.threads.hubReady") : t("queue.threads.hubDown"),
                label: t("queue.threads.metricHub"),
              },
            ]}
          />
          <StatusNotice className="mobileSignalRow" icon={<Radio size={14} />}>
            {isConnected
              ? workflowUnavailable
                ? t("queue.threads.signalPending")
                : t("queue.threads.signalOnline")
              : t("queue.threads.signalOffline")}
          </StatusNotice>
          {isRefreshing && (
            <StatusNotice className="mobileRefreshStatus" icon={<RefreshCw size={13} className="mobileSpin" />}>
              {t("queue.threads.refreshing")}
            </StatusNotice>
          )}
        </section>

        {nextActiveThread && filter !== "archived" && (
          <button
            className="mobileRunTriageCard"
            type="button"
            aria-label={t("queue.threads.continueAria", { title: nextActiveThread.title || nextActiveThread.id })}
            onClick={() => onThreadSelect(nextActiveThread)}
          >
            <span className="mobileRunTriageIcon">
              <MessageSquare size={18} />
            </span>
            <div className="mobileRunTriageBody">
              <p>{t("queue.threads.continueHandoff")}</p>
              <h2>{nextActiveThread.title || nextActiveThread.id}</h2>
              <span>
                <Clock3 size={12} />
                {formatThreadTime(nextActiveThread)}
              </span>
            </div>
            <span className="mobileRunTriageAction" aria-hidden="true">
              <ArrowRight size={17} />
            </span>
          </button>
        )}

        <SegmentedControl
          ariaLabel={t("queue.threads.filters")}
          value={filter}
          onChange={setFilter}
          className="mobileSegmentedToolbar mobileThreadFilterToolbar"
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

        {threads.isLoading && (
          <div className="mobileCenterState">
            <RefreshCw size={24} className="mobileSpin" />
            <strong>{t("queue.threads.loadingTitle")}</strong>
            <p>{t("queue.threads.loadingDescription")}</p>
          </div>
        )}

        {threads.isError && (
          <MobileRecoveryPanel
            icon={<AlertCircle size={18} />}
            eyebrow={isConnected ? t("queue.threads.recoveryEyebrowReachable") : t("queue.threads.recoveryEyebrowOffline")}
            title={t("queue.threads.recoveryTitle")}
            description={
              isConnected
                ? t("queue.threads.recoveryReachable")
                : t("queue.threads.recoveryOffline")
            }
            meta={threads.errorUpdatedAt ? t("queue.common.lastAttempt", { time: new Date(threads.errorUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }) : undefined}
            isRetrying={threads.isFetching}
            onRetry={() => {
              void health.refetch();
              void threads.refetch();
            }}
            secondaryLabel={t("queue.common.account")}
            secondaryIcon={<UserRound size={16} />}
            onSecondaryAction={onOpenAccount}
          />
        )}

        {!threads.isLoading && !threads.isError && items.length === 0 && (
          <EmptyState
            icon={<MessageSquare size={24} />}
            title={t("queue.threads.emptyTitle")}
            description={t("queue.threads.emptyDescription")}
            className="mobileCenterState"
            iconClassName="mobileEmptyIcon"
          />
        )}

        {!threads.isLoading && !threads.isError && items.length > 0 && visibleItems.length === 0 && (
          <EmptyState
            icon={<Archive size={24} />}
            title={t("queue.threads.emptyFilterTitle", { filter: t(`queue.common.${filter}`) })}
            description={t("queue.threads.emptyFilterDescription")}
            className="mobileCenterState"
            iconClassName="mobileEmptyIcon"
            actionClassName="mobileActionButton"
            action={{ label: t("queue.common.showAll"), icon: <Play size={16} />, onClick: () => setFilter("all") }}
          />
        )}

        {!threads.isError && (
          <div className="mobileListStack">
            {visibleItems.map((thread) => (
              <button
                key={thread.id}
                onClick={() => onThreadSelect(thread)}
                className="mobileThreadItem"
                type="button"
              >
                <span className="mobileThreadIcon">
                  <MessageSquare size={18} />
                </span>
                <span className="mobileListItemBody">
                  <span className="mobileListItemTitle">{thread.title || thread.id}</span>
                  <span className="mobileRunMetaStack">
                    <span className="mobileListItemMeta">{thread.projectId || t("queue.threads.localWorkspace")}</span>
                    <span className="mobileListItemMeta">
                      <Clock3 size={12} />
                      {formatThreadTime(thread)}
                    </span>
                  </span>
                </span>
                <StatusBadge
                  status={threadStatusToVariant(thread.status)}
                  label={t(threadStatusLabelKey(thread.status))}
                  className={`mobileQueueStatusBadge mobileQueueStatusBadge-${getStatusVariantClassName(threadStatusToVariant(thread.status))}`}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
