import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, GitBranch, Route, TerminalSquare, UsersRound } from 'lucide-react';
import type { AgentTeamOverview } from '@/api/agentTeamQueries';
import type {
  AgentTeamRun,
  TeamConflictState,
  TeamApprovalState,
  TeamRunState,
} from '@/api/hubClient';
import type { LocalOrchestrationStatus } from '@/utils/localOrchestration';
import type { TeamLocalExecution } from '@/utils/teamLocalExecution';
import styles from './TeamRunDock.module.css';

interface Props {
  overview?: AgentTeamOverview;
  loading?: boolean;
  signedIn?: boolean;
  localExecutions?: TeamLocalExecution[];
  localOrchestration?: LocalOrchestrationStatus;
  onStartLocalOrchestration?: (agentId: string, draft: string) => void;
  onOpenConsole?: () => void;
}

function isActiveTeamRun(status?: string): boolean {
  return Boolean(status && [
    'queued',
    'planning',
    'dispatching',
    'running',
    'waiting_for_approval',
    'merging',
  ].includes(status));
}

function isPendingApproval(approval: TeamApprovalState): boolean {
  return ['pending', 'requested', 'waiting', 'waiting_for_approval'].includes(approval.status);
}

function isPendingConflict(conflict: TeamConflictState): boolean {
  return conflict.status !== 'resolved';
}

function newestRun(runs: AgentTeamRun[]): AgentTeamRun | undefined {
  return [...runs].sort((a, b) => {
    const aTime = Date.parse(a.updated_at ?? a.created_at ?? '');
    const bTime = Date.parse(b.updated_at ?? b.created_at ?? '');
    return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
  })[0];
}

function summarizeDock(overview?: AgentTeamOverview) {
  const selectedTeam = overview?.selectedTeam ?? overview?.bundles[0]?.team;
  const selectedRun = overview?.selectedRun ?? newestRun(overview?.bundles[0]?.runs ?? []);
  const state = overview?.state;
  const status = state?.status ?? selectedRun?.status;
  const members = state?.members?.length ?? selectedTeam?.members?.length ?? 0;
  const tasks = state?.tasks?.length ?? overview?.tasks.length ?? 0;
  const activeTasks = (state?.tasks ?? []).filter((task) => isActiveTeamRun(task.status)).length;
  const routes = state?.route_log?.length ?? 0;
  const artifacts = state?.artifacts?.length ?? 0;
  const approvals = (state?.approvals ?? []).filter(isPendingApproval).length;
  const conflicts = (state?.conflicts ?? []).filter(isPendingConflict).length;
  const latestRoute = state?.route_log?.[state.route_log.length - 1];
  const activeRuns = (overview?.bundles ?? []).reduce((count, bundle) => (
    count + bundle.runs.filter((run) => isActiveTeamRun(run.status)).length
  ), 0);
  return {
    selectedTeam,
    selectedRun,
    state,
    status,
    members,
    tasks,
    activeTasks,
    routes,
    artifacts,
    blocking: approvals + conflicts,
    latestRoute,
    activeRuns,
  };
}

function formatBudgetUsage(state?: TeamRunState): string | undefined {
  const usage = state?.budget?.usage_percent;
  if (typeof usage !== 'number' || !Number.isFinite(usage)) return undefined;
  return String(Math.round(usage));
}

function shortId(value?: string) {
  if (!value) return undefined;
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

export default function TeamRunDock({
  overview,
  loading = false,
  signedIn = false,
  localExecutions = [],
  localOrchestration,
  onStartLocalOrchestration,
  onOpenConsole,
}: Props) {
  const { t } = useTranslation();
  const summary = useMemo(() => summarizeDock(overview), [overview]);
  const hasTeam = Boolean(summary.selectedTeam);
  const hasRun = Boolean(summary.selectedRun || summary.state);
  const primaryExecution = localExecutions[0];
  const canStartLocalOrchestration = Boolean(
    localOrchestration?.available &&
    localOrchestration.orchestratorId &&
    onStartLocalOrchestration,
  );
  const status = summary.status ?? (loading ? 'loading' : 'idle');
  const statusLabel = status === 'loading'
    ? t('chat.teamRunLoading')
    : hasRun
      ? t(`settings.teamRunStatus.${status}`, { defaultValue: status })
      : t('chat.teamRunNoRun');
  const primaryExecutionStatus = primaryExecution
    ? t(`settings.taskStatus.${primaryExecution.status}`, { defaultValue: primaryExecution.status })
    : undefined;
  const primaryExecutionSource = primaryExecution?.source === 'desktopBridge'
    ? t('settings.agentTeamLocalSource')
    : t('settings.agentTeamHubProjectionSource');
  const budgetUsage = formatBudgetUsage(summary.state);
  const hasMetrics = summary.members > 0
    || summary.tasks > 0
    || summary.routes > 0
    || summary.artifacts > 0
    || summary.blocking > 0
    || Boolean(budgetUsage);
  const localName = localOrchestration?.orchestratorName ?? 'Orchestrator';
  const description = !signedIn
    ? canStartLocalOrchestration
      ? t('chat.teamRunHubSyncSignedOut')
      : t('chat.teamRunSignedOut')
    : !hasTeam
      ? canStartLocalOrchestration
        ? t('chat.localOrchestrationDesc', {
            runtime: localName,
            count: localOrchestration?.availableSubAgents ?? 0,
          })
        : t('chat.teamRunEmpty')
      : summary.latestRoute?.instructions ?? summary.selectedRun?.trigger_message ?? t('chat.teamRunNoRoute');
  const handleStartLocal = () => {
    if (!localOrchestration?.orchestratorId || !onStartLocalOrchestration) return;
    const draft = t('home.localOrchestrationDraft', {
      runtime: localName,
      count: localOrchestration.availableSubAgents,
    });
    onStartLocalOrchestration(localOrchestration.orchestratorId, draft);
  };

  return (
    <section
      className={styles.root}
      data-testid="teamrun-dock"
      aria-label={t('chat.teamRunDockTitle')}
    >
      <div className={styles.header}>
        <span className={`${styles.signal} ${summary.activeRuns > 0 ? styles.signalActive : ''}`} aria-hidden="true">
          <Route size={14} />
        </span>
        <div className={styles.titleBlock}>
          <strong>{summary.selectedTeam?.name ?? t('chat.teamRunDockTitle')}</strong>
          <span>{description}</span>
        </div>
        <span className={`${styles.statusPill} ${summary.blocking > 0 ? styles.statusPillBlocking : ''}`}>
          {summary.blocking > 0 ? <AlertTriangle size={12} /> : null}
          {statusLabel}
        </span>
        {canStartLocalOrchestration ? (
          <button
            type="button"
            className={styles.openButton}
            data-testid="teamrun-dock-local-orchestration"
            onClick={handleStartLocal}
          >
            {localOrchestration?.selected ? t('chat.localOrchestrationCurrent') : t('chat.localOrchestrationAction')}
          </button>
        ) : null}
        {onOpenConsole ? (
          <button
            type="button"
            className={styles.openButton}
            data-testid="teamrun-dock-open-console"
            onClick={onOpenConsole}
          >
            {t('home.teamRunOpenConsole')}
          </button>
        ) : null}
      </div>

      {hasMetrics ? (
        <div className={styles.metrics} aria-label={t('chat.teamRunDockTitle')}>
          {summary.members > 0 ? (
            <span><UsersRound size={12} />{t('chat.teamRunMembers')}: {summary.members}</span>
          ) : null}
          {summary.tasks > 0 ? (
            <span><GitBranch size={12} />{t('chat.teamRunTasks')}: {summary.activeTasks}/{summary.tasks}</span>
          ) : null}
          {summary.routes > 0 ? (
            <span><Route size={12} />{t('chat.teamRunRoutes')}: {summary.routes}</span>
          ) : null}
          {summary.artifacts > 0 ? (
            <span>{t('chat.teamRunArtifacts')}: {summary.artifacts}</span>
          ) : null}
          {summary.blocking > 0 ? (
            <span className={styles.blockingMetric}>{t('chat.teamRunBlocks')}: {summary.blocking}</span>
          ) : null}
          {budgetUsage ? (
            <span>{t('chat.teamRunBudgetUsage', { percent: budgetUsage })}</span>
          ) : null}
        </div>
      ) : null}

      {primaryExecution ? (
        <div className={styles.localExecution} data-testid="teamrun-dock-local-execution">
          <span className={styles.localExecutionIcon} aria-hidden="true">
            <TerminalSquare size={12} />
          </span>
          <strong>{primaryExecution.runtimeLabel}</strong>
          <span>{primaryExecutionSource}</span>
          <span>{primaryExecutionStatus}</span>
          {primaryExecution.agentTaskId ? (
            <span>{t('settings.agentTeamHubTask')}: {shortId(primaryExecution.agentTaskId)}</span>
          ) : null}
          {primaryExecution.edgeRunId ? (
            <span>{t('settings.agentTeamEdgeRun')}: {shortId(primaryExecution.edgeRunId)}</span>
          ) : null}
          {primaryExecution.latestEventType ? (
            <span>{primaryExecution.latestEventType}</span>
          ) : null}
          {primaryExecution.eventCount > 0 ? (
            <span>{t('settings.agentTeamLocalEvents', { count: primaryExecution.eventCount })}</span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
