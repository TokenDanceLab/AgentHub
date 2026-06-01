import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  CircleDashed,
  Database,
  FileWarning,
  GitBranch,
  KeyRound,
  Network,
  Route,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useAgentTeams, useTeamEvents, useTeamRuns, useTeamRunsForTeams, useTeamRunState } from '@/api/teamRunQueries';
import type {
  AgentTeam,
  AgentTeamEvent,
  AgentTeamRun,
  CoordinatorRouteDecision,
  TeamApprovalState,
  TeamArtifactState,
  TeamConflictState,
  TeamRunEventState,
  TeamRunState,
  TeamTaskState,
} from '@/api/hubClient';
import styles from './TeamRunConsole.module.css';

const ACTIVE_STATUSES = new Set(['queued', 'running', 'dispatching', 'started', 'waiting_approval']);
const DONE_STATUSES = new Set(['done', 'completed', 'finished', 'approved']);
const FAILED_STATUSES = new Set(['failed', 'cancelled', 'rejected', 'blocked']);

const DEMO_TEAM: AgentTeam = {
  id: 'fixture-teamrun-team',
  name: 'Frontend Console Demo',
  description: 'Fixture AgentTeam for read-only TeamRun review',
  created_at: '2026-05-30T09:00:00Z',
  updated_at: '2026-05-30T09:15:00Z',
};

const DEMO_RUN: AgentTeamRun = {
  id: 'fixture-teamrun-run',
  team_id: DEMO_TEAM.id,
  trigger_message: 'Prepare TeamRun Console demo evidence',
  status: 'running',
  created_at: '2026-05-30T09:00:00Z',
  updated_at: '2026-05-30T09:18:00Z',
};

const DEMO_STATE: TeamRunState = {
  run_id: DEMO_RUN.id,
  team_id: DEMO_TEAM.id,
  status: 'running',
  members: [
    { member_id: 'fixture-supervisor', agent_profile_id: 'profile-supervisor', role: 'supervisor', active_tasks: 1, completed_tasks: 1 },
    { member_id: 'fixture-ui-builder', agent_profile_id: 'profile-ui-builder', role: 'frontend', active_tasks: 1, completed_tasks: 0 },
    { member_id: 'fixture-reviewer', agent_profile_id: 'profile-reviewer', role: 'reviewer', active_tasks: 0, completed_tasks: 1 },
  ],
  tasks: [
    {
      task_id: 'fixture-task-plan',
      assignee_member_id: 'fixture-supervisor',
      status: 'done',
      objective: 'Lock read-only TeamRun Console scope',
      run_id: 'fixture-agent-task-plan',
      agent_task_id: 'fixture-agent-task-plan',
      edge_run_id: 'fixture-edge-plan',
      attempt: 1,
      risk_level: 'low',
    },
    {
      task_id: 'fixture-task-console',
      assignee_member_id: 'fixture-ui-builder',
      parent_task_id: 'fixture-task-plan',
      status: 'running',
      objective: 'Add fixture/live data-source markers and demo-safe summaries',
      run_id: 'fixture-agent-task-console',
      agent_task_id: 'fixture-agent-task-console',
      edge_run_id: 'fixture-edge-console',
      attempt: 2,
      risk_level: 'medium',
    },
    {
      task_id: 'fixture-task-visual',
      assignee_member_id: 'fixture-reviewer',
      parent_task_id: 'fixture-task-console',
      status: 'waiting_approval',
      objective: 'Capture Desktop visual evidence without horizontal overflow',
      run_id: 'fixture-agent-task-visual',
      agent_task_id: 'fixture-agent-task-visual',
      edge_run_id: 'fixture-edge-visual',
      attempt: 1,
      risk_level: 'medium',
    },
  ],
  dependencies: [
    { task_id: 'fixture-task-console', depends_on_task_id: 'fixture-task-plan', kind: 'parent_task' },
    { task_id: 'fixture-task-visual', depends_on_task_id: 'fixture-task-console', kind: 'parent_task' },
  ],
  assignments: [],
  approvals: [
    {
      approval_id: 'fixture-approval-visual',
      agent_task_id: 'fixture-agent-task-visual',
      team_task_id: 'fixture-task-visual',
      request_id: 'fixture-request-visual',
      tool_name: 'visual-evidence',
      status: 'pending',
      created_at: '2026-05-30T09:16:00Z',
    },
  ],
  artifacts: [
    {
      agent_task_id: 'fixture-agent-task-console',
      team_task_id: 'fixture-task-console',
      path: 'app/desktop/src/components/TeamRunConsole.tsx',
      action: 'modify',
      status: 'created',
      created_at: '2026-05-30T09:12:00Z',
    },
    {
      agent_task_id: 'fixture-agent-task-visual',
      team_task_id: 'fixture-task-visual',
      path: 'app/desktop/screenshots/teamrun-console-demo.png',
      action: 'create',
      status: 'pending',
      conflict_id: 'fixture-conflict-css',
      created_at: '2026-05-30T09:17:00Z',
    },
  ],
  conflicts: [
    {
      conflict_id: 'fixture-conflict-css',
      path: 'app/desktop/src/components/TeamRunConsole.module.css',
      status: 'open',
      agent_task_ids: ['fixture-agent-task-visual'],
      team_task_ids: ['fixture-task-visual'],
    },
  ],
  run_events: [
    {
      agent_task_id: 'fixture-agent-task-console',
      edge_run_id: 'fixture-edge-console',
      event_seq: 14,
      event_type: 'run.agent.delta',
      payload: JSON.stringify({ summary: 'Console demo state prepared with fixture source labeling.' }),
      created_at: '2026-05-30T09:13:00Z',
    },
    {
      agent_task_id: 'fixture-agent-task-visual',
      edge_run_id: 'fixture-edge-visual',
      event_seq: 17,
      event_type: 'run.approval.requested',
      payload: JSON.stringify({ summary: 'Visual acceptance screenshot is waiting for review.' }),
      created_at: '2026-05-30T09:17:00Z',
    },
  ],
  route_log: [
    {
      action: 'delegate',
      next_worker: 'frontend',
      instructions: 'Keep the console read-only and mark fixture data clearly.',
      reasoning: 'Desktop owns the demonstrable collaboration surface.',
    },
    {
      action: 'review',
      next_worker: 'reviewer',
      instructions: 'Confirm no overlap between task board and summary rail.',
      reasoning: 'Demo evidence must be visually inspectable.',
    },
  ],
  budget: {
    total_tokens_used: 18400,
    token_limit: 50000,
    remaining_tokens: 31600,
    usage_percent: 37,
    run_count: 3,
    context_warnings: 0,
    compactions: 1,
  },
  terminal_reason: 'Fixture demo: live Hub TeamRun data was not available in this session.',
};

const DEMO_EVENTS: AgentTeamEvent[] = [
  {
    id: 'fixture-event-1',
    team_run_id: DEMO_RUN.id,
    seq: 1,
    type: 'team.run.started',
    payload: '{}',
    created_at: '2026-05-30T09:00:00Z',
  },
  {
    id: 'fixture-event-2',
    team_run_id: DEMO_RUN.id,
    seq: 2,
    type: 'team.task.assigned',
    payload: '{}',
    created_at: '2026-05-30T09:08:00Z',
  },
];

function isActiveStatus(status: string | undefined): boolean {
  return Boolean(status && ACTIVE_STATUSES.has(status.toLowerCase()));
}

function formatDate(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function latestRunFirst(a: AgentTeamRun, b: AgentTeamRun): number {
  const left = new Date(a.updated_at ?? a.created_at ?? '').getTime();
  const right = new Date(b.updated_at ?? b.created_at ?? '').getTime();
  return (Number.isNaN(right) ? 0 : right) - (Number.isNaN(left) ? 0 : left);
}

function taskBucket(task: TeamTaskState): 'pending' | 'running' | 'done' | 'blocked' {
  const status = task.status.toLowerCase();
  if (DONE_STATUSES.has(status)) return 'done';
  if (FAILED_STATUSES.has(status)) return 'blocked';
  if (ACTIVE_STATUSES.has(status)) return 'running';
  return 'pending';
}

function shortId(value?: string): string {
  if (!value) return '';
  return value.length > 8 ? value.slice(0, 8) : value;
}

function parsePayloadSummary(payload: string): string {
  if (!payload) return '';
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    for (const key of ['summary', 'content', 'text', 'reason', 'blocked_reason', 'error']) {
      const value = parsed[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  } catch {
    return payload.slice(0, 120);
  }
  return payload.slice(0, 120);
}

function statusClass(status: string | undefined): string {
  const normalized = status?.toLowerCase() ?? '';
  if (DONE_STATUSES.has(normalized)) return styles.statusDone!;
  if (FAILED_STATUSES.has(normalized)) return styles.statusBlocked!;
  if (ACTIVE_STATUSES.has(normalized)) return styles.statusRunning!;
  return styles.statusNeutral!;
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className={styles.emptyPanel}>
      <CircleDashed size={18} />
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  );
}

function MetricCard({ label, value, icon }: { label: string; value: string | number; icon: ReactNode }) {
  return (
    <div className={styles.metricCard}>
      <span className={styles.metricLabel}>{icon}{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TeamRunTaskCard({
  task,
  dependencyCount,
  memberLabel,
}: {
  task: TeamTaskState;
  dependencyCount: number;
  memberLabel: string;
}) {
  return (
    <article className={styles.taskCard}>
      <div className={styles.taskHeader}>
        <span className={`${styles.statusPill} ${statusClass(task.status)}`}>{task.status}</span>
        {task.risk_level && <span className={styles.mutedPill}>{task.risk_level}</span>}
      </div>
      <h4>{task.objective || shortId(task.task_id)}</h4>
      <div className={styles.taskMeta}>
        <span>{memberLabel}</span>
        {dependencyCount > 0 && <span>{dependencyCount} dep</span>}
        {(task.attempt ?? 0) > 0 && <span>try {task.attempt}</span>}
      </div>
      {(task.agent_task_id || task.edge_run_id) && (
        <div className={styles.idRow}>
          {task.agent_task_id && <code>task {shortId(task.agent_task_id)}</code>}
          {task.edge_run_id && <code>edge {shortId(task.edge_run_id)}</code>}
        </div>
      )}
    </article>
  );
}

function RouteLogItem({ route, index }: { route: CoordinatorRouteDecision; index: number }) {
  return (
    <div className={styles.activityItem}>
      <span className={styles.activityIcon}><Route size={14} /></span>
      <span className={styles.activityBody}>
        <strong>{route.action || `route ${index + 1}`}</strong>
        <span>{route.reasoning || route.instructions || route.summary || route.blocked_reason || route.feedback || route.next_worker || 'typed supervisor route'}</span>
      </span>
    </div>
  );
}

function RuntimeEventItem({ event }: { event: TeamRunEventState }) {
  return (
    <div className={styles.activityItem}>
      <span className={styles.activityIcon}><Network size={14} /></span>
      <span className={styles.activityBody}>
        <strong>{event.event_type}</strong>
        <span>{parsePayloadSummary(event.payload ?? '') || `seq ${event.event_seq}`}</span>
      </span>
    </div>
  );
}

function ApprovalItem({ approval }: { approval: TeamApprovalState }) {
  return (
    <div className={styles.summaryItem}>
      <span className={`${styles.statusPill} ${statusClass(approval.status)}`}>{approval.status}</span>
      <span>{approval.tool_name || approval.request_id || approval.approval_id}</span>
    </div>
  );
}

function ArtifactItem({ artifact }: { artifact: TeamArtifactState }) {
  return (
    <div className={styles.summaryItem}>
      <span className={styles.fileIcon}><Boxes size={13} /></span>
      <span>{artifact.path}</span>
      {artifact.conflict_id && <span className={styles.conflictTag}>conflict</span>}
    </div>
  );
}

function ConflictItem({ conflict }: { conflict: TeamConflictState }) {
  return (
    <div className={styles.summaryItem}>
      <span className={styles.fileIcon}><FileWarning size={13} /></span>
      <span>{conflict.path}</span>
      <span className={`${styles.statusPill} ${statusClass(conflict.status)}`}>{conflict.status}</span>
    </div>
  );
}

export default function TeamRunConsole() {
  const { t } = useTranslation();
  const auth = useAuth();
  const hubReady = auth.isAuthenticated && Boolean(auth.token);
  const [showSignedOutDemo, setShowSignedOutDemo] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const teamsQuery = useAgentTeams(hubReady);
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);
  const teamIds = useMemo(() => teams.map((team) => team.id), [teams]);
  const runPreviews = useTeamRunsForTeams(teamIds, hubReady && !selectedTeamId && teams.length > 0);
  const previewSelection = useMemo(() => {
    if (selectedTeamId || runPreviews.length !== teams.length || runPreviews.some((preview) => preview.isFetching)) {
      return null;
    }
    const candidates = runPreviews
      .flatMap((preview) => preview.runs.map((run) => ({ teamId: preview.teamId, run })))
      .sort((a, b) => latestRunFirst(a.run, b.run));
    return candidates.find((candidate) => isActiveStatus(candidate.run.status)) ?? candidates[0] ?? null;
  }, [runPreviews, selectedTeamId, teams.length]);
  const effectiveTeamId = selectedTeamId ?? previewSelection?.teamId ?? teams[0]?.id ?? null;
  const selectedTeam = teams.find((team) => team.id === effectiveTeamId) ?? teams[0];
  const runsQuery = useTeamRuns(selectedTeam?.id, hubReady);
  const runs = useMemo(() => [...(runsQuery.data ?? [])].sort(latestRunFirst), [runsQuery.data]);
  const effectiveRunId = selectedRunId && runs.some((run) => run.id === selectedRunId)
    ? selectedRunId
    : (runs.find((run) => isActiveStatus(run.status)) ?? runs[0])?.id ?? previewSelection?.run.id ?? null;
  const selectedRun = runs.find((run) => run.id === effectiveRunId) ?? runs[0];
  const stateQuery = useTeamRunState(selectedTeam?.id, selectedRun?.id, hubReady);
  const eventsQuery = useTeamEvents(selectedTeam?.id, selectedRun?.id, hubReady);
  const liveState = stateQuery.data;
  const useDemoData = showSignedOutDemo || (hubReady && !teamsQuery.isFetching && !runsQuery.isFetching && !stateQuery.isLoading && !liveState);
  const displayTeams = useDemoData ? [DEMO_TEAM] : teams;
  const displayRuns = useDemoData ? [DEMO_RUN] : runs;
  const displayTeam = useDemoData ? DEMO_TEAM : selectedTeam;
  const displayRun = useDemoData ? DEMO_RUN : selectedRun;
  const state = useDemoData ? DEMO_STATE : liveState;
  const teamEvents = useDemoData ? DEMO_EVENTS : (eventsQuery.data ?? []);
  const sourceLabel = useDemoData ? t('teamrun.sourceFixture') : t('teamrun.sourceLive');
  const sourceDescription = useDemoData ? t('teamrun.sourceFixtureDesc') : t('teamrun.sourceLiveDesc');

  const memberLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const member of state?.members ?? []) {
      labels.set(member.member_id, `${member.role} ${shortId(member.agent_profile_id || member.member_id)}`);
    }
    return labels;
  }, [state?.members]);

  const dependencyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const dep of state?.dependencies ?? []) {
      const tid = String(dep.task_id ?? '');
      counts.set(tid, (counts.get(tid) ?? 0) + 1);
    }
    return counts;
  }, [state?.dependencies]);

  const tasksByBucket = useMemo(() => {
    const buckets: Record<'pending' | 'running' | 'done' | 'blocked', TeamTaskState[]> = {
      pending: [],
      running: [],
      done: [],
      blocked: [],
    };
    for (const task of state?.tasks ?? []) {
      buckets[taskBucket(task)].push(task);
    }
    return buckets;
  }, [state?.tasks]);

  const pendingApprovals = (state?.approvals ?? []).filter((approval) => isActiveStatus(approval.status) || approval.status.toLowerCase() === 'pending');
  const latestEvents = [...(state?.run_events ?? [])].sort((a, b) => b.event_seq - a.event_seq).slice(0, 8);
  const visibleState = state;

  if (!hubReady && !showSignedOutDemo) {
    return (
      <div className={styles.root}>
        <div className={styles.lockedState}>
          <KeyRound size={22} />
          <h2>{t('teamrun.signedOutTitle')}</h2>
          <p>{t('teamrun.signedOutDesc')}</p>
          <span className={styles.lockedHint}>{t('teamrun.localEdgeHint')}</span>
          <button type="button" className={styles.primaryButton} onClick={() => { void auth.loginWithTokenDance(); }}>
            {t('settings.signIn')}
          </button>
          <button type="button" className={styles.secondaryButton} onClick={() => setShowSignedOutDemo(true)}>
            {t('teamrun.viewFixtureDemo')}
          </button>
        </div>
      </div>
    );
  }

  const error = teamsQuery.error ?? runsQuery.error ?? stateQuery.error ?? eventsQuery.error;

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}><GitBranch size={14} />{t('teamrun.eyebrow')}</span>
          <h2>{t('teamrun.title')}</h2>
          <p>{t('teamrun.subtitle')}</p>
        </div>
        <div className={styles.headerMetrics}>
          <MetricCard label={t('teamrun.members')} value={state?.members?.length ?? 0} icon={<Users size={14} />} />
          <MetricCard label={t('teamrun.tasks')} value={state?.tasks?.length ?? 0} icon={<CheckCircle2 size={14} />} />
          <MetricCard label={t('teamrun.pendingApprovals')} value={pendingApprovals.length} icon={<ShieldCheck size={14} />} />
        </div>
      </header>

      <section className={`${styles.sourceBanner} ${useDemoData ? styles.sourceBannerDemo : ''}`} aria-label={t('teamrun.source')}>
        <span className={styles.sourceIcon}><Database size={15} /></span>
        <span>
          <strong>{sourceLabel}</strong>
          <small>{sourceDescription}</small>
          <small>{t('teamrun.readOnlyDesc')}</small>
        </span>
        <span className={styles.readOnlyPill}>{t('teamrun.readOnly')}</span>
        {showSignedOutDemo && (
          <button type="button" className={styles.inlineButton} onClick={() => setShowSignedOutDemo(false)}>
            {t('teamrun.backToSignIn')}
          </button>
        )}
      </section>

      {error && (
        <div className={styles.errorBanner} role="alert">
          <AlertTriangle size={15} />
          {t('teamrun.loadError')}
        </div>
      )}

      <div className={styles.layout}>
        <aside className={styles.selectorRail}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h3>{t('teamrun.teams')}</h3>
              {teamsQuery.isFetching && <span>{t('settings.loading')}</span>}
            </div>
            {displayTeams.length === 0 ? (
              <EmptyPanel title={t('teamrun.noTeams')} body={t('teamrun.noTeamsDesc')} />
            ) : (
              <div className={styles.selectorList}>
                {displayTeams.map((team: AgentTeam) => (
                  <button
                    key={team.id}
                    type="button"
                    className={`${styles.selectorItem} ${team.id === displayTeam?.id ? styles.selectorItemActive : ''}`}
                    onClick={() => {
                      if (useDemoData) return;
                      setSelectedTeamId(team.id);
                      setSelectedRunId(null);
                    }}
                    disabled={useDemoData}
                  >
                    <strong>{team.name}</strong>
                    <span>{team.description || t('teamrun.teamDefaultDesc')}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h3>{t('teamrun.runs')}</h3>
              {runsQuery.isFetching && <span>{t('settings.loading')}</span>}
            </div>
            {displayTeam && displayRuns.length === 0 ? (
              <EmptyPanel title={t('teamrun.noRuns')} body={t('teamrun.noRunsDesc')} />
            ) : (
              <div className={styles.selectorList}>
                {displayRuns.map((run: AgentTeamRun) => (
                  <button
                    key={run.id}
                    type="button"
                    className={`${styles.selectorItem} ${run.id === displayRun?.id ? styles.selectorItemActive : ''}`}
                    onClick={() => setSelectedRunId(run.id)}
                    disabled={useDemoData}
                  >
                    <span className={`${styles.statusPill} ${statusClass(run.status)}`}>{run.status}</span>
                    <strong>{run.trigger_message || shortId(run.id)}</strong>
                    <span>{formatDate(run.updated_at ?? run.created_at)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>

        <main className={styles.board}>
          {!displayTeam || !displayRun ? (
            <EmptyPanel title={t('teamrun.emptyTitle')} body={t('teamrun.emptyDesc')} />
          ) : stateQuery.isLoading ? (
            <EmptyPanel title={t('settings.loading')} body={t('teamrun.loadingState')} />
          ) : !visibleState && !useDemoData ? (
            <EmptyPanel title={t('teamrun.noState')} body={t('teamrun.noStateDesc')} />
          ) : visibleState ? (
            <>
              <section className={styles.runSummary}>
                <div>
                  <span className={`${styles.statusPill} ${statusClass(visibleState.status)}`}>{visibleState.status}</span>
                  <h3>{displayRun.trigger_message || t('teamrun.runFallback')}</h3>
                  <p>{visibleState.terminal_reason || t('teamrun.replayDesc')}</p>
                </div>
                {visibleState.budget && (
                  <div className={styles.budgetCard}>
                    <span>{t('teamrun.budget')}</span>
                    <strong>{(visibleState.budget.total_tokens_used ?? 0).toLocaleString()}</strong>
                    <small>{visibleState.budget.run_count} runs / {Math.round(visibleState.budget.usage_percent ?? 0)}%</small>
                  </div>
                )}
              </section>

              <section className={styles.memberStrip} aria-label={t('teamrun.members')}>
                {(visibleState.members ?? []).length === 0 ? (
                  <EmptyPanel title={t('teamrun.noMembers')} body={t('teamrun.noMembersDesc')} />
                ) : (
                  (visibleState.members ?? []).map((member) => (
                    <div key={member.member_id} className={styles.memberCard}>
                      <strong>{member.role}</strong>
                      <span>{shortId(member.agent_profile_id || member.member_id)}</span>
                      <small>{member.active_tasks} active / {member.completed_tasks} done</small>
                    </div>
                  ))
                )}
              </section>

              <section className={styles.taskBoard} aria-label={t('teamrun.tasks')}>
                {(['pending', 'running', 'done', 'blocked'] as const).map((bucket) => (
                  <div key={bucket} className={styles.taskColumn}>
                    <div className={styles.columnHeader}>
                      <span>{t(`teamrun.bucket.${bucket}`)}</span>
                      <strong>{tasksByBucket[bucket].length}</strong>
                    </div>
                    {tasksByBucket[bucket].length === 0 ? (
                      <div className={styles.columnEmpty}>{t('teamrun.noTasksInBucket')}</div>
                    ) : (
                      tasksByBucket[bucket].map((task) => (
                        <TeamRunTaskCard
                          key={task.task_id}
                          task={task}
                          dependencyCount={dependencyCounts.get(task.task_id) ?? 0}
                          memberLabel={memberLabels.get(task.assignee_member_id ?? '') ?? shortId(task.assignee_member_id)}
                        />
                      ))
                    )}
                  </div>
                ))}
              </section>
            </>
          ) : (
            <EmptyPanel title={t('teamrun.noState')} body={t('teamrun.noStateDesc')} />
          )}
        </main>

        <aside className={styles.summaryRail}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h3>{t('teamrun.routeLog')}</h3>
              <span>{state?.route_log?.length ?? 0}</span>
            </div>
            {(state?.route_log ?? []).length === 0 ? (
              <div className={styles.mutedText}>{t('teamrun.noRouteLog')}</div>
            ) : (
              (state?.route_log ?? []).slice(-6).map((route, index) => (
                <RouteLogItem key={`${route.action}-${index}`} route={route} index={index} />
              ))
            )}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h3>{t('teamrun.runtimeEvents')}</h3>
              <span>{state?.run_events?.length ?? 0}</span>
            </div>
            {latestEvents.length === 0 ? (
              <div className={styles.mutedText}>{t('teamrun.noRuntimeEvents')}</div>
            ) : (
              latestEvents.map((event) => <RuntimeEventItem key={`${event.agent_task_id}-${event.event_seq}`} event={event} />)
            )}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h3>{t('teamrun.approvals')}</h3>
              <span>{state?.approvals?.length ?? 0}</span>
            </div>
            {(state?.approvals ?? []).slice(0, 5).map((approval) => (
              <ApprovalItem key={approval.approval_id || approval.request_id} approval={approval} />
            ))}
            {(state?.approvals ?? []).length === 0 && <div className={styles.mutedText}>{t('teamrun.noApprovals')}</div>}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h3>{t('teamrun.artifacts')}</h3>
              <span>{state?.artifacts?.length ?? 0}</span>
            </div>
            {(state?.artifacts ?? []).slice(0, 6).map((artifact) => (
              <ArtifactItem key={`${artifact.agent_task_id}-${artifact.path}-${artifact.event_seq}`} artifact={artifact} />
            ))}
            {(state?.artifacts ?? []).length === 0 && <div className={styles.mutedText}>{t('teamrun.noArtifacts')}</div>}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h3>{t('teamrun.conflicts')}</h3>
              <span>{state?.conflicts?.length ?? 0}</span>
            </div>
            {(state?.conflicts ?? []).slice(0, 4).map((conflict) => (
              <ConflictItem key={conflict.conflict_id} conflict={conflict} />
            ))}
            {(state?.conflicts ?? []).length === 0 && <div className={styles.mutedText}>{t('teamrun.noConflicts')}</div>}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h3>{t('teamrun.teamEvents')}</h3>
              <span>{teamEvents.length}</span>
            </div>
            {teamEvents.slice(-4).map((event) => (
              <div key={event.id} className={styles.summaryItem}>
                <span>#{event.seq}</span>
                <span>{event.type}</span>
              </div>
            ))}
            {teamEvents.length === 0 && <div className={styles.mutedText}>{t('teamrun.noTeamEvents')}</div>}
          </section>
        </aside>
      </div>
    </div>
  );
}
