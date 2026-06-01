import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import SettingsPage, { type SectionId } from '@/components/SettingsPage';
import { useModelSettingsStore } from '@/stores/modelSettingsStore';
import type { AgentInfo, RunInfo } from '@shared/types';
import type { AgentTask } from '@/stores/taskBridgeStore';
import type {
  AgentTeamDetail,
  AgentTeamRun,
  CoordinatorRouteDecision,
  CustomAgent,
  ExecutionTarget,
  TeamApprovalState,
  TeamArtifactState,
  TeamAssignmentState,
  TeamBudget,
  TeamConflictState,
  TeamMemberState,
  TeamRunEventState,
  TeamTaskState,
} from '@/api/hubClient';

const {
  mockAgents,
  mockAgentTeamApprovals,
  mockAgentTeamArtifacts,
  mockAgentTeamAssignments,
  mockAgentTeamBudget,
  mockAgentTeamConflicts,
  mockAgentTeamEvents,
  mockAgentTeamMembers,
  mockAgentTeamRouteLog,
  mockAgentTeamRuns,
  mockAgentTeamState,
  mockAgentTeamTasks,
  mockAgentTeamTerminalReason,
  mockAgentTeams,
  mockCreateAgentTeam,
  mockCancelRun,
  mockDecideTeamApproval,
  mockAddAgentTeamMember,
  mockHubCustomAgents,
  mockHubTargets,
  mockHubTargetsState,
  mockHubSession,
  mockPingHubTarget,
  mockRefetchRuns,
  mockResolveTeamConflict,
  mockRuns,
  mockStartTeamRun,
  mockTasks,
} = vi.hoisted(() => ({
  mockAgents: [] as AgentInfo[],
  mockAgentTeamApprovals: [] as TeamApprovalState[],
  mockAgentTeamArtifacts: [] as TeamArtifactState[],
  mockAgentTeamAssignments: [] as TeamAssignmentState[],
  mockAgentTeamBudget: { value: undefined as TeamBudget | undefined },
  mockAgentTeamConflicts: [] as TeamConflictState[],
  mockAgentTeamEvents: [] as TeamRunEventState[],
  mockAgentTeamMembers: [] as TeamMemberState[],
  mockAgentTeamRouteLog: [] as CoordinatorRouteDecision[],
  mockAgentTeamRuns: [] as AgentTeamRun[],
  mockAgentTeamState: {
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null as Error | null,
  },
  mockAgentTeamTasks: [] as TeamTaskState[],
  mockAgentTeamTerminalReason: { value: undefined as string | undefined },
  mockAgentTeams: [] as AgentTeamDetail[],
  mockCreateAgentTeam: vi.fn(),
  mockAddAgentTeamMember: vi.fn(),
  mockCancelRun: vi.fn(),
  mockDecideTeamApproval: vi.fn(),
  mockHubCustomAgents: [] as CustomAgent[],
  mockHubTargets: [] as ExecutionTarget[],
  mockHubTargetsState: {
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null as Error | null,
  },
  mockHubSession: {
    hubAuthenticated: true,
    authAuthenticated: true,
    token: 'hub_access_token',
    refreshToken: 'hub_refresh_token',
    tokenSource: 'hub',
    username: 'TokenDance User',
  },
  mockPingHubTarget: vi.fn(),
  mockRefetchRuns: vi.fn(),
  mockResolveTeamConflict: vi.fn(),
  mockRuns: [] as RunInfo[],
  mockStartTeamRun: vi.fn(),
  mockTasks: [] as AgentTask[],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (vars?.defaultValue) return String(vars.defaultValue);
      if (key === 'settings.runnerSummary') return `${vars?.available}/${vars?.total} runners`;
      return key;
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({
    themeMode: 'dark',
    setThemeMode: vi.fn(),
    theme: 'dark',
    toggleTheme: vi.fn(),
  }),
}));

vi.mock('@/hooks/useHealth', () => ({
  useHealth: () => ({
    online: true,
    health: {
      status: 'ok',
      checks: {
        runners: {
          total: 1,
          available: 1,
          items: [{ id: 'codex', name: 'Codex Runner', status: 'online', capabilities: ['codex'] }],
        },
      },
    },
  }),
}));

vi.mock('@/api/agentQueries', () => ({
  useAgentList: () => ({ data: { items: mockAgents } }),
}));

vi.mock('@/api/executionTargetQueries', () => ({
  useHubExecutionTargets: () => ({
    data: { items: mockHubTargets, page: { hasMore: false, nextCursor: '' } },
    ...mockHubTargetsState,
  }),
  usePingHubExecutionTarget: () => ({
    mutate: mockPingHubTarget,
    isPending: false,
    variables: undefined,
  }),
}));

vi.mock('@/api/agentTeamQueries', () => ({
  useHubAgentTeams: (options?: { selectedTeamId?: string; selectedRunId?: string }) => {
    const selectedTeam =
      mockAgentTeams.find((team) => team.id === options?.selectedTeamId) ??
      mockAgentTeams.find((team) => mockAgentTeamRuns.some((run) => run.id === options?.selectedRunId && run.team_id === team.id)) ??
      mockAgentTeams[0];
    const selectedRun =
      mockAgentTeamRuns.find((run) => run.id === options?.selectedRunId && (!selectedTeam || run.team_id === selectedTeam.id)) ??
      mockAgentTeamRuns.find((run) => run.team_id === selectedTeam?.id) ??
      mockAgentTeamRuns[0];
    const bundles = mockAgentTeams.map((team) => {
      const runs = mockAgentTeamRuns.filter((run) => run.team_id === team.id);
      return { team, runs, latestRun: runs[0] };
    });
    return {
      data: {
        teams: mockAgentTeams,
        bundles,
        customAgents: mockHubCustomAgents,
        selectedTeam,
        selectedRun,
        state: selectedTeam && selectedRun
          ? {
              run_id: selectedRun.id,
              team_id: selectedTeam.id,
              status: selectedRun.status,
              members: mockAgentTeamMembers,
              tasks: mockAgentTeamTasks,
              assignments: mockAgentTeamAssignments,
              approvals: mockAgentTeamApprovals,
              conflicts: mockAgentTeamConflicts,
              artifacts: mockAgentTeamArtifacts,
              run_events: mockAgentTeamEvents,
              route_log: mockAgentTeamRouteLog,
              budget: mockAgentTeamBudget.value,
              terminal_reason: mockAgentTeamTerminalReason.value,
            }
          : undefined,
        tasks: [],
        events: [],
      },
      ...mockAgentTeamState,
    };
  },
  useCreateAgentTeam: () => ({
    mutateAsync: mockCreateAgentTeam,
    isPending: false,
  }),
  useAddAgentTeamMember: () => ({
    mutateAsync: mockAddAgentTeamMember,
    isPending: false,
  }),
  useStartTeamRun: () => ({
    mutateAsync: mockStartTeamRun,
    isPending: false,
  }),
  useDecideTeamApproval: () => ({
    mutateAsync: mockDecideTeamApproval,
    isPending: false,
  }),
  useResolveTeamConflict: () => ({
    mutateAsync: mockResolveTeamConflict,
    isPending: false,
  }),
}));

vi.mock('@/api/runQueries', () => ({
  useRuns: () => ({
    data: { items: mockRuns, page: { hasMore: false } },
    isError: false,
    isFetching: false,
    isLoading: false,
    refetch: mockRefetchRuns,
  }),
  useCancelRun: () => ({
    isPending: false,
    mutateAsync: mockCancelRun,
    variables: undefined,
  }),
}));

vi.mock('@/stores/taskBridgeStore', () => ({
  useTaskBridgeStore: (selector: (state: { tasks: AgentTask[] }) => unknown) => selector({ tasks: mockTasks }),
}));

vi.mock('@/stores/hubStore', () => ({
  useHubStore: (selector: (state: { authenticated: boolean; username: string; clear: () => void }) => unknown) =>
    selector({ authenticated: mockHubSession.hubAuthenticated, username: mockHubSession.username, clear: vi.fn() }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    token: mockHubSession.authAuthenticated ? mockHubSession.token : null,
    refreshToken: mockHubSession.authAuthenticated ? mockHubSession.refreshToken : null,
    user: mockHubSession.authAuthenticated ? { id: 'user_1', username: mockHubSession.username } : null,
    isAuthenticated: mockHubSession.authAuthenticated,
    tokenSource: mockHubSession.tokenSource,
    login: vi.fn(),
    loginWithTokenDance: vi.fn(),
    logout: vi.fn(),
    tryAutoLogin: vi.fn(),
  }),
}));

describe('SettingsPage tasks', () => {
  beforeEach(() => {
    mockAgents.splice(0, mockAgents.length);
    mockAgentTeamApprovals.splice(0, mockAgentTeamApprovals.length);
    mockAgentTeamArtifacts.splice(0, mockAgentTeamArtifacts.length);
    mockAgentTeamAssignments.splice(0, mockAgentTeamAssignments.length);
    mockAgentTeamBudget.value = undefined;
    mockAgentTeamConflicts.splice(0, mockAgentTeamConflicts.length);
    mockAgentTeamEvents.splice(0, mockAgentTeamEvents.length);
    mockAgentTeamMembers.splice(0, mockAgentTeamMembers.length);
    mockAgentTeamRouteLog.splice(0, mockAgentTeamRouteLog.length);
    mockAgentTeamRuns.splice(0, mockAgentTeamRuns.length);
    mockAgentTeamState.isLoading = false;
    mockAgentTeamState.isFetching = false;
    mockAgentTeamState.isError = false;
    mockAgentTeamState.error = null;
    mockAgentTeamTasks.splice(0, mockAgentTeamTasks.length);
    mockAgentTeamTerminalReason.value = undefined;
    mockAgentTeams.splice(0, mockAgentTeams.length);
    mockHubCustomAgents.splice(0, mockHubCustomAgents.length);
    mockHubTargets.splice(0, mockHubTargets.length);
    mockHubTargetsState.isLoading = false;
    mockHubTargetsState.isFetching = false;
    mockHubTargetsState.isError = false;
    mockHubTargetsState.error = null;
    mockHubSession.hubAuthenticated = true;
    mockHubSession.authAuthenticated = true;
    mockHubSession.token = 'hub_access_token';
    mockHubSession.refreshToken = 'hub_refresh_token';
    mockHubSession.tokenSource = 'hub';
    mockHubSession.username = 'TokenDance User';
    mockRuns.splice(0, mockRuns.length);
    mockTasks.splice(0, mockTasks.length);
    mockCancelRun.mockReset();
    mockCreateAgentTeam.mockReset();
    mockAddAgentTeamMember.mockReset();
    mockDecideTeamApproval.mockReset();
    mockPingHubTarget.mockReset();
    mockRefetchRuns.mockReset();
    mockResolveTeamConflict.mockReset();
    mockStartTeamRun.mockReset();
    localStorage.clear();
    sessionStorage.clear();
    useModelSettingsStore.getState().reset();
  });

  it('renders local runs and bridged Hub tasks', () => {
    mockRuns.splice(0, mockRuns.length, {
      runId: 'run_1234567890abcdef',
      projectId: 'proj_local',
      threadId: 'thread_local',
      status: 'started',
      createdAt: '2026-05-25T01:00:00Z',
      startedAt: '2026-05-25T01:01:00Z',
    });
    mockTasks.splice(0, mockTasks.length, {
      taskId: 'task_abcdef1234567890',
      agentId: 'agent-codex',
      prompt: 'Dispatch from TokenDance Hub',
      threadId: 'thread_local',
      runId: 'run_1234567890abcdef',
      status: 'running',
      dispatchPayload: {},
      createdAt: '2026-05-25T01:02:00Z',
    });

    render(<SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection="tasks" />);

    expect(screen.getByText('settings.taskLocalRuns')).toBeInTheDocument();
    expect(screen.getByText('settings.taskHubBridge')).toBeInTheDocument();
    expect(screen.getByText('proj_local / thread_local')).toBeInTheDocument();
    expect(screen.getByText('Dispatch from TokenDance Hub')).toBeInTheDocument();
    expect(screen.getByText('agent-codex')).toBeInTheDocument();
  });

  it('refreshes and cancels active local runs from the task panel', () => {
    mockRuns.splice(0, mockRuns.length, {
      runId: 'run_active_cancel_me',
      projectId: 'proj_local',
      threadId: 'thread_local',
      status: 'running',
      createdAt: '2026-05-25T01:00:00Z',
      startedAt: '2026-05-25T01:01:00Z',
    });

    render(<SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection="tasks" />);

    fireEvent.click(screen.getByRole('button', { name: 'settings.taskRefreshRuns' }));
    expect(mockRefetchRuns).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'settings.taskCancelRun' }));
    expect(mockCancelRun).toHaveBeenCalledWith('run_active_cancel_me');
  });

  it('renders scheduler readiness from runs, profiles, targets, and policy inputs', () => {
    mockAgents.splice(0, mockAgents.length, {
      id: 'codex',
      name: 'Codex',
      description: 'Local Codex runtime',
      status: 'available',
      capabilities: {
        streaming: true,
        toolCalls: true,
        fileChanges: true,
        thinkingVisible: true,
        multiTurn: true,
        mcpIntegration: false,
        permissionHooks: false,
        subAgentSpawn: false,
      },
    });
    mockRuns.splice(0, mockRuns.length, {
      runId: 'run_scheduler_local',
      projectId: 'proj_scheduler',
      threadId: 'thread_scheduler',
      status: 'started',
      createdAt: '2026-05-25T01:00:00Z',
      startedAt: '2026-05-25T01:01:00Z',
    });
    mockTasks.splice(0, mockTasks.length, {
      taskId: 'task_scheduler_hub',
      agentId: 'agent-codex',
      prompt: 'Schedule this from TokenDance Hub',
      threadId: 'thread_scheduler',
      runId: 'run_scheduler_local',
      status: 'running',
      dispatchPayload: {},
      createdAt: '2026-05-25T01:02:00Z',
    });

    render(<SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection="agentScheduling" />);

    expect(screen.getByText('settings.schedulerQueueLive')).toBeInTheDocument();
    expect(screen.getByText('settings.schedulerProfiles')).toBeInTheDocument();
    expect(screen.getAllByText('settings.schedulerTargets').length).toBeGreaterThan(0);
    expect(screen.getByText('settings.schedulerPolicyReady')).toBeInTheDocument();
    expect(screen.getByText('proj_scheduler / thread_scheduler')).toBeInTheDocument();
    expect(screen.getByText('Schedule this from TokenDance Hub')).toBeInTheDocument();
    expect(screen.getByText('settings.schedulerRouteLocal')).toBeInTheDocument();
    expect(screen.getByText('settings.schedulerPolicyModelMapping')).toBeInTheDocument();
    expect(screen.getByText('settings.schedulerGuard')).toBeInTheDocument();
  });

  it('shows local Orchestrator scheduling separately from Hub TeamRun sign-in', () => {
    mockHubSession.hubAuthenticated = false;
    mockHubSession.authAuthenticated = false;
    mockHubSession.token = '';
    mockHubSession.refreshToken = '';
    mockAgents.splice(
      0,
      mockAgents.length,
      {
        id: 'orchestrator',
        name: 'Orchestrator',
        description: 'Local supervisor runtime',
        status: 'available',
        capabilities: {
          streaming: true,
          toolCalls: true,
          fileChanges: true,
          thinkingVisible: true,
          multiTurn: true,
          mcpIntegration: true,
          permissionHooks: true,
          subAgentSpawn: true,
        },
      },
      {
        id: 'codex',
        name: 'Codex',
        description: 'Local Codex runtime',
        status: 'available',
        capabilities: {
          streaming: true,
          toolCalls: true,
          fileChanges: true,
          thinkingVisible: true,
          multiTurn: true,
          mcpIntegration: false,
          permissionHooks: false,
          subAgentSpawn: false,
        },
      },
    );

    render(<SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection="agentScheduling" />);

    const localPanel = screen.getByTestId('settings-local-orchestration');
    expect(within(localPanel).getByText('settings.localOrchestration')).toBeInTheDocument();
    expect(within(localPanel).getByText('settings.localOrchestrationRuntime')).toBeInTheDocument();
    expect(within(localPanel).getByText('Orchestrator')).toBeInTheDocument();
    expect(within(localPanel).getByText('1/2')).toBeInTheDocument();
    expect(screen.getAllByText('settings.targetHubSignInRequired').length).toBeGreaterThan(0);
    expect(screen.getAllByText('settings.agentTeamSignInRequired').length).toBeGreaterThan(0);
  });

  it('renders real AgentTeam TeamRun console state and wires approval/conflict actions', () => {
    mockAgentTeams.splice(0, mockAgentTeams.length, {
      id: 'team_scheduler',
      owner_id: 'user_1',
      name: 'Builder Review Team',
      description: 'Supervisor, builder, reviewer',
      members: [
        { id: 'member_supervisor', team_id: 'team_scheduler', role: 'supervisor' },
        { id: 'member_builder', team_id: 'team_scheduler', role: 'executor' },
      ],
    });
    mockAgentTeamRuns.splice(0, mockAgentTeamRuns.length, {
      id: 'team_run_1',
      team_id: 'team_scheduler',
      status: 'running',
      trigger_message: 'Implement scheduler Agent and subagent UI',
      created_at: '2026-05-28T01:00:00Z',
      updated_at: '2026-05-28T01:02:00Z',
    });
    mockAgentTeamMembers.splice(
      0,
      mockAgentTeamMembers.length,
      {
        member_id: 'member_supervisor',
        agent_profile_id: 'profile_supervisor',
        role: 'supervisor',
        active_tasks: 1,
        completed_tasks: 0,
      },
      {
        member_id: 'member_builder',
        agent_profile_id: 'profile_builder',
        role: 'executor',
        active_tasks: 1,
        completed_tasks: 2,
      },
    );
    mockAgentTeamTasks.splice(0, mockAgentTeamTasks.length, {
      task_id: 'team_task_1',
      assignee_member_id: 'member_builder',
      status: 'running',
      objective: 'Build TeamRun task board',
      agent_task_id: 'task_a',
      run_id: 'edge_run_1',
      edge_run_id: 'edge_run_1',
      attempt: 1,
      risk_level: 'normal',
    });
    mockAgentTeamAssignments.splice(0, mockAgentTeamAssignments.length, {
      assignment_id: 'assignment_1',
      from_member_id: 'member_supervisor',
      to_member_id: 'member_builder',
      type: 'delegate',
      status: 'running',
      edge_run_id: 'edge_run_1',
    });
    mockAgentTeamRouteLog.splice(0, mockAgentTeamRouteLog.length, {
      action: 'delegate',
      next_worker: 'member_builder',
      instructions: 'Build TeamRun task board',
      reasoning: 'UI subagent owns the Desktop surface',
    });
    mockAgentTeamApprovals.splice(0, mockAgentTeamApprovals.length, {
      approval_id: 'approval_1',
      status: 'pending',
      request_id: 'perm_1',
      tool_name: 'shell',
      reason: 'Run local test command',
      member_id: 'member_builder',
    });
    mockAgentTeamConflicts.splice(0, mockAgentTeamConflicts.length, {
      conflict_id: 'conflict_1',
      path: 'app/desktop/src/components/SettingsPage.tsx',
      status: 'pending',
      agent_task_ids: ['task_a', 'task_b'],
    });
    mockAgentTeamArtifacts.splice(
      0,
      mockAgentTeamArtifacts.length,
      {
        agent_task_id: 'task_a',
        team_task_id: 'team_task_1',
        member_id: 'member_builder',
        edge_run_id: 'edge_run_1',
        conflict_id: 'conflict_1',
        event_seq: 8,
        path: 'app/desktop/src/components/SettingsPage.tsx',
        action: 'modify',
        tool_name: 'filesystem',
        status: 'changed',
        created_at: '2026-05-28T01:04:00Z',
      },
      {
        agent_task_id: 'task_b',
        team_task_id: 'team_task_2',
        member_id: 'member_reviewer',
        edge_run_id: 'edge_run_2',
        conflict_id: 'conflict_1',
        event_seq: 9,
        path: 'app/desktop/src/components/SettingsPage.tsx',
        action: 'modify',
        tool_name: 'filesystem',
        status: 'changed',
        created_at: '2026-05-28T01:05:00Z',
      },
    );
    mockAgentTeamEvents.splice(0, mockAgentTeamEvents.length, {
      agent_task_id: 'task_a',
      edge_run_id: 'edge_run_1',
      event_seq: 7,
      event_type: 'agent.message',
      payload: 'subagent reported progress',
      created_at: '2026-05-28T01:03:00Z',
    });

    render(<SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection="agentScheduling" />);

    expect(screen.getByTestId('agent-team-console')).toBeInTheDocument();
    expect(screen.getAllByText('Builder Review Team').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Build TeamRun task board').length).toBeGreaterThan(0);
    expect(screen.getByText('shell')).toBeInTheDocument();
    expect(screen.getAllByText('agent.message').length).toBeGreaterThan(0);
    const graph = screen.getByTestId('agent-team-communication-graph');
    expect(within(graph).getByText('settings.agentTeamCommunicationGraph')).toBeInTheDocument();
    expect(within(graph).getAllByText('supervisor').length).toBeGreaterThan(0);
    expect(within(graph).getAllByText('executor').length).toBeGreaterThan(0);
    expect(within(graph).getAllByText('delegate').length).toBeGreaterThan(0);
    expect(within(graph).getByText('owns')).toBeInTheDocument();
    expect(within(graph).getByText('runs')).toBeInTheDocument();
    expect(within(graph).getAllByText('modify').length).toBeGreaterThan(0);
    expect(within(graph).getAllByText('conflict').length).toBeGreaterThan(0);
    fireEvent.click(within(graph).getByRole('button', { name: /executor/ }));
    expect(within(graph).getByRole('button', { name: /executor/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(graph).getByText('settings.agentTeamGraphIncoming')).toBeInTheDocument();
    expect(within(graph).getByText('settings.agentTeamGraphOutgoing')).toBeInTheDocument();
    expect(within(graph).queryByText('runs')).not.toBeInTheDocument();
    fireEvent.click(within(graph).getByRole('button', { name: /settings.agentTeamGraphAllLinks/ }));
    expect(within(graph).getByText('runs')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'settings.acceptAgentTask' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'settings.keepAllArtifacts' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'settings.allow' }));
    expect(mockDecideTeamApproval).toHaveBeenCalledWith({
      teamId: 'team_scheduler',
      runId: 'team_run_1',
      approvalId: 'approval_1',
      decision: {
        decision: 'allow',
        reason: 'Desktop TeamRun Console decision',
      },
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'settings.acceptAgentTask' })[0]);
    expect(mockResolveTeamConflict).toHaveBeenCalledWith({
      teamId: 'team_scheduler',
      runId: 'team_run_1',
      conflictId: 'conflict_1',
      resolution: {
        path: 'app/desktop/src/components/SettingsPage.tsx',
        resolution: 'accept_agent_task',
        selected_agent_task_id: 'task_a',
        reason: 'Accepted task_a from Desktop TeamRun Console',
      },
    });

    mockResolveTeamConflict.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'settings.markManualMerge' }));
    expect(mockResolveTeamConflict).toHaveBeenCalledWith({
      teamId: 'team_scheduler',
      runId: 'team_run_1',
      conflictId: 'conflict_1',
      resolution: {
        path: 'app/desktop/src/components/SettingsPage.tsx',
        resolution: 'manual_merge',
        reason: 'Marked from Desktop TeamRun Console',
      },
    });
  });

  it('switches TeamRun branches and reloads the selected Hub state path', () => {
    mockAgentTeams.splice(
      0,
      mockAgentTeams.length,
      {
        id: 'team_builder',
        owner_id: 'user_1',
        name: 'Builder Team',
        description: 'Build branch',
        members: [],
      },
      {
        id: 'team_review',
        owner_id: 'user_1',
        name: 'Review Team',
        description: 'Review branch',
        members: [],
      },
    );
    mockAgentTeamRuns.splice(
      0,
      mockAgentTeamRuns.length,
      {
        id: 'team_run_builder',
        team_id: 'team_builder',
        status: 'running',
        trigger_message: 'Build TeamRun branch',
      },
      {
        id: 'team_run_review',
        team_id: 'team_review',
        status: 'completed',
        trigger_message: 'Review TeamRun result branch',
      },
    );

    render(<SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection="agentScheduling" />);

    expect(screen.getAllByText('Build TeamRun branch').length).toBeGreaterThan(1);
    expect(screen.getAllByText('Review TeamRun result branch')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /Review TeamRun result branch/ }));

    expect(screen.getAllByText('Review TeamRun result branch').length).toBeGreaterThan(1);
    expect(screen.getByRole('button', { name: /Review TeamRun result branch/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders TeamRun result, artifact, budget, and terminal reason blocks from Hub state', () => {
    mockAgentTeams.splice(0, mockAgentTeams.length, {
      id: 'team_release',
      owner_id: 'user_1',
      name: 'Release Team',
      description: 'Supervisor with reviewer',
      members: [],
    });
    mockAgentTeamRuns.splice(0, mockAgentTeamRuns.length, {
      id: 'team_run_release',
      team_id: 'team_release',
      status: 'completed',
      trigger_message: 'Prepare release notes and verify artifacts',
    });
    mockAgentTeamEvents.splice(0, mockAgentTeamEvents.length, {
      agent_task_id: 'task_release',
      edge_run_id: 'edge_run_release',
      event_seq: 12,
      event_type: 'agent.result',
      payload: 'Release notes are ready for reviewer handoff.',
      created_at: '2026-05-28T02:03:00Z',
    });
    mockAgentTeamArtifacts.splice(0, mockAgentTeamArtifacts.length, {
      team_task_id: 'team_task_release',
      member_id: 'member_reviewer',
      edge_run_id: 'edge_run_release',
      event_seq: 13,
      path: 'reports/teamrun-summary.md',
      action: 'write',
      tool_name: 'filesystem',
      status: 'created',
      created_at: '2026-05-28T02:04:00Z',
    });
    mockAgentTeamBudget.value = {
      total_tokens_used: 1280,
      input_tokens: 980,
      output_tokens: 300,
      token_limit: 4000,
      remaining_tokens: 2720,
      usage_percent: 32,
      run_count: 2,
      context_warnings: 1,
      compactions: 0,
    };
    mockAgentTeamTerminalReason.value = 'Supervisor finished after reviewer approved all artifacts.';

    render(<SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection="agentScheduling" />);

    expect(screen.getByText('settings.agentTeamResults')).toBeInTheDocument();
    expect(screen.getByText('Supervisor finished after reviewer approved all artifacts.')).toBeInTheDocument();
    expect(screen.getAllByText('Release notes are ready for reviewer handoff.').length).toBeGreaterThan(0);
    expect(screen.getByText('settings.agentTeamArtifacts')).toBeInTheDocument();
    expect(screen.getAllByText('reports/teamrun-summary.md').length).toBeGreaterThan(0);
    expect(screen.getAllByText('filesystem').length).toBeGreaterThan(0);
    expect(screen.getByText('settings.agentTeamBudget')).toBeInTheDocument();
    expect(screen.getByText('1,280 / 4,000')).toBeInTheDocument();
    expect(screen.getByText('settings.agentTeamBudgetWarnings')).toBeInTheDocument();
  });

  it('wires Team Builder create, member, and TeamRun actions to Hub mutations', () => {
    mockAgentTeams.splice(0, mockAgentTeams.length, {
      id: 'team_scheduler',
      owner_id: 'user_1',
      name: 'Builder Review Team',
      description: 'Supervisor, builder, reviewer',
      members: [],
    });
    mockHubCustomAgents.splice(0, mockHubCustomAgents.length, {
      id: 'profile_builder',
      name: 'Builder',
      agent_type: 'codex',
      system_prompt: 'Build implementation slices.',
    });

    render(<SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection="agentScheduling" />);

    expect(screen.getByTestId('agent-team-builder')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('settings.agentTeamNamePlaceholder'), {
      target: { value: 'Reviewer Squad' },
    });
    fireEvent.change(screen.getByPlaceholderText('settings.agentTeamDescriptionPlaceholder'), {
      target: { value: 'Review implementation and tests.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'settings.agentTeamCreateAction' }));
    expect(mockCreateAgentTeam).toHaveBeenCalledWith({
      name: 'Reviewer Squad',
      description: 'Review implementation and tests.',
    });

    fireEvent.change(screen.getByDisplayValue('settings.agentTeamSelectProfile'), {
      target: { value: 'profile_builder' },
    });
    fireEvent.change(screen.getByDisplayValue('settings.teamMemberRole.executor'), {
      target: { value: 'reviewer' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'settings.agentTeamAddMember' }));
    expect(mockAddAgentTeamMember).toHaveBeenCalledWith({
      teamId: 'team_scheduler',
      member: {
        agent_profile_id: 'profile_builder',
        role: 'reviewer',
      },
    });

    fireEvent.change(screen.getByPlaceholderText('settings.agentTeamRunPromptPlaceholder'), {
      target: { value: 'Coordinate a Desktop UI review.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'settings.agentTeamStartRunAction' }));
    expect(mockStartTeamRun).toHaveBeenCalledWith({
      teamId: 'team_scheduler',
      run: {
        trigger_message: 'Coordinate a Desktop UI review.',
      },
    });
  });

  it('renders runtime inventory separately from profile composition', () => {
    mockAgents.splice(0, mockAgents.length, {
      id: 'claude-code',
      name: 'Claude Code',
      description: 'Claude Code runtime',
      status: 'available',
      capabilities: {
        streaming: true,
        toolCalls: true,
        fileChanges: true,
        thinkingVisible: true,
        multiTurn: true,
        mcpIntegration: true,
        permissionHooks: true,
        subAgentSpawn: false,
      },
    });

    render(<SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection="agentProfiles" />);

    expect(screen.getByText('settings.runtimeInventory')).toBeInTheDocument();
    expect(screen.getByText('settings.profileComposition')).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('settings.runtimeAdapter: claude-code')).toBeInTheDocument();
    expect(screen.getByText('settings.localProfileName')).toBeInTheDocument();
    expect(screen.getByText('settings.profileRuntime: claude-code')).toBeInTheDocument();
    expect(screen.getByText('settings.profileModel: opus[1m]')).toBeInTheDocument();
    expect(screen.getByText('settings.modelAliasProvider: tokendance-gateway')).toBeInTheDocument();
    expect(screen.getByText('settings.modelAliasReasoning: high')).toBeInTheDocument();
    expect(screen.getByText('settings.profileAlias: opus[1m]')).toBeInTheDocument();
    expect(screen.getByText('settings.executionTargets: settings.targetLocalEdge')).toBeInTheDocument();
    expect(screen.getByText('settings.profileConfigSource: AGENTS.md / memory / skills')).toBeInTheDocument();
    expect(screen.getByText('settings.profileRuntime')).toBeInTheDocument();
    expect(screen.getByText('settings.profileModel')).toBeInTheDocument();
    expect(screen.getByText('settings.profileConfig')).toBeInTheDocument();
    expect(screen.getAllByText('settings.executionTargets').length).toBeGreaterThan(0);
  });

  it('renders Hub execution target inventory and can ping a target', () => {
    mockHubTargets.splice(
      0,
      mockHubTargets.length,
      {
        id: 'target-relay-1',
        owner_id: 'user_1',
        name: 'Hub relay alpha',
        target_type: 'hub_relay',
        trust_level: 'relay',
        health_state: 'healthy',
        is_online: true,
      },
      {
        id: 'target-ssh-1',
        owner_id: 'user_1',
        name: 'SSH workstation',
        target_type: 'remote_ssh',
        trust_level: 'remote',
        health_state: 'degraded',
        is_online: false,
      },
    );

    render(<SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection="executionTargets" />);

    expect(screen.getAllByText('settings.targetHubInventory').length).toBeGreaterThan(0);
    expect(screen.getByText('settings.targetHubHealth')).toBeInTheDocument();
    expect(screen.getByText('Hub relay alpha')).toBeInTheDocument();
    expect(screen.getByText('SSH workstation')).toBeInTheDocument();
    expect(screen.getAllByText('settings.targetHealth.healthy').length).toBeGreaterThan(0);
    expect(screen.getAllByText('settings.targetHealth.degraded').length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole('button', { name: 'settings.targetPing' })[0]);

    expect(mockPingHubTarget).toHaveBeenCalledWith('target-relay-1');
  });

  it('renders Hub execution target loading, empty, and error copy', () => {
    mockHubTargetsState.isLoading = true;
    const { rerender } = render(
      <SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection="executionTargets" />,
    );

    expect(screen.getAllByText('settings.targetHubLoading').length).toBeGreaterThan(0);

    mockHubTargetsState.isLoading = false;
    rerender(<SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection="executionTargets" />);
    expect(screen.getAllByText('settings.targetHubEmpty').length).toBeGreaterThan(0);
    expect(screen.getByText('settings.targetHubEmptyDesc')).toBeInTheDocument();

    mockHubTargetsState.isError = true;
    mockHubTargetsState.error = new Error('Hub unavailable');
    rerender(<SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection="executionTargets" />);
    expect(screen.getAllByText('settings.targetHubError').length).toBeGreaterThan(0);
    expect(screen.getByText('Hub unavailable')).toBeInTheDocument();
  });

  it('renders agent market readiness from local profiles and capabilities', () => {
    mockAgents.splice(0, mockAgents.length, {
      id: 'codex',
      name: 'Codex',
      description: 'Local Codex runtime',
      status: 'available',
      capabilities: {
        streaming: true,
        toolCalls: true,
        fileChanges: true,
        thinkingVisible: false,
        multiTurn: true,
        mcpIntegration: false,
        permissionHooks: false,
        subAgentSpawn: false,
      },
    });

    render(<SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection="agentMarket" />);

    expect(screen.getByText('settings.marketLocalProfiles')).toBeInTheDocument();
    expect(screen.getByText('settings.marketPublishReady')).toBeInTheDocument();
    expect(screen.getByText('settings.marketInstalledProfiles')).toBeInTheDocument();
    expect(screen.getByText('Codex')).toBeInTheDocument();
    expect(screen.getByText('streaming')).toBeInTheDocument();
    expect(screen.getByText('toolCalls')).toBeInTheDocument();
    expect(screen.getByText('settings.marketTokenDancePublish')).toBeInTheDocument();
    expect(screen.getByText('settings.marketGuard')).toBeInTheDocument();
  });

  it('renders MCP runtime capability matrix from local profiles', () => {
    mockAgents.splice(
      0,
      mockAgents.length,
      {
        id: 'claude-code',
        name: 'Claude Code',
        description: 'Claude Code runtime',
        status: 'available',
        capabilities: {
          streaming: true,
          toolCalls: true,
          fileChanges: true,
          thinkingVisible: false,
          multiTurn: true,
          mcpIntegration: true,
          permissionHooks: true,
          subAgentSpawn: false,
        },
      },
      {
        id: 'codex',
        name: 'Codex',
        description: 'Codex runtime',
        status: 'available',
        capabilities: {
          streaming: true,
          toolCalls: true,
          fileChanges: true,
          thinkingVisible: true,
          multiTurn: true,
          mcpIntegration: false,
          permissionHooks: false,
          subAgentSpawn: false,
        },
      },
    );

    render(<SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection="mcp" />);

    expect(screen.getByText('settings.mcpRuntimeSupport')).toBeInTheDocument();
    expect(screen.getByText('settings.mcpRuntimeMatrix')).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Codex')).toBeInTheDocument();
    expect(screen.getByText('settings.mcpTemplates')).toBeInTheDocument();
    expect(screen.getByText('settings.mcpTokenDanceHub')).toBeInTheDocument();
    expect(screen.getByText('settings.mcpGuard')).toBeInTheDocument();
  });

  it('renders account identity boundary from Hub session and local device state', () => {
    localStorage.setItem('agenthub_device_id', '00000000-0000-0000-0000-00000000a001');

    render(<SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection="account" />);

    expect(screen.getAllByText('TokenDance User').length).toBeGreaterThan(0);
    expect(screen.getAllByText('settings.hubSession').length).toBeGreaterThan(0);
    expect(screen.getByText('settings.desktopDevice')).toBeInTheDocument();
    expect(screen.getByText('00000000...a001')).toBeInTheDocument();
    expect(screen.getByText('settings.identityBoundary')).toBeInTheDocument();
    expect(screen.getByText('settings.authTokenSource')).toBeInTheDocument();
    expect(screen.getByText('settings.deviceProof')).toBeInTheDocument();
    expect(screen.getByText('settings.accountGuard')).toBeInTheDocument();
  });

  it('keeps sign out inside the account section instead of the sidebar footer', () => {
    render(<SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection="general" />);

    expect(screen.queryByText('settings.signOut')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /TokenDance User/ }));

    expect(screen.getByText('settings.accountConnected')).toBeInTheDocument();
    expect(screen.getByText('settings.signOut')).toBeInTheDocument();
  });

  it('keeps Hub-gated task sync disabled while signed out', () => {
    mockHubSession.hubAuthenticated = false;
    mockHubSession.authAuthenticated = false;
    mockHubSession.token = '';
    mockHubSession.refreshToken = '';
    mockHubSession.tokenSource = 'none';
    mockHubSession.username = '';

    render(<SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection="tasks" />);

    const taskSyncSwitch = screen.getByRole('switch');
    expect(taskSyncSwitch).toBeDisabled();
    expect(taskSyncSwitch).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(taskSyncSwitch);

    expect(localStorage.getItem('agenthub-settings.taskSync')).toBeNull();
  });

  it('saves and clears local custom instructions', () => {
    render(<SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection="personalization" />);

    const editor = screen.getByLabelText('settings.instructionsLabel');
    fireEvent.change(editor, { target: { value: 'Always answer with focused test evidence.' } });
    fireEvent.click(screen.getByRole('button', { name: 'settings.saveInstructions' }));

    expect(localStorage.getItem('agenthub-settings.customInstructions')).toBe('Always answer with focused test evidence.');
    expect(screen.getByText('settings.enabled')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'settings.clearInstructions' }));

    expect(localStorage.getItem('agenthub-settings.customInstructions')).toBeNull();
    expect(editor).toHaveValue('');
  });

  it('does not persist controls whose backing API is not wired yet', () => {
    const unavailableSections: Array<[SectionId, string]> = [
      ['skills', 'skillSync'],
      ['remoteControl', 'remoteControl'],
      ['platforms', 'platformSync'],
      ['securityAudit', 'auditTrail'],
    ];

    for (const [section, storageKey] of unavailableSections) {
      cleanup();
      render(<SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection={section} />);

      const disabledSwitch = screen.getByRole('switch');
      expect(disabledSwitch).toBeDisabled();

      fireEvent.click(disabledSwitch);

      expect(localStorage.getItem(`agenthub-settings.${storageKey}`)).toBeNull();
    }
  });

  it('renders project skill registry with script and review metadata', () => {
    render(<SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection="skills" />);

    expect(screen.getByText('settings.skillProjectRegistry')).toBeInTheDocument();
    expect(screen.getByText('settings.skillReviewReady')).toBeInTheDocument();
    expect(screen.getByText('settings.skillInstalled')).toBeInTheDocument();
    expect(screen.getByText('adapter-dev')).toBeInTheDocument();
    expect(screen.getByText('dev-loop')).toBeInTheDocument();
    expect(screen.getByText('ui-screenshot')).toBeInTheDocument();
    expect(screen.getByText('settings.skillScriptAudit')).toBeInTheDocument();
    expect(screen.getByText('settings.skillReferences')).toBeInTheDocument();
    expect(screen.getByText('settings.skillGuard')).toBeInTheDocument();
  });

  it('persists model defaults from the model configuration panel', () => {
    render(<SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection="models" />);

    fireEvent.change(screen.getByDisplayValue('Auto'), { target: { value: 'gpt-5.5' } });
    fireEvent.change(screen.getByDisplayValue('TokenDance'), { target: { value: 'openai' } });
    fireEvent.change(screen.getByDisplayValue('High'), { target: { value: 'max' } });

    expect(useModelSettingsStore.getState()).toMatchObject({
      defaultModel: 'gpt-5.5',
      defaultProvider: 'openai',
      reasoningEffort: 'max',
    });
    expect(screen.getByText('settings.modelLocalGuard')).toBeInTheDocument();
  });

  it('edits model alias routing from the model mapping panel', () => {
    render(<SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection="modelMapping" />);

    expect(screen.getByText('opus')).toBeInTheDocument();
    fireEvent.change(screen.getAllByDisplayValue('deepseek-v4-pro')[0], {
      target: { value: 'gpt-5.5' },
    });
    fireEvent.click(screen.getAllByRole('switch')[1]);

    const opus = useModelSettingsStore.getState().aliases.find((item) => item.alias === 'opus');
    expect(opus).toMatchObject({ model: 'gpt-5.5', enabled: false });
    expect(screen.getByText('settings.modelPolicy')).toBeInTheDocument();
  });

  it('edits cc-switch provider health and notes locally', () => {
    render(<SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection="ccSwitch" />);

    fireEvent.click(screen.getAllByRole('switch')[0]);
    fireEvent.change(screen.getAllByDisplayValue('Degraded')[0], {
      target: { value: 'ready' },
    });
    fireEvent.change(screen.getByDisplayValue('Local provider bridge; health should be refreshed by cc-switch integration.'), {
      target: { value: 'healthy after manual check' },
    });

    expect(useModelSettingsStore.getState().ccSwitchBridgeEnabled).toBe(true);
    const localProvider = useModelSettingsStore.getState().ccSwitchProviders.find((item) => item.id === 'cc-switch-local');
    expect(localProvider).toMatchObject({ health: 'ready', notes: 'healthy after manual check' });
    expect(screen.getAllByText('settings.ccSwitchHealth').length).toBeGreaterThan(0);
  });
});

describe('SettingsPage search', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useModelSettingsStore.getState().reset();
  });

  it('renders search input in sidebar', () => {
    render(<SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection="general" />);

    const searchInput = screen.getByPlaceholderText('settings.searchPlaceholder');
    expect(searchInput).toBeInTheDocument();
  });

  it('filters nav items by search query', () => {
    render(<SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection="general" />);

    const searchInput = screen.getByPlaceholderText('settings.searchPlaceholder');
    fireEvent.change(searchInput, { target: { value: 'appearance' } });

    // Scope nav queries to the sidebar <nav> to avoid matching content headings
    const nav = screen.getByRole('navigation');
    expect(within(nav).getByText('settings.appearance')).toBeInTheDocument();
    expect(within(nav).queryByText('settings.general')).not.toBeInTheDocument();
  });

  it('shows all nav items when search is empty', () => {
    render(<SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection="general" />);

    const nav = screen.getByRole('navigation');
    expect(within(nav).getByText('settings.general')).toBeInTheDocument();
    expect(within(nav).getByText('settings.appearance')).toBeInTheDocument();
    expect(within(nav).getByText('settings.account')).toBeInTheDocument();
  });

  it('shows no items when search matches nothing', () => {
    render(<SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection="general" />);

    const searchInput = screen.getByPlaceholderText('settings.searchPlaceholder');
    fireEvent.change(searchInput, { target: { value: 'zzzdoesnotexistzzz' } });

    const nav = screen.getByRole('navigation');
    expect(within(nav).queryByText('settings.general')).not.toBeInTheDocument();
    expect(within(nav).queryByText('settings.appearance')).not.toBeInTheDocument();
    expect(within(nav).getByRole('status')).toHaveTextContent('settings.searchEmpty');
  });
});
