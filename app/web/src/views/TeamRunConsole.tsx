import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Users,
  Play,
  Shield,
  Clock,
  Plus,
  RefreshCw,
  ListChecks,
  Circle,
} from 'lucide-react';
import { useHubAgentTeams, useCreateAgentTeam, useStartTeamRun, useDecideTeamApproval } from '@/api/agentTeamQueries';
import { createHubClient } from '@/api/hubClient';
import type {
  AgentTeamDetail,
  AgentTeamRun,
  AgentTeamTask,
  TeamRunState,
} from '@/api/hubClient';
import { useHubStore } from '@/stores/hubStore';
import { getAccessToken } from '@/hooks/useAuth';
import { TeamMemberList } from '@/components/IM/TeamMemberList';
import type { TeamMemberDisplay } from '@/components/IM/TeamMemberList';
import { TeamTaskBoard } from '@/components/IM/TeamTaskBoard';
import type { TeamTaskDisplay } from '@/components/IM/TeamTaskBoard';
import { TeamApprovalPanel } from '@/components/IM/TeamApprovalPanel';
import { TeamEventTimeline } from '@/components/IM/TeamEventTimeline';
import type { ViewProps } from '@/viewRegistryConfig';
import styles from './TeamRunConsole.module.css';

// ── helpers ──

type TeamRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

function statusLabelKey(status: string): string {
  return `teamRun.status.${status}`;
}

function formatStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

const RUN_STATUS_DOT: Record<string, string> = {
  queued: '#9ca3af',
  running: '#f59e0b',
  completed: '#10b981',
  failed: '#ef4444',
  cancelled: '#6b7280',
};

function mapMemberDisplays(
  members: { member_id: string; agent_profile_id?: string; role: string; active_tasks?: number; completed_tasks?: number }[],
  teamDetail?: AgentTeamDetail | null,
): TeamMemberDisplay[] {
  const detailMembers = teamDetail?.members ?? [];
  return members.map((m) => {
    const detail = detailMembers.find((dm) => dm.id === m.member_id);
    return {
      memberId: m.member_id,
      agentProfileId: m.agent_profile_id,
      role: m.role,
      displayName: detail?.agent_profile_id?.slice(0, 8) ?? m.member_id.slice(0, 8),
      activeTasks: m.active_tasks ?? 0,
      completedTasks: m.completed_tasks ?? 0,
    };
  });
}

function mapTaskDisplays(
  tasks: AgentTeamTask[],
  memberNames: Record<string, string>,
): TeamTaskDisplay[] {
  return tasks.map((t) => ({
    taskId: t.id,
    objective: t.objective ?? '',
    status: t.status,
    assigneeMemberId: t.assignee_member_id,
    assigneeName: t.assignee_member_id ? memberNames[t.assignee_member_id] : undefined,
    runId: t.run_id,
    riskLevel: t.risk_level,
    attempt: t.attempt,
  }));
}

function activeTaskStatuses(): Set<string> {
  return new Set(['pending', 'dispatched', 'running']);
}

// ── Tab type ──

type ConsoleTab = 'members' | 'tasks' | 'approvals' | 'events';

// ── Component ──

export default function TeamRunConsole(_props: ViewProps) {
  const { t } = useTranslation();
  const hubAuthenticated = useHubStore((s) => s.authenticated);

  const tokenGetter = useCallback(() => getAccessToken(), []);

  // Team state
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [showStartRun, setShowStartRun] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamDesc, setNewTeamDesc] = useState('');
  const [triggerMessage, setTriggerMessage] = useState('');
  const [activeTab, setActiveTab] = useState<ConsoleTab>('members');
  const [localState, setLocalState] = useState<TeamRunState | null>(null);
  const [localTasks, setLocalTasks] = useState<AgentTeamTask[]>([]);
  const [localEvents, setLocalEvents] = useState<any[]>([]);
  const [stateLoading, setStateLoading] = useState(false);
  const [decidingIds, setDecidingIds] = useState<Set<string>>(new Set());
  const [insetTeam, setInsetTeam] = useState<AgentTeamDetail | null>(null);
  const [insetRun, setInsetRun] = useState<AgentTeamRun | null>(null);

  // Queries
  const agentTeamsQuery = useHubAgentTeams({
    enabled: hubAuthenticated,
    getToken: tokenGetter,
    selectedTeamId: selectedTeamId ?? undefined,
    selectedRunId: selectedRunId ?? undefined,
  });

  const teams = agentTeamsQuery.data?.teams ?? [];
  const bundles = agentTeamsQuery.data?.bundles ?? [];
  const selectedBundle = bundles.find((b) => b.team.id === selectedTeamId);
  const teamDetail = agentTeamsQuery.data?.selectedTeam ?? insetTeam;
  const selectedRun = insetRun ?? agentTeamsQuery.data?.selectedRun;

  const runs = selectedBundle?.runs ?? [];

  const state = localState ?? agentTeamsQuery.data?.state;
  const tasks = localTasks.length > 0 ? localTasks : (agentTeamsQuery.data?.tasks ?? []);
  const events = localEvents.length > 0 ? localEvents : (agentTeamsQuery.data?.events ?? []);

  // Mutations
  const createTeamMut = useCreateAgentTeam({ getToken: tokenGetter });
  const startRunMut = useStartTeamRun({ getToken: tokenGetter });
  const decideApprovalMut = useDecideTeamApproval({ getToken: tokenGetter });

  // Derived data
  const memberNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of state?.members ?? []) {
      map[m.member_id] = m.member_id.slice(0, 8);
    }
    return map;
  }, [state?.members]);

  const memberDisplays = useMemo(
    () => mapMemberDisplays(state?.members ?? [], teamDetail),
    [state?.members, teamDetail],
  );

  const taskDisplays = useMemo(
    () => mapTaskDisplays(tasks, memberNames),
    [tasks, memberNames],
  );

  const activeTasks = useMemo(
    () => taskDisplays.filter((t) => activeTaskStatuses().has(t.status)),
    [taskDisplays],
  );

  const completedTasks = useMemo(
    () => taskDisplays.filter((t) => !activeTaskStatuses().has(t.status)),
    [taskDisplays],
  );

  // Handlers
  const handleSelectTeam = useCallback(
    async (teamId: string) => {
      setSelectedTeamId(teamId);
      setSelectedRunId(null);
      setLocalState(null);
      setLocalTasks([]);
      setLocalEvents([]);
      setInsetTeam(null);
      setInsetRun(null);
    },
    [],
  );

  const handleSelectRun = useCallback(
    async (teamId: string, runId: string) => {
      setSelectedTeamId(teamId);
      setSelectedRunId(runId);
      setLocalState(null);
      setLocalTasks([]);
      setLocalEvents([]);
      setStateLoading(true);
      try {
        const token = tokenGetter();
        if (!token) return;
        const client = createHubClient({ getToken: () => token });
        const [runState, taskList, eventList] = await Promise.all([
          client.getTeamRunState(teamId, runId),
          client.listTeamTasks(teamId, runId),
          client.listTeamEvents(teamId, runId),
        ]);
        setLocalState(runState);
        setLocalTasks(taskList);
        setLocalEvents(eventList);
        const teamDetailData = await client.getAgentTeam(teamId);
        setInsetTeam(teamDetailData);
        const runData = await client.getTeamRun(teamId, runId);
        setInsetRun(runData);
      } catch {
        // keep stale data
      } finally {
        setStateLoading(false);
      }
    },
    [tokenGetter],
  );

  const handleCreateTeam = useCallback(async () => {
    if (!newTeamName.trim()) return;
    try {
      const desc = newTeamDesc.trim();
      await createTeamMut.mutateAsync({ name: newTeamName.trim(), ...(desc ? { description: desc } : {}) });
      setNewTeamName('');
      setNewTeamDesc('');
      setShowCreateTeam(false);
    } catch {
      // mutation handles error
    }
  }, [createTeamMut, newTeamDesc, newTeamName]);

  const handleStartRun = useCallback(async () => {
    if (!selectedTeamId || !triggerMessage.trim()) return;
    try {
      const run = await startRunMut.mutateAsync({
        teamId: selectedTeamId,
        run: { trigger_message: triggerMessage.trim() },
      });
      setTriggerMessage('');
      setShowStartRun(false);
      setTimeout(() => handleSelectRun(selectedTeamId, run.id), 1500);
    } catch {
      // mutation handles error
    }
  }, [handleSelectRun, selectedTeamId, startRunMut, triggerMessage]);

  const handleApprove = useCallback(
    async (approvalId: string) => {
      if (!selectedTeamId || !selectedRunId) return;
      setDecidingIds((prev) => new Set(prev).add(approvalId));
      try {
        await decideApprovalMut.mutateAsync({
          teamId: selectedTeamId,
          runId: selectedRunId,
          approvalId,
          decision: { decision: 'allow' },
        });
      } finally {
        setDecidingIds((prev) => {
          const next = new Set(prev);
          next.delete(approvalId);
          return next;
        });
      }
    },
    [decideApprovalMut, selectedRunId, selectedTeamId],
  );

  const handleDeny = useCallback(
    async (approvalId: string) => {
      if (!selectedTeamId || !selectedRunId) return;
      setDecidingIds((prev) => new Set(prev).add(approvalId));
      try {
        await decideApprovalMut.mutateAsync({
          teamId: selectedTeamId,
          runId: selectedRunId,
          approvalId,
          decision: { decision: 'deny' },
        });
      } finally {
        setDecidingIds((prev) => {
          const next = new Set(prev);
          next.delete(approvalId);
          return next;
        });
      }
    },
    [decideApprovalMut, selectedRunId, selectedTeamId],
  );

  const handleResolveConflict = useCallback(
    async (conflictId: string) => {
      if (!selectedTeamId || !selectedRunId) return;
      const token = tokenGetter();
      if (!token) return;
      try {
        const client = createHubClient({ getToken: () => token });
        await client.resolveTeamConflict(selectedTeamId, selectedRunId, conflictId, {
          resolution: 'accept_agent_task',
        });
        void handleSelectRun(selectedTeamId, selectedRunId);
      } catch {
        // ignore
      }
    },
    [handleSelectRun, selectedRunId, selectedTeamId, tokenGetter],
  );

  const handleRefresh = useCallback(() => {
    if (selectedTeamId && selectedRunId) {
      void handleSelectRun(selectedTeamId, selectedRunId);
    } else {
      agentTeamsQuery.refetch();
    }
  }, [agentTeamsQuery, handleSelectRun, selectedRunId, selectedTeamId]);

  // ── Not authenticated ──
  if (!hubAuthenticated) {
    return (
      <div className={styles.root}>
        <div className={styles.emptyState}>
          <Shield size={48} className={styles.emptyIcon} />
          <span className={styles.emptyTitle}>{t('teamRun.title', 'TeamRun Console')}</span>
          <span>{t('teamRun.signInRequired', 'Sign in to TokenDance ID to view and manage AgentTeams.')}</span>
        </div>
      </div>
    );
  }

  const queryLoading = agentTeamsQuery.isLoading || agentTeamsQuery.isFetching;

  return (
    <div className={styles.root}>
      {/* ── Sidebar: Team list ── */}
      <div className={styles.teamPanel}>
        <div className={styles.panelHeader}>
          <h3 className={styles.panelTitle}>{t('teamRun.teams', 'Agent Teams')}</h3>
          <div className={styles.panelActions}>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={handleRefresh}
              disabled={queryLoading}
              title={t('teamRun.refresh', 'Refresh')}
            >
              <RefreshCw size={14} className={queryLoading ? styles.spinning : ''} />
            </button>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => setShowCreateTeam((v) => !v)}
              title={t('teamRun.createTeam', 'Create team')}
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        {/* Create team form */}
        {showCreateTeam && (
          <div className={styles.createForm}>
            <input
              className={styles.input}
              placeholder={t('teamRun.teamNamePlaceholder', 'Team name...')}
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleCreateTeam()}
            />
            <input
              className={styles.input}
              placeholder={t('teamRun.teamDescPlaceholder', 'Description (optional)...')}
              value={newTeamDesc}
              onChange={(e) => setNewTeamDesc(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleCreateTeam()}
            />
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={handleCreateTeam}
              disabled={!newTeamName.trim() || createTeamMut.isPending}
            >
              {createTeamMut.isPending ? t('teamRun.creating', 'Creating...') : t('teamRun.create', 'Create')}
            </button>
          </div>
        )}

        {/* Team list */}
        {queryLoading && teams.length === 0 ? (
          <div className={styles.listHint}>{t('teamRun.loading', 'Loading teams...')}</div>
        ) : teams.length === 0 ? (
          <div className={styles.listHint}>{t('teamRun.noTeams', 'No teams yet. Create one to start.')}</div>
        ) : (
          <div className={styles.teamList}>
            {teams.map((team) => {
              const bundle = bundles.find((b) => b.team.id === team.id);
              const runCount = bundle?.runs.length ?? 0;
              const active = selectedTeamId === team.id;
              return (
                <button
                  key={team.id}
                  type="button"
                  className={`${styles.teamItem} ${active ? styles.teamItemActive : ''}`}
                  onClick={() => handleSelectTeam(team.id)}
                >
                  <div className={styles.teamItemHeader}>
                    <span className={styles.teamName}>{team.name}</span>
                    <span className={styles.teamRunCount}>{runCount}</span>
                  </div>
                  {team.description && (
                    <div className={styles.teamDesc}>{team.description}</div>
                  )}
                  {active && runs.length > 0 && (
                    <div className={styles.runList}>
                      {runs.map((run) => {
                        const isActive = selectedRunId === run.id;
                        return (
                          <button
                            key={run.id}
                            type="button"
                            className={`${styles.runItem} ${isActive ? styles.runItemActive : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectRun(team.id, run.id);
                            }}
                          >
                            <Circle
                              size={8}
                              fill={RUN_STATUS_DOT[run.status] ?? '#9ca3af'}
                              color={RUN_STATUS_DOT[run.status] ?? '#9ca3af'}
                              style={{ flexShrink: 0 }}
                            />
                            <span className={styles.runStatus}>
                              {t(statusLabelKey(run.status), formatStatus(run.status))}
                            </span>
                            <span className={styles.runDate}>
                              {run.created_at ? new Date(run.created_at).toLocaleDateString() : ''}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Main area ── */}
      <div className={styles.mainArea}>
        {!selectedTeamId ? (
          <div className={styles.emptyState}>
            <Users size={48} className={styles.emptyIcon} />
            <span className={styles.emptyTitle}>{t('teamRun.selectTeam', 'Select a Team')}</span>
            <span>{t('teamRun.selectTeamHint', 'Choose a team from the sidebar to view its details and runs.')}</span>
          </div>
        ) : (
          <>
            {/* Team header */}
            <div className={styles.detailHeader}>
              <div className={styles.detailTitleRow}>
                <h2 className={styles.detailTitle}>{teamDetail?.name ?? t('teamRun.unknownTeam', 'Unknown Team')}</h2>
                {selectedRun && (
                  <span className={styles.runBadge}>
                    <Circle
                      size={8}
                      fill={RUN_STATUS_DOT[selectedRun.status] ?? '#9ca3af'}
                      color={RUN_STATUS_DOT[selectedRun.status] ?? '#9ca3af'}
                    />
                    {t(statusLabelKey(selectedRun.status), formatStatus(selectedRun.status))}
                  </span>
                )}
              </div>
              {teamDetail?.description && (
                <p className={styles.detailDesc}>{teamDetail.description}</p>
              )}

              {/* Start run */}
              {selectedTeamId && (
                <div className={styles.runControls}>
                  {!showStartRun ? (
                    <button
                      type="button"
                      className={styles.primaryBtn}
                      onClick={() => setShowStartRun(true)}
                    >
                      <Play size={14} /> {t('teamRun.startRun', 'Start TeamRun')}
                    </button>
                  ) : (
                    <div className={styles.startRunForm}>
                      <textarea
                        className={styles.textarea}
                        placeholder={t('teamRun.triggerPlaceholder', 'What should the team do?...')}
                        value={triggerMessage}
                        onChange={(e) => setTriggerMessage(e.target.value)}
                        rows={2}
                      />
                      <div className={styles.startRunActions}>
                        <button
                          type="button"
                          className={styles.secondaryBtn}
                          onClick={() => setShowStartRun(false)}
                        >
                          {t('teamRun.cancel', 'Cancel')}
                        </button>
                        <button
                          type="button"
                          className={styles.primaryBtn}
                          onClick={handleStartRun}
                          disabled={!triggerMessage.trim() || startRunMut.isPending}
                        >
                          {startRunMut.isPending
                            ? t('teamRun.starting', 'Starting...')
                            : t('teamRun.go', 'Go')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Tabs */}
            <div className={styles.tabs}>
              {([
                ['members', Users, 'teamRun.tabMembers'] as const,
                ['tasks', ListChecks, 'teamRun.tabTasks'] as const,
                ['approvals', Shield, 'teamRun.tabApprovals'] as const,
                ['events', Clock, 'teamRun.tabEvents'] as const,
              ]).map(([tabKey, Icon, labelKey]) => (
                <button
                  key={tabKey}
                  type="button"
                  className={`${styles.tab} ${activeTab === tabKey ? styles.tabActive : ''}`}
                  onClick={() => setActiveTab(tabKey)}
                >
                  <Icon size={14} />
                  <span>{t(labelKey, tabKey)}</span>
                  {tabKey === 'approvals' &&
                    (state?.approvals ?? []).filter((a) =>
                      ['pending', 'requested', 'waiting', 'waiting_for_approval'].includes(a.status.toLowerCase()),
                    ).length > 0 && (
                      <span className={styles.badge}>
                        {(state?.approvals ?? []).filter((a) =>
                          ['pending', 'requested', 'waiting', 'waiting_for_approval'].includes(a.status.toLowerCase()),
                        ).length}
                      </span>
                    )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className={styles.tabContent}>
              {stateLoading ? (
                <div className={styles.listHint}>{t('teamRun.loading', 'Loading run state...')}</div>
              ) : !selectedRun ? (
                <div className={styles.listHint}>
                  {t('teamRun.selectRun', 'Select a run from the sidebar to view details.')}
                </div>
              ) : (
                <>
                  {activeTab === 'members' && (
                    <TeamMemberList
                      members={memberDisplays}
                      loading={queryLoading && memberDisplays.length === 0}
                      error={agentTeamsQuery.error ? String(agentTeamsQuery.error) : null}
                    />
                  )}
                  {activeTab === 'tasks' && (
                    <TeamTaskBoard
                      tasks={taskDisplays}
                      activeTasks={activeTasks}
                      completedTasks={completedTasks}
                      loading={queryLoading && tasks.length === 0}
                      error={agentTeamsQuery.error ? String(agentTeamsQuery.error) : null}
                      memberNames={memberNames}
                    />
                  )}
                  {activeTab === 'approvals' && (
                    <TeamApprovalPanel
                      approvals={state?.approvals ?? []}
                      conflicts={state?.conflicts ?? []}
                      loading={queryLoading && !state}
                      error={agentTeamsQuery.error ? String(agentTeamsQuery.error) : null}
                      onApprove={handleApprove}
                      onDeny={handleDeny}
                      onResolveConflict={handleResolveConflict}
                      decidingIds={decidingIds}
                      memberNames={memberNames}
                    />
                  )}
                  {activeTab === 'events' && (
                    <TeamEventTimeline
                      events={events}
                      loading={queryLoading && events.length === 0}
                      error={agentTeamsQuery.error ? String(agentTeamsQuery.error) : null}
                      memberNames={memberNames}
                    />
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
