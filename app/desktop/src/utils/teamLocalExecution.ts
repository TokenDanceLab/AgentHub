import type { AgentTeamTask, TeamAssignmentState, TeamRunEventState, TeamRunState, TeamTaskState } from '@/api/hubClient';
import type { AgentTask } from '@/stores/taskBridgeStore';

export type TeamLocalExecutionSource = 'desktopBridge' | 'hubProjection';

export interface TeamLocalExecution {
  id: string;
  source: TeamLocalExecutionSource;
  status: string;
  title: string;
  runtimeLabel: string;
  agentTaskId?: string;
  edgeRunId?: string;
  hubTaskId?: string;
  assignmentId?: string;
  memberId?: string;
  latestEventType?: string;
  eventCount: number;
  error?: string;
  createdAt?: string;
}

export function normalizeTeamTasks(
  state: TeamRunState | undefined,
  tasks: AgentTeamTask[],
): TeamTaskState[] {
  if (state?.tasks && state.tasks.length > 0) return state.tasks;
  return tasks.map((task) => ({
    task_id: task.id,
    assignment_id: task.assignment_id,
    assignee_member_id: task.assignee_member_id,
    parent_task_id: task.parent_task_id,
    status: task.status,
    objective: task.objective,
    run_id: task.run_id,
    attempt: task.attempt,
    risk_level: task.risk_level,
  }));
}

export function buildTeamLocalExecutions({
  selectedRunId,
  bridgeTasks,
  tasks,
  assignments,
  events,
}: {
  selectedRunId?: string;
  bridgeTasks: AgentTask[];
  tasks: TeamTaskState[];
  assignments: TeamAssignmentState[];
  events: TeamRunEventState[];
}): TeamLocalExecution[] {
  if (!selectedRunId) return [];

  const rows = new Map<string, TeamLocalExecution>();

  const matchingEvents = (agentTaskId?: string, edgeRunId?: string) =>
    events.filter((event) =>
      (agentTaskId && event.agent_task_id === agentTaskId)
      || (edgeRunId && event.edge_run_id === edgeRunId));

  const keyFor = (agentTaskId?: string, edgeRunId?: string, fallback?: string) =>
    agentTaskId ? `agent:${agentTaskId}` : edgeRunId ? `run:${edgeRunId}` : `hub:${fallback ?? rows.size}`;

  const addOrMerge = (next: TeamLocalExecution) => {
    const previousEntry = rows.get(next.id)
      ? [next.id, rows.get(next.id)] as const
      : [...rows.entries()].find(([, row]) =>
        (next.agentTaskId && row.agentTaskId === next.agentTaskId)
        || (next.edgeRunId && row.edgeRunId === next.edgeRunId));
    const previousKey = previousEntry?.[0];
    const previous = previousEntry?.[1];
    if (!previous) {
      rows.set(next.id, next);
      return;
    }
    rows.set(previousKey ?? next.id, {
      ...previous,
      source: previous.source === 'desktopBridge' ? previous.source : next.source,
      status: previous.source === 'desktopBridge' ? previous.status : next.status,
      title: previous.source === 'desktopBridge' ? previous.title : next.title,
      runtimeLabel: previous.source === 'desktopBridge' ? previous.runtimeLabel : next.runtimeLabel,
      agentTaskId: previous.agentTaskId ?? next.agentTaskId,
      edgeRunId: previous.edgeRunId ?? next.edgeRunId,
      hubTaskId: previous.hubTaskId ?? next.hubTaskId,
      assignmentId: previous.assignmentId ?? next.assignmentId,
      memberId: previous.memberId ?? next.memberId,
      latestEventType: previous.latestEventType ?? next.latestEventType,
      eventCount: Math.max(previous.eventCount, next.eventCount),
      error: previous.error ?? next.error,
      createdAt: previous.createdAt ?? next.createdAt,
    });
  };

  bridgeTasks
    .filter((task) => teamRunIdFromBridgeTask(task) === selectedRunId)
    .forEach((bridgeTask) => {
      const hubTask = findProjectedTeamTask(bridgeTask, tasks);
      const assignment = findProjectedAssignment(bridgeTask, assignments);
      const executionEvents = matchingEvents(bridgeTask.taskId, bridgeTask.runId);
      addOrMerge({
        id: keyFor(bridgeTask.taskId, bridgeTask.runId),
        source: 'desktopBridge',
        status: bridgeTask.status,
        title: hubTask?.objective || bridgeTask.prompt || bridgeTask.taskId,
        runtimeLabel: bridgeTask.agentId || 'Local Edge',
        agentTaskId: bridgeTask.taskId,
        edgeRunId: bridgeTask.runId,
        hubTaskId: hubTask?.task_id,
        assignmentId: assignment?.assignment_id ?? hubTask?.assignment_id,
        memberId: hubTask?.assignee_member_id ?? assignment?.to_member_id,
        latestEventType: executionEvents[executionEvents.length - 1]?.event_type,
        eventCount: executionEvents.length,
        error: bridgeTask.error,
        createdAt: bridgeTask.createdAt,
      });
    });

  tasks.forEach((task) => {
    const agentTaskId = task.agent_task_id;
    const edgeRunId = task.edge_run_id ?? task.run_id;
    if (!agentTaskId && !edgeRunId) return;
    const assignment = assignments.find((item) =>
      item.assignment_id === task.assignment_id
      || (agentTaskId && item.agent_task_id === agentTaskId)
      || (edgeRunId && (item.edge_run_id === edgeRunId || item.run_id === edgeRunId)));
    const executionEvents = matchingEvents(agentTaskId, edgeRunId);
    addOrMerge({
      id: keyFor(agentTaskId, edgeRunId, task.task_id),
      source: 'hubProjection',
      status: task.status,
      title: task.objective || task.task_id,
      runtimeLabel: 'Hub TeamRun',
      agentTaskId,
      edgeRunId,
      hubTaskId: task.task_id,
      assignmentId: assignment?.assignment_id ?? task.assignment_id,
      memberId: task.assignee_member_id ?? assignment?.to_member_id,
      latestEventType: executionEvents[executionEvents.length - 1]?.event_type,
      eventCount: executionEvents.length,
    });
  });

  assignments.forEach((assignment) => {
    const agentTaskId = assignment.agent_task_id;
    const edgeRunId = assignment.edge_run_id ?? assignment.run_id;
    if (!agentTaskId && !edgeRunId) return;
    const executionEvents = matchingEvents(agentTaskId, edgeRunId);
    addOrMerge({
      id: keyFor(agentTaskId, edgeRunId, assignment.assignment_id),
      source: 'hubProjection',
      status: assignment.status || 'dispatched',
      title: assignment.type || assignment.assignment_id,
      runtimeLabel: 'Hub assignment',
      agentTaskId,
      edgeRunId,
      assignmentId: assignment.assignment_id,
      memberId: assignment.to_member_id,
      latestEventType: executionEvents[executionEvents.length - 1]?.event_type,
      eventCount: executionEvents.length,
    });
  });

  events.forEach((event) => {
    if (!event.agent_task_id && !event.edge_run_id) return;
    addOrMerge({
      id: keyFor(event.agent_task_id, event.edge_run_id, `${event.event_seq}`),
      source: 'hubProjection',
      status: event.event_type,
      title: event.event_type,
      runtimeLabel: 'Hub event',
      agentTaskId: event.agent_task_id,
      edgeRunId: event.edge_run_id,
      latestEventType: event.event_type,
      eventCount: 1,
      createdAt: event.created_at,
    });
  });

  return [...rows.values()].sort((a, b) =>
    executionRank(a.status) - executionRank(b.status)
    || timestampOf(b.createdAt) - timestampOf(a.createdAt)
    || a.id.localeCompare(b.id));
}

function teamRunIdFromBridgeTask(task: AgentTask) {
  const data = task.dispatchPayload ?? {};
  const modelParams = parseRecord(data.model_params);
  const nested = parseRecord(modelParams.agenthub_team_context);
  return getFirstString(data.team_run_id, data.teamRunId, nested.team_run_id, nested.teamRunId);
}

function findProjectedTeamTask(task: AgentTask, tasks: TeamTaskState[]) {
  return tasks.find((candidate) =>
    candidate.agent_task_id === task.taskId
    || (task.runId && (candidate.edge_run_id === task.runId || candidate.run_id === task.runId)));
}

function findProjectedAssignment(task: AgentTask, assignments: TeamAssignmentState[]) {
  return assignments.find((candidate) =>
    candidate.agent_task_id === task.taskId
    || (task.runId && (candidate.edge_run_id === task.runId || candidate.run_id === task.runId)));
}

function executionRank(status: string) {
  if (status === 'running') return 0;
  if (status === 'queued' || status === 'dispatched' || status === 'pending') return 1;
  if (status === 'failed' || status === 'cancelled') return 2;
  if (status === 'done') return 3;
  return 4;
}

function timestampOf(value?: string) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function getFirstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}
