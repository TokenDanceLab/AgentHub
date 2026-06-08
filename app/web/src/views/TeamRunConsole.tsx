import { useState, useMemo, useCallback, useEffect } from 'react';
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
  AgentTeamEvent,
  AgentTeamRun,
  AgentTeamTask,
  TeamRunState,
} from '@/api/hubClient';
import { useHubExecutionTargets } from '@/api/executionTargetQueries';
import { useHubStore } from '@/stores/hubStore';
import { getAccessToken } from '@/hooks/useAuth';
import { TeamMemberList } from '@/components/IM/TeamMemberList';
import type { TeamMemberDisplay } from '@/components/IM/TeamMemberList';
import { TeamTaskBoard } from '@/components/IM/TeamTaskBoard';
import type { TeamTaskDisplay } from '@/components/IM/TeamTaskBoard';
import { TeamApprovalPanel } from '@/components/IM/TeamApprovalPanel';
import { TeamEventTimeline } from '@/components/IM/TeamEventTimeline';
import styles from './TeamRunConsole.module.css';

interface TeamRunConsoleProps {
  [key: string]: unknown;
}

// ── helpers ──

function statusLabelKey(status: string): string {
  return `teamRun.status.${status}`;
}

function formatStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parsePayloadRecord(payload: unknown): Record<string, unknown> | null {
  if (isRecord(payload)) return payload;
  if (typeof payload !== 'string') return null;
  const trimmed = payload.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanField(...values: unknown[]): boolean {
  return values.some((value) => value === true);
}

function truncate(value: string, max = 140): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function summarizeRuntimePayload(eventType: string, payload: unknown): string {
  const record = parsePayloadRecord(payload);
  const rawText = typeof payload === 'string' && !record ? truncate(payload) : undefined;
  if (!record) return rawText ?? eventType;

  const toolName = firstString(record.toolName, record.tool_name, record.name);
  const callId = firstString(record.callId, record.call_id, record.toolUseId, record.tool_use_id);
  const status = firstString(record.status, record.state);
  const output = firstString(record.summary, record.output, record.content, record.text, record.result);
  const error = firstString(record.error, record.error_message, record.message);
  const action = firstString(record.action, record.decision);
  const nextWorker = firstString(record.next_worker, record.nextWorker, record.worker, record.agentId, record.agent_id);
  const instructions = firstString(record.instructions, record.summary, record.reasoning, record.reason, record.feedback);
  const taskId = firstString(record.taskId, record.task_id);
  const toolErrored = booleanField(record.isError, record.is_error);

  switch (eventType) {
    case 'run.agent.tool_call':
      return [
        `Tool ${toolName ?? 'unknown'} requested`,
        status,
        callId ? `call ${callId}` : undefined,
      ].filter(Boolean).join(' ');
    case 'run.agent.tool_result':
      return `Tool ${toolName ?? 'unknown'} result${toolErrored || error ? ` failed${error ? `: ${truncate(error)}` : output ? `: ${truncate(output)}` : ''}` : output ? `: ${truncate(output)}` : ''}`;
    case 'run.agent.route_decision':
      return [
        `Route ${action ?? 'decision'}${nextWorker ? ` -> ${nextWorker}` : ''}`,
        instructions ? truncate(instructions) : undefined,
      ].filter(Boolean).join(': ');
    case 'run.agent.permission_requested':
      return [
        `Approval requested${toolName ? ` for ${toolName}` : ''}`,
        firstString(record.reason, record.prompt, record.description),
      ].filter(Boolean).join(': ');
    case 'run.agent.task_dispatch_failed':
      return `Dispatch failed${taskId ? ` for ${taskId}` : ''}${error ? `: ${truncate(error)}` : ''}`;
    case 'run.agent.sub_agent_status':
      return [
        `Sub-agent ${nextWorker ?? 'unknown'}`,
        status,
        taskId ? `task ${taskId}` : undefined,
      ].filter(Boolean).join(' ');
    case 'run.agent.result':
      return `${record.success === false || error ? 'Result failed' : 'Result succeeded'}${error ? `: ${truncate(error)}` : output ? `: ${truncate(output)}` : ''}`;
    case 'run.agent.text_delta':
    case 'run.agent.text_block':
    case 'run.agent.message':
      return output ? truncate(output) : eventType;
    case 'artifact.created': {
      const title = firstString(record.title, record.path, record.uri, record.artifactId, record.artifact_id);
      return `Artifact created${title ? `: ${truncate(title)}` : ''}`;
    }
    case 'run.agent.file_change': {
      const path = firstString(record.path, record.file_path, record.filePath);
      const fileAction = firstString(record.kind, record.action, record.operation, record.status);
      return `File change${fileAction ? ` ${fileAction}` : ''}${path ? `: ${path}` : ''}`;
    }
    default: {
      const summary = firstString(
        record.summary,
        record.message,
        record.reason,
        record.objective,
        record.instructions,
        record.content,
        record.output,
        record.error,
      );
      return summary ? truncate(summary) : eventType;
    }
  }
}

type RuntimeEventContext = {
  taskId?: string | undefined;
  edgeRunId?: string | undefined;
  targetId?: string | undefined;
};

function runtimeContextSummary(context: RuntimeEventContext): string[] {
  return [
    context.taskId ? `Hub task ${context.taskId}` : undefined,
    context.edgeRunId ? `Edge run ${context.edgeRunId}` : undefined,
    context.targetId ? `Target ${context.targetId}` : undefined,
  ].filter((part): part is string => Boolean(part));
}

function runtimeSummaryPayload(
  eventType: string,
  payload: unknown,
  context: RuntimeEventContext,
): Record<string, unknown> {
  return {
    summary: [
      summarizeRuntimePayload(eventType, payload),
      ...runtimeContextSummary(context),
    ].join(' | '),
  };
}

function normalizeTeamRunEvent(
  event: AgentTeamEvent,
  selectedRun?: AgentTeamRun | undefined,
): AgentTeamEvent {
  const payloadRecord = parsePayloadRecord(event.payload);
  const runtimeType = firstString(payloadRecord?.event_type);
  if (event.type === 'agent.stream' || runtimeType) {
    const eventType = runtimeType ?? event.type;
    const runtimePayload = payloadRecord?.payload ?? event.payload;
    const nestedPayload = parsePayloadRecord(runtimePayload);
    const taskId = firstString(payloadRecord?.task_id, payloadRecord?.agent_task_id, nestedPayload?.task_id, nestedPayload?.taskId);
    const edgeRunId = firstString(payloadRecord?.edge_run_id, payloadRecord?.run_id, nestedPayload?.edge_run_id, nestedPayload?.runId);
    const targetId = firstString(payloadRecord?.target_id, nestedPayload?.target_id, nestedPayload?.targetId, selectedRun?.target_id);
    return {
      ...event,
      type: eventType,
      seq: numberField(payloadRecord?.event_seq) ?? event.seq,
      payload: runtimeSummaryPayload(eventType, runtimePayload, { taskId, edgeRunId, targetId }),
    };
  }

  if (event.type.startsWith('run.agent.') || event.type === 'artifact.created') {
    const targetId = firstString(payloadRecord?.target_id, payloadRecord?.targetId, selectedRun?.target_id);
    const edgeRunId = firstString(payloadRecord?.edge_run_id, payloadRecord?.runId);
    const taskId = firstString(payloadRecord?.task_id, payloadRecord?.taskId, payloadRecord?.agent_task_id);
    return {
      ...event,
      payload: runtimeSummaryPayload(event.type, event.payload, { taskId, edgeRunId, targetId }),
    };
  }

  return event;
}

function stateEventToTeamEvent(
  event: NonNullable<TeamRunState['run_events']>[number],
  selectedRun?: AgentTeamRun | undefined,
): AgentTeamEvent {
  const payloadRecord = parsePayloadRecord(event.payload);
  const taskId = firstString(event.agent_task_id, payloadRecord?.task_id, payloadRecord?.taskId);
  const edgeRunId = firstString(event.edge_run_id, payloadRecord?.edge_run_id, payloadRecord?.runId);
  const targetId = firstString(payloadRecord?.target_id, payloadRecord?.targetId, selectedRun?.target_id);
  return {
    id: `run-event-${taskId ?? 'task'}-${edgeRunId ?? 'edge'}-${event.event_seq}`,
    team_run_id: selectedRun?.id ?? '',
    seq: event.event_seq,
    type: event.event_type,
    payload: runtimeSummaryPayload(event.event_type, event.payload, { taskId, edgeRunId, targetId }),
    ...(event.created_at ? { created_at: event.created_at } : {}),
  };
}

function mergeRunEvents(
  events: AgentTeamEvent[],
  state?: TeamRunState | undefined,
  selectedRun?: AgentTeamRun | undefined,
): AgentTeamEvent[] {
  type EventCandidate = {
    event: AgentTeamEvent;
    sourceOrder: number;
    sourceSeq: number;
    inputOrder: number;
  };
  const merged: EventCandidate[] = [];
  const seen = new Set<string>();
  const add = (event: AgentTeamEvent, sourceOrder: number, inputOrder: number) => {
    const key = `${event.type}:${event.seq}:${event.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({
      event,
      sourceOrder,
      sourceSeq: event.seq,
      inputOrder,
    });
  };

  events.map((event) => normalizeTeamRunEvent(event, selectedRun)).forEach((event, index) => add(event, 0, index));
  (state?.run_events ?? [])
    .map((event) => stateEventToTeamEvent(event, selectedRun))
    .forEach((event, index) => add(event, 1, events.length + index));

  return merged
    .sort((a, b) => {
      const aTime = Date.parse(a.event.created_at ?? '');
      const bTime = Date.parse(b.event.created_at ?? '');
      const hasATime = Number.isFinite(aTime);
      const hasBTime = Number.isFinite(bTime);
      if (hasATime && hasBTime && aTime !== bTime) return aTime - bTime;
      if (hasATime !== hasBTime) return hasATime ? -1 : 1;
      if (a.sourceOrder !== b.sourceOrder) return a.sourceOrder - b.sourceOrder;
      if (a.sourceSeq !== b.sourceSeq) return a.sourceSeq - b.sourceSeq;
      return a.inputOrder - b.inputOrder;
    })
    .map(({ event }, index) => ({
      ...event,
      seq: index + 1,
    }));
}

const RUN_STATUS_DOT: Record<string, string> = {
  queued: '#9ca3af',
  running: '#f59e0b',
  completed: '#10b981',
  failed: '#ef4444',
  cancelled: '#6b7280',
};
const EMPTY_TASKS: AgentTeamTask[] = [];
const EMPTY_EVENTS: AgentTeamEvent[] = [];

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

export default function TeamRunConsole(_props: TeamRunConsoleProps = {}) {
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
  const [localEvents, setLocalEvents] = useState<AgentTeamEvent[]>([]);
  const [stateLoading, setStateLoading] = useState(false);
  const [decidingIds, setDecidingIds] = useState<Set<string>>(new Set());
  const [insetTeam, setInsetTeam] = useState<AgentTeamDetail | null>(null);
  const [insetRun, setInsetRun] = useState<AgentTeamRun | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState('');
  const [startRunError, setStartRunError] = useState('');
  const [runReplayError, setRunReplayError] = useState('');

  // Queries
  const agentTeamsQuery = useHubAgentTeams({
    enabled: hubAuthenticated,
    getToken: tokenGetter,
    selectedTeamId: selectedTeamId ?? undefined,
    selectedRunId: selectedRunId ?? undefined,
  });
  const executionTargetsQuery = useHubExecutionTargets({
    enabled: hubAuthenticated,
    getToken: tokenGetter,
  });

  const teams = agentTeamsQuery.data?.teams ?? [];
  const bundles = agentTeamsQuery.data?.bundles ?? [];
  const selectedBundle = bundles.find((b) => b.team.id === selectedTeamId);
  const teamDetail = agentTeamsQuery.data?.selectedTeam ?? insetTeam;
  const selectedRun = insetRun ?? agentTeamsQuery.data?.selectedRun;

  const runs = selectedBundle?.runs ?? [];

  const state = localState ?? agentTeamsQuery.data?.state;
  const tasks = localTasks.length > 0 ? localTasks : (agentTeamsQuery.data?.tasks ?? EMPTY_TASKS);
  const events = useMemo(
    () => mergeRunEvents(
      localEvents.length > 0 ? localEvents : (agentTeamsQuery.data?.events ?? EMPTY_EVENTS),
      state,
      selectedRun,
    ),
    [agentTeamsQuery.data?.events, localEvents, selectedRun, state],
  );
  const onlineLocalEdgeTargets = useMemo(
    () => (executionTargetsQuery.data?.items ?? []).filter((target) =>
      target.target_type === 'local_edge' &&
      target.is_online === true &&
      target.health_state !== 'offline'
    ),
    [executionTargetsQuery.data?.items],
  );
  const selectedRunTarget = onlineLocalEdgeTargets.find((target) => target.id === selectedTargetId);
  const runTargetLoading =
    executionTargetsQuery.isLoading ||
    (executionTargetsQuery.isFetching && !executionTargetsQuery.data);
  const runTargetError = executionTargetsQuery.error instanceof Error
    ? executionTargetsQuery.error.message
    : executionTargetsQuery.error
      ? String(executionTargetsQuery.error)
      : '';
  const runTargetStatus = runTargetLoading
    ? t('teamRun.targetLoading', 'Loading Hub execution targets...')
    : runTargetError
      ? t('teamRun.targetError', 'Hub execution targets unavailable: {{message}}', { message: runTargetError })
      : selectedRunTarget
        ? t('teamRun.targetSelected', 'Target: {{name}}', { name: selectedRunTarget.name || selectedRunTarget.id })
        : onlineLocalEdgeTargets.length > 0
          ? t('teamRun.targetRequired', 'Select a Desktop/Edge target before starting.')
          : t('teamRun.targetMissing', 'No online local_edge execution target is available.');

  useEffect(() => {
    if (!selectedTargetId) return;
    if (!onlineLocalEdgeTargets.some((target) => target.id === selectedTargetId)) {
      setSelectedTargetId('');
    }
  }, [onlineLocalEdgeTargets, selectedTargetId]);

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
      setRunReplayError('');
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
      setRunReplayError('');
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
      } catch (error) {
        setRunReplayError(formatErrorMessage(error));
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
    if (!selectedTeamId || !triggerMessage.trim() || !selectedRunTarget) return;
    setStartRunError('');
    try {
      const run = await startRunMut.mutateAsync({
        teamId: selectedTeamId,
        run: { trigger_message: triggerMessage.trim(), target_id: selectedRunTarget.id },
      });
      setTriggerMessage('');
      setShowStartRun(false);
      setTimeout(() => handleSelectRun(selectedTeamId, run.id), 1500);
    } catch (error) {
      setStartRunError(formatErrorMessage(error));
    }
  }, [handleSelectRun, selectedRunTarget, selectedTeamId, startRunMut, triggerMessage]);

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
                <div
                  key={team.id}
                  className={`${styles.teamItem} ${active ? styles.teamItemActive : ''}`}
                >
                  <button
                    type="button"
                    className={styles.teamSelectButton}
                    aria-label={t('teamRun.selectTeamNamed', 'Select team {{name}}', { name: team.name })}
                    onClick={() => handleSelectTeam(team.id)}
                  >
                    <span className={styles.teamItemHeader}>
                      <span className={styles.teamName}>{team.name}</span>
                      <span className={styles.teamRunCount}>{runCount}</span>
                    </span>
                  </button>
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
                </div>
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
                      <label className={styles.targetPicker}>
                        <span>{t('teamRun.targetPickerLabel', 'Desktop/Edge target')}</span>
                        <select
                          className={styles.select}
                          aria-label={t('teamRun.targetPickerLabel', 'Desktop/Edge target')}
                          value={selectedTargetId}
                          onChange={(event) => {
                            setSelectedTargetId(event.target.value);
                            setStartRunError('');
                          }}
                          disabled={runTargetLoading || Boolean(runTargetError) || onlineLocalEdgeTargets.length === 0}
                        >
                          <option value="">
                            {onlineLocalEdgeTargets.length > 0
                              ? t('teamRun.targetPickerPlaceholder', 'Select a Hub-registered Desktop/Edge target')
                              : t('teamRun.targetPickerEmpty', 'No online Desktop/Edge targets')}
                          </option>
                          {onlineLocalEdgeTargets.map((target) => (
                            <option key={target.id} value={target.id}>
                              {target.name || target.id}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className={styles.startRunActions}>
                        <span className={styles.targetHint}>{runTargetStatus}</span>
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
                          disabled={!triggerMessage.trim() || !selectedRunTarget || runTargetLoading || startRunMut.isPending}
                        >
                          {startRunMut.isPending
                            ? t('teamRun.starting', 'Starting...')
                            : t('teamRun.go', 'Go')}
                        </button>
                      </div>
                      {startRunError && (
                        <div className={styles.inlineError} role="status">
                          {t('teamRun.startRunError', 'Hub dispatch failed: {{message}}', { message: startRunError })}
                        </div>
                      )}
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
              ) : runReplayError ? (
                <div className={styles.listError} role="status">
                  {t('teamRun.runReplayError', 'Unable to load Hub run replay: {{message}}', { message: runReplayError })}
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
