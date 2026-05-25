import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import SettingsPage from '@/components/SettingsPage';
import { useModelSettingsStore } from '@/stores/modelSettingsStore';
import type { AgentInfo, RunInfo } from '@shared/types';
import type { AgentTask } from '@/stores/taskBridgeStore';

const { mockAgents, mockCancelRun, mockRefetchRuns, mockRuns, mockTasks } = vi.hoisted(() => ({
  mockAgents: [] as AgentInfo[],
  mockCancelRun: vi.fn(),
  mockRefetchRuns: vi.fn(),
  mockRuns: [] as RunInfo[],
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
    selector({ authenticated: true, username: 'TokenDance User', clear: vi.fn() }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    token: 'hub_access_token',
    refreshToken: 'hub_refresh_token',
    user: { id: 'user_1', username: 'TokenDance User' },
    isAuthenticated: true,
    tokenSource: 'hub',
    login: vi.fn(),
    loginWithTokenDance: vi.fn(),
    logout: vi.fn(),
    tryAutoLogin: vi.fn(),
  }),
}));

describe('SettingsPage tasks', () => {
  beforeEach(() => {
    mockAgents.splice(0, mockAgents.length);
    mockRuns.splice(0, mockRuns.length);
    mockTasks.splice(0, mockTasks.length);
    mockCancelRun.mockReset();
    mockRefetchRuns.mockReset();
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
    expect(screen.getByText('settings.profileRuntime')).toBeInTheDocument();
    expect(screen.getByText('settings.profileModel')).toBeInTheDocument();
    expect(screen.getByText('settings.profileConfig')).toBeInTheDocument();
    expect(screen.getAllByText('settings.executionTargets').length).toBeGreaterThan(0);
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
    sessionStorage.setItem('td_code_verifier', 'verifier');
    sessionStorage.setItem('td_state', 'state');

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
    fireEvent.change(screen.getByDisplayValue('TokenDance Relay'), { target: { value: 'openai' } });
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
    fireEvent.change(screen.getAllByDisplayValue('claude-opus-4-7')[0], {
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
