import type {
  AgentTeam,
  AgentTeamEvent,
  AgentTeamMember,
  AgentTeamRun,
  CoordinatorRouteDecision,
  TeamApprovalState,
  TeamArtifactState,
  TeamConflictState,
  TeamMemberState,
  TeamRunEventState,
  TeamRunState,
  TeamTaskState,
  TeamTaskDependencyState,
  TeamBudget,
} from '@/api/hubClient';

// ── AgentTeam ─────────────────────────────────────────────────────

export function makeAgentTeam(overrides: Partial<AgentTeam> = {}): AgentTeam {
  return {
    id: 'team-1',
    name: 'Test Team',
    description: 'A test AgentTeam',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T12:00:00Z',
    members: [makeAgentTeamMember()],
    ...overrides,
  };
}

export function makeAgentTeamMember(overrides: Partial<AgentTeamMember> = {}): AgentTeamMember {
  return {
    id: 'member-1',
    team_id: 'team-1',
    agent_profile_id: 'profile-1',
    role: 'executor',
    position: 1,
    created_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

// ── AgentTeamRun ──────────────────────────────────────────────────

export function makeAgentTeamRun(overrides: Partial<AgentTeamRun> = {}): AgentTeamRun {
  return {
    id: 'run-1',
    team_id: 'team-1',
    trigger_message: 'Test trigger message',
    status: 'running',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T12:00:00Z',
    ...overrides,
  };
}

// ── TeamRunState ──────────────────────────────────────────────────

export function makeTeamMemberState(overrides: Partial<TeamMemberState> = {}): TeamMemberState {
  return {
    member_id: 'member-1',
    agent_profile_id: 'profile-1',
    role: 'executor',
    active_tasks: 1,
    completed_tasks: 0,
    ...overrides,
  };
}

export function makeTeamTask(overrides: Partial<TeamTaskState> = {}): TeamTaskState {
  return {
    task_id: 'task-1',
    assignee_member_id: 'member-1',
    status: 'running',
    objective: 'Complete the test task',
    attempt: 1,
    risk_level: 'low',
    ...overrides,
  };
}

export function makeTeamTaskDependency(overrides: Partial<TeamTaskDependencyState> = {}): TeamTaskDependencyState {
  return {
    task_id: 'task-2',
    depends_on_task_id: 'task-1',
    kind: 'parent_task',
    ...overrides,
  };
}

export function makeTeamApproval(overrides: Partial<TeamApprovalState> = {}): TeamApprovalState {
  return {
    approval_id: 'approval-1',
    agent_task_id: 'agent-task-1',
    request_id: 'request-1',
    tool_name: 'write',
    status: 'pending',
    created_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

export function makeTeamConflict(overrides: Partial<TeamConflictState> = {}): TeamConflictState {
  return {
    conflict_id: 'conflict-1',
    path: 'src/file.ts',
    status: 'open',
    agent_task_ids: ['agent-task-1'],
    ...overrides,
  };
}

export function makeTeamArtifact(overrides: Partial<TeamArtifactState> = {}): TeamArtifactState {
  return {
    agent_task_id: 'agent-task-1',
    path: 'src/output.ts',
    action: 'create',
    status: 'created',
    created_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

export function makeTeamRunEvent(overrides: Partial<TeamRunEventState> = {}): TeamRunEventState {
  return {
    agent_task_id: 'agent-task-1',
    event_seq: 1,
    event_type: 'run.started',
    payload: '{}',
    created_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

export function makeTeamBudget(overrides: Partial<TeamBudget> = {}): TeamBudget {
  return {
    total_tokens_used: 10000,
    token_limit: 50000,
    remaining_tokens: 40000,
    usage_percent: 20,
    run_count: 2,
    context_warnings: 0,
    compactions: 1,
    ...overrides,
  };
}

export function makeRouteDecision(overrides: Partial<CoordinatorRouteDecision> = {}): CoordinatorRouteDecision {
  return {
    action: 'delegate',
    next_worker: 'executor',
    reasoning: 'Route to best-fit worker',
    ...overrides,
  };
}

export function makeTeamRunState(overrides: Partial<TeamRunState> = {}): TeamRunState {
  return {
    run_id: 'run-1',
    team_id: 'team-1',
    status: 'running',
    members: [makeTeamMemberState()],
    tasks: [makeTeamTask()],
    dependencies: [makeTeamTaskDependency()],
    assignments: [],
    approvals: [makeTeamApproval()],
    artifacts: [makeTeamArtifact()],
    conflicts: [makeTeamConflict()],
    run_events: [makeTeamRunEvent()],
    route_log: [makeRouteDecision()],
    budget: makeTeamBudget(),
    ...overrides,
  };
}

// ── AgentTeamEvent ────────────────────────────────────────────────

export function makeAgentTeamEvent(overrides: Partial<AgentTeamEvent> = {}): AgentTeamEvent {
  return {
    id: 'event-1',
    team_run_id: 'run-1',
    seq: 1,
    type: 'team.run.started',
    payload: '{}',
    created_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}
