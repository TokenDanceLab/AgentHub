import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  GitBranch,
  LogIn,
  MessageSquareText,
  Plus,
  Route,
  ShieldCheck,
  UsersRound,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';
import type { AgentTeamOverview } from '@/api/agentTeamQueries';
import { useRuns } from '@/api/runQueries';
import { useThreads } from '@/api/threadQueries';
import { useHealth } from '@/hooks/useHealth';
import { useHubStore } from '@/stores/hubStore';
import { useTaskBridgeStore } from '@/stores/taskBridgeStore';
import type { ThreadInfo } from '@shared/types';
import styles from './HomeDashboard.module.css';

interface Props {
  onNewThread: () => void;
  onSelectThread: (threadId: string) => void;
  onQuickStart: (prompt: string) => void;
  onOpenTeamRuns?: () => void;
  onOpenRuns?: () => void;
  onOpenApprovals?: () => void;
  onOpenAuth?: () => void;
  permissionCount?: number;
  agentTeamOverview?: AgentTeamOverview;
  agentTeamsLoading?: boolean;
  agentTeamsSignedIn?: boolean;
  agents?: AgentInfo[];
  selectedAgentId?: string;
  onSelectAgent?: (agentId: string) => void;
  onStartLocalOrchestration?: (agentId: string, draft: string) => void;
  workspaces?: WorkspaceEntry[];
  selectedWorkspacePath?: string;
  onSelectWorkspace?: (workspace: WorkspaceEntry) => void;
  onBrowseWorkspace?: () => void;
  onRemoveWorkspace?: (path: string) => void;
  onClearWorkspaces?: () => void;
  desktopAvailable?: boolean;
}

const QUICK_START_KEYS = [
  'home.quickStart1',
  'home.quickStart2',
  'home.quickStart3',
] as const;

function isRunActive(status: string): boolean {
  return ['queued', 'running', 'streaming', 'waiting_for_input', 'waiting_approval'].includes(status);
}

function isTeamRunActive(status?: string): boolean {
  if (!status) return false;
  return [
    'queued',
    'planning',
    'dispatching',
    'running',
    'waiting_for_approval',
    'merging',
  ].includes(status);
}

function isPendingTeamApproval(status?: string): boolean {
  if (!status) return false;
  return ['pending', 'requested', 'waiting', 'waiting_for_approval'].includes(status);
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getRecentThreads(threads: ThreadInfo[], limit: number): ThreadInfo[] {
  return [...threads]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, limit);
}

export default function HomeDashboard({
  onNewThread,
  onSelectThread,
  onQuickStart,
  onOpenTeamRuns,
  onOpenRuns,
  onOpenApprovals,
  onOpenAuth,
  permissionCount = 0,
  agentTeamOverview,
  agentTeamsLoading = false,
  agentTeamsSignedIn = false,
  agents = [],
  selectedAgentId,
  onSelectAgent,
  onStartLocalOrchestration,
  workspaces = [],
  selectedWorkspacePath,
  onSelectWorkspace,
  onBrowseWorkspace,
  onRemoveWorkspace,
  onClearWorkspaces,
  desktopAvailable = false,
}: Props) {
  const { t } = useTranslation();
  const { online, health } = useHealth();
  const { data: runData } = useRuns();
  const { data: threadData } = useThreads();
  const hubAuthenticated = useHubStore((s) => s.authenticated);
  const hubUsername = useHubStore((s) => s.username);
  const bridgedTasks = useTaskBridgeStore((s) => s.tasks);

  const runs = useMemo(() => runData?.items ?? [], [runData?.items]);
  const threads = useMemo(() => threadData?.items ?? [], [threadData?.items]);

  const activeRunCount = useMemo(() => runs.filter((r) => isRunActive(r.status)).length, [runs]);
  const activeBridgeCount = useMemo(
    () => bridgedTasks.filter((task) => task.status === 'queued' || task.status === 'running').length,
    [bridgedTasks],
  );
  const recentThreads = useMemo(() => getRecentThreads(threads, 5), [threads]);
  const teamRuns = useMemo(
    () => agentTeamOverview?.bundles.flatMap((bundle) => bundle.runs.map((run) => ({ run, team: bundle.team }))) ?? [],
    [agentTeamOverview?.bundles],
  );
  const activeTeamRunCount = useMemo(
    () => teamRuns.filter(({ run }) => isTeamRunActive(run.status)).length,
    [teamRuns],
  );
  const selectedTeam = agentTeamOverview?.selectedTeam ?? teamRuns[0]?.team;
  const selectedRun = agentTeamOverview?.selectedRun ?? teamRuns[0]?.run;
  const teamState = agentTeamOverview?.state;
  const teamTaskCount = teamState?.tasks?.length ?? agentTeamOverview?.tasks.length ?? 0;
  const teamMemberCount = teamState?.members?.length ?? selectedTeam?.members?.length ?? 0;
  const teamRouteCount = teamState?.route_log?.length ?? 0;
  const pendingTeamApprovals = (teamState?.approvals ?? []).filter((approval) => isPendingTeamApproval(approval.status)).length;
  const pendingTeamConflicts = (teamState?.conflicts ?? []).filter((conflict) => conflict.status !== 'resolved').length;
  const latestRoute = teamState?.route_log?.[teamState.route_log.length - 1];
  const selectedRunStatus = selectedRun?.status ?? teamState?.status;
  const selectedRunStatusLabel = selectedRunStatus
    ? t(`settings.teamRunStatus.${selectedRunStatus}`, { defaultValue: selectedRunStatus })
    : t('home.teamRunNoRun');
  const localOrchestration = useMemo(
    () => resolveLocalOrchestration(agents, selectedAgentId),
    [agents, selectedAgentId],
  );
  const localReady = localOrchestration.available;
  const localName = localOrchestration.orchestratorName ?? 'Orchestrator';
  const showLocalOnlyPanel = localReady && !selectedTeam && !agentTeamsLoading;
  const localStatusLabel = localReady
    ? t('home.localOrchestrationStatus', { count: localOrchestration.availableSubAgents })
    : selectedRunStatusLabel;

  const handleSelectLocalOrchestrator = () => {
    if (!localOrchestration.orchestratorId) return;
    const draft = t('home.localOrchestrationDraft', {
      runtime: localName,
      count: localOrchestration.availableSubAgents,
    });
    if (onStartLocalOrchestration) {
      onStartLocalOrchestration(localOrchestration.orchestratorId, draft);
      return;
    }
    onSelectAgent?.(localOrchestration.orchestratorId);
  };

  const edgeVersion = health?.version;
  const hubConnected = health?.checks?.hub?.status === 'ok';
  const hasIssues = !online || (edgeVersion && !hubConnected);

  let healthStatus: 'green' | 'yellow' | 'red' = 'green';
  if (!online) {
    healthStatus = 'red';
  } else if (hasIssues) {
    healthStatus = 'yellow';
  }

  return (
    <div className={styles.root}>
      {/* Top stats row */}
      <div className={styles.statsGrid}>
        {/* Active Runs */}
        <div className={styles.statCard}>
          <div className={styles.statLabel}>
            <Activity size={14} />
            {t('home.activeRuns')}
          </div>
          <div className={styles.statValue}>{activeRunCount}</div>
          <button
            type="button"
            className={styles.statFooter}
            onClick={onOpenRuns}
            title={t('home.viewAllRuns')}
            disabled={!onOpenRuns}
          >
            {t('home.viewAllRuns')}
          </button>
        </div>

        {/* Pending Approvals */}
        <div className={styles.statCard}>
          <div className={styles.statLabel}>
            <ShieldCheck size={14} />
            {t('home.pendingApprovals')}
          </div>
          <div className={styles.statValue}>{permissionCount}</div>
          <button
            type="button"
            className={styles.statFooter}
            onClick={onOpenApprovals}
            disabled={!onOpenApprovals || permissionCount === 0}
          >
            {t('home.reviewApprovals')}
          </button>
        </div>

        {/* Hub session / bridge */}
        <div className={styles.statCard}>
          <div className={styles.statLabel}>
            <LogIn size={14} />
            {t('home.hubSession')}
          </div>
          <div className={styles.statValue}>
            {hubAuthenticated ? t('home.hubConnected') : t('home.localOnly')}
          </div>
          <span className={styles.statLabel}>
            {hubAuthenticated
              ? t('home.hubBridgeSummary', { count: activeBridgeCount, user: hubUsername ?? t('home.hubUserFallback') })
              : t('home.hubSignedOut')}
          </span>
          {!hubAuthenticated ? (
            <button
              type="button"
              className={styles.statFooter}
              onClick={onOpenAuth}
              disabled={!onOpenAuth}
            >
              {t('home.signInHub')}
            </button>
          ) : null}
        </div>

        {/* TeamRuns */}
        <div className={styles.statCard}>
          <div className={styles.statLabel}>
            <GitBranch size={14} />
            {t('home.activeTeamRuns')}
          </div>
          <div className={styles.statValue}>{t('home.teamRunConsole')}</div>
          <button
            type="button"
            className={styles.statFooter}
            onClick={onOpenTeamRuns}
            disabled={!onOpenTeamRuns}
          >
            {t('home.openTeamRuns')}
          </button>
        </div>

        {/* Target Health */}
        <div className={styles.statCard}>
          <div className={styles.statLabel}>
            {online ? <Wifi size={14} /> : <WifiOff size={14} />}
            {t('home.targetHealth')}
          </div>
          <div className={styles.healthStatus}>
            <span
              className={`${styles.healthDot} ${
                healthStatus === 'green'
                  ? styles.healthDotGreen
                  : healthStatus === 'yellow'
                    ? styles.healthDotYellow
                    : styles.healthDotRed
              }`}
            />
            <span className={styles.statValue}>
              {online ? edgeVersion ?? t('home.online') : t('home.offline')}
            </span>
          </div>
          <span className={styles.statLabel}>
            {online ? t('home.edgeConnected') : t('home.edgeDisconnected')}
          </span>
        </div>
      </div>

      {/* Recent Workspaces */}
      <section className={styles.section} aria-label={t('workspace.recent')}>
        <WorkspacePicker
          workspaces={workspaces}
          selectedPath={selectedWorkspacePath}
          onSelect={(ws) => onSelectWorkspace?.(ws)}
          onBrowse={() => onBrowseWorkspace?.() ?? Promise.resolve()}
          onRemove={(path) => onRemoveWorkspace?.(path)}
          onClearAll={() => onClearWorkspaces?.()}
          disabled={!desktopAvailable}
        />
      </section>

      {/* AgentTeam / TeamRun command surface */}
      <section className={styles.section} aria-label={t('home.teamRunTitle')}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>{t('home.teamRunTitle')}</h2>
          <button type="button" className={styles.sectionLink} onClick={onOpenTeamRuns}>
            {t('home.teamRunOpenConsole')}
          </button>
        </div>

        <div className={styles.teamPanel} data-testid="home-teamrun-panel">
          <div className={styles.teamPanelHeader}>
            <span className={`${styles.teamPulse} ${activeTeamRunCount > 0 || localReady ? styles.teamPulseActive : ''}`} aria-hidden="true">
              <Route size={16} />
            </span>
            <span className={styles.teamPanelTitle}>
              {selectedTeam?.name ?? (localReady ? t('home.localOrchestrationReady') : t('home.teamRunNoTeam'))}
            </span>
            <span className={`${styles.teamStatus} ${activeTeamRunCount > 0 || localReady ? styles.teamStatusActive : ''}`}>
              {agentTeamsLoading ? t('home.teamRunLoading') : localStatusLabel}
            </span>
          </div>

          {showLocalOnlyPanel ? (
            <>
              <div className={styles.teamEmptyRow}>
                <span>{t('home.localOrchestrationDesc', { runtime: localName, count: localOrchestration.availableSubAgents })}</span>
                <div className={styles.inlineActions}>
                  {!agentTeamsSignedIn ? (
                    <button type="button" className={styles.inlineAction} onClick={onOpenHubAccount}>
                      {t('home.teamRunSignIn')}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={styles.inlineAction}
                    data-testid="home-local-orchestration-action"
                    onClick={handleSelectLocalOrchestrator}
                    disabled={localOrchestration.selected && !onStartLocalOrchestration}
                  >
                    {localOrchestration.selected && !onStartLocalOrchestration
                      ? t('home.localOrchestrationCurrent')
                      : t('home.localOrchestrationAction')}
                  </button>
                </div>
              </div>
              <div className={styles.teamMetricRow}>
                <span><Bot size={13} />{localName}</span>
                <span><UsersRound size={13} />{t('home.localOrchestrationSubAgents')}: {localOrchestration.availableSubAgents}</span>
                <span><Route size={13} />{agentTeamsSignedIn ? t('home.teamRunHubSyncEmpty') : t('home.teamRunHubSyncSignedOut')}</span>
              </div>
            </>
          ) : !agentTeamsSignedIn ? (
            <div className={styles.teamEmptyRow}>
              <span>{t('home.teamRunSignedOut')}</span>
              <button type="button" className={styles.inlineAction} onClick={onOpenHubAccount}>
                {t('home.teamRunSignIn')}
              </button>
            </div>
          ) : agentTeamsLoading && !agentTeamOverview ? (
            <div className={styles.teamEmptyRow}>{t('home.teamRunLoadingDesc')}</div>
          ) : !selectedTeam ? (
            <div className={styles.teamEmptyRow}>
              <span>{t('home.teamRunEmpty')}</span>
              <button type="button" className={styles.inlineAction} onClick={onOpenTeamRuns}>
                {t('home.teamRunCreateTeam')}
              </button>
            </div>
          ) : (
            <>
              <div className={styles.teamMetricRow}>
                <span><UsersRound size={13} />{t('home.teamRunTeams')}: {agentTeamOverview?.teams.length ?? 0}</span>
                <span><Activity size={13} />{t('home.teamRunActive')}: {activeTeamRunCount}/{teamRuns.length}</span>
                <span><Bot size={13} />{t('home.teamRunMembers')}: {teamMemberCount}</span>
                <span><Route size={13} />{t('home.teamRunTasks')}: {teamTaskCount}</span>
                {(pendingTeamApprovals > 0 || pendingTeamConflicts > 0) && (
                  <span className={styles.teamRiskMetric}>
                    <AlertTriangle size={13} />
                    {t('home.teamRunBlocks')}: {pendingTeamApprovals + pendingTeamConflicts}
                  </span>
                )}
              </div>

              <div className={styles.teamProgressGrid}>
                <span>
                  <small>{t('home.teamRunRouteDecisions')}</small>
                  <strong>{teamRouteCount}</strong>
                </span>
                <span>
                  <small>{t('home.teamRunApprovals')}</small>
                  <strong>{pendingTeamApprovals}</strong>
                </span>
                <span>
                  <small>{t('home.teamRunConflicts')}</small>
                  <strong>{pendingTeamConflicts}</strong>
                </span>
              </div>

              <div className={styles.teamRoutePreview}>
                <small>{t('home.teamRunLatestRoute')}</small>
                <span>{latestRoute?.instructions ?? selectedRun?.trigger_message ?? t('home.teamRunNoRoute')}</span>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Recent Threads */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>{t('home.recentThreads')}</h2>
          {threads.length > 5 && (
            <button type="button" className={styles.sectionLink} onClick={onViewAllThreads}>
              {t('home.viewAll')}
            </button>
          )}
        </div>

        {recentThreads.length > 0 ? (
          <div className={styles.threadList}>
            {recentThreads.map((thread) => (
              <button
                key={thread.threadId}
                type="button"
                className={styles.threadItem}
                onClick={() => onSelectThread(thread.threadId)}
              >
                <span className={styles.threadItemIcon}>
                  <MessageSquareText size={16} />
                </span>
                <span className={styles.threadItemBody}>
                  <span className={styles.threadItemTitle}>
                    {thread.title || t('thread.untitled')}
                  </span>
                  <span className={styles.threadItemMeta}>
                    {thread.projectId && `${thread.projectId} `}
                    {thread.status}
                  </span>
                </span>
                <span className={styles.threadItemTime}>
                  {formatTimestamp(thread.updatedAt)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>{t('home.noRecentThreads')}</div>
        )}
      </div>

      {/* Bottom CTA */}
      <div className={styles.ctaSection}>
        <button
          type="button"
          className={styles.ctaButton}
          onClick={onNewThread}
        >
          <Plus size={16} />
          {t('home.newThread')}
        </button>

        <div className={styles.quickStart}>
          <span className={styles.quickStartLabel}>
            <Zap size={12} />
            {' '}{t('home.quickStartLabel')}
          </span>
          <div className={styles.quickStartChips}>
            {QUICK_START_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className={styles.chip}
                onClick={() => onQuickStart(t(key))}
              >
                {t(key)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
