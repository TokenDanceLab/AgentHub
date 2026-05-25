import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentProps } from 'react';
import '@testing-library/jest-dom/vitest';
import SettingsPage from '@/components/SettingsPage';
import { useModelSettingsStore } from '@/stores/modelSettingsStore';
import enLocale from '@/i18n/locales/en.json';
import zhLocale from '@/i18n/locales/zh.json';
import type { AgentInfo, RunInfo } from '@shared/types';
import type { AgentTask } from '@/stores/taskBridgeStore';

const {
  mockAgents,
  mockCancelRun,
  mockCustomAgents,
  mockFriendRequests,
  mockHubAuthState,
  mockHubClient,
  mockHubStoreState,
  mockNotifications,
  mockRefetchRuns,
  mockRuns,
  mockSessions,
  mockContacts,
  mockTasks,
  mockUseHealthState,
} = vi.hoisted(() => ({
  mockAgents: [] as AgentInfo[],
  mockCancelRun: vi.fn(),
  mockCustomAgents: [] as Record<string, unknown>[],
  mockFriendRequests: [] as Record<string, unknown>[],
  mockHubAuthState: {
    token: 'hub_access_token' as string | null,
    refreshToken: 'hub_refresh_token' as string | null,
    user: { id: 'user_1', username: 'TokenDance User' } as { id: string; username: string } | null,
    isAuthenticated: true,
    tokenSource: 'hub',
  },
  mockHubClient: {
    listContacts: vi.fn(),
    listSessions: vi.fn(),
    listFriendRequests: vi.fn(),
    listNotifications: vi.fn(),
    listCustomAgents: vi.fn(),
    registerDevice: vi.fn(),
  },
  mockHubStoreState: {
    authenticated: true,
    username: 'TokenDance User',
    clear: vi.fn(),
  },
  mockNotifications: [] as Record<string, unknown>[],
  mockRefetchRuns: vi.fn(),
  mockRuns: [] as RunInfo[],
  mockSessions: [] as Record<string, unknown>[],
  mockContacts: [] as Record<string, unknown>[],
  mockTasks: [] as AgentTask[],
  mockUseHealthState: {
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
  },
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
  useHealth: () => mockUseHealthState,
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
    selector(mockHubStoreState),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    ...mockHubAuthState,
    tokenSource: 'hub',
    login: vi.fn(),
    loginWithTokenDance: vi.fn(),
    logout: vi.fn(),
    tryAutoLogin: vi.fn(),
  }),
}));

vi.mock('@/api/hubClient', () => ({
  createHubClient: () => mockHubClient,
}));

function renderSettings(initialSection: ComponentProps<typeof SettingsPage>['initialSection'], props = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection={initialSection} {...props} />
    </QueryClientProvider>,
  );
}

describe('SettingsPage tasks', () => {
  beforeEach(() => {
    mockAgents.splice(0, mockAgents.length);
    mockCustomAgents.splice(0, mockCustomAgents.length);
    mockFriendRequests.splice(0, mockFriendRequests.length);
    mockNotifications.splice(0, mockNotifications.length);
    mockRuns.splice(0, mockRuns.length);
    mockSessions.splice(0, mockSessions.length);
    mockContacts.splice(0, mockContacts.length);
    mockTasks.splice(0, mockTasks.length);
    mockCancelRun.mockReset();
    mockHubClient.listContacts.mockReset();
    mockHubClient.listSessions.mockReset();
    mockHubClient.listFriendRequests.mockReset();
    mockHubClient.listNotifications.mockReset();
    mockHubClient.listCustomAgents.mockReset();
    mockHubClient.registerDevice.mockReset();
    mockHubClient.listContacts.mockImplementation(async () => mockContacts);
    mockHubClient.listSessions.mockImplementation(async () => mockSessions);
    mockHubClient.listFriendRequests.mockImplementation(async () => mockFriendRequests);
    mockHubClient.listNotifications.mockImplementation(async () => mockNotifications);
    mockHubClient.listCustomAgents.mockImplementation(async () => mockCustomAgents);
    mockHubClient.registerDevice.mockImplementation(async () => ({ id: 'dev-1' }));
    mockHubStoreState.authenticated = true;
    mockHubStoreState.username = 'TokenDance User';
    Object.assign(mockHubAuthState, {
      token: 'hub_access_token',
      refreshToken: 'hub_refresh_token',
      user: { id: 'user_1', username: 'TokenDance User' },
      isAuthenticated: true,
      tokenSource: 'hub',
    });
    Object.assign(mockUseHealthState, {
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
    });
    mockRefetchRuns.mockReset();
    localStorage.clear();
    sessionStorage.clear();
    useModelSettingsStore.getState().reset();
  });

  it('renders local runs, Hub bridge history, and the Hub list REST interface gap state', () => {
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
    renderSettings('tasks');

    expect(screen.getByText('settings.taskLocalRuns')).toBeInTheDocument();
    expect(screen.getByText('settings.taskHubBridge')).toBeInTheDocument();
    expect(screen.getByText('proj_local / thread_local')).toBeInTheDocument();
    expect(screen.getByText('Dispatch from TokenDance Hub')).toBeInTheDocument();
    expect(screen.getByText('agent-codex')).toBeInTheDocument();
    expect(screen.getAllByText('settings.status.interfaceGap').length).toBeGreaterThan(0);
    expect(screen.getAllByText('settings.taskHubSnapshotUnavailable').length).toBeGreaterThan(0);
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

    renderSettings('tasks');

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

    renderSettings('agentScheduling');

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

  it('renders Online IM from Hub snapshot without contract placeholder state', async () => {
    mockContacts.splice(0, mockContacts.length, {
      user_id: 'friend-1',
      username: 'alice',
      nickname: 'Alice',
      online: true,
      type: 'friend',
    });
    mockSessions.splice(0, mockSessions.length, {
      session_id: 'sess-im-1',
      type: 'private',
      name: 'Alice DM',
      member_count: 2,
      updated_at: '2026-05-25T01:04:00Z',
    });
    mockFriendRequests.splice(0, mockFriendRequests.length, {
      request_id: 'fr-1',
      user_id: 'friend-2',
      username: 'bob',
      nickname: 'Bob',
      message: 'hi',
      created_at: '2026-05-25T01:05:00Z',
    });
    mockNotifications.splice(0, mockNotifications.length, {
      id: 'notif-1',
      user_id: 'user-1',
      type: 'mention',
      payload: JSON.stringify({ title: 'Mention', content: 'Check this thread' }),
      read: false,
      created_at: '2026-05-25T01:06:00Z',
    });

    renderSettings('onlineIm');

    expect(await screen.findByText('Alice DM')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Mention')).toBeInTheDocument();
    expect(screen.getByText('Check this thread')).toBeInTheDocument();
    expect(screen.getAllByText('settings.readOnly').length).toBeGreaterThan(0);
    expect(screen.getByText('settings.onlineImSnapshot')).toBeInTheDocument();
    expect(screen.getAllByText('settings.status.snapshot').length).toBeGreaterThan(0);
    expect(screen.queryByText('settings.contractPending')).not.toBeInTheDocument();
    expect(mockHubClient.listContacts).toHaveBeenCalled();
    expect(mockHubClient.listSessions).toHaveBeenCalled();
    expect(mockHubClient.listFriendRequests).toHaveBeenCalled();
    expect(mockHubClient.listNotifications).toHaveBeenCalledWith({ limit: 20 });
  });

  it('does not label pending Online IM queries as real snapshots', () => {
    mockHubClient.listContacts.mockImplementation(() => new Promise(() => undefined));

    renderSettings('onlineIm');

    expect(screen.getAllByText('settings.loading').length).toBeGreaterThan(0);
    expect(screen.queryByText('settings.status.snapshot')).not.toBeInTheDocument();
  });

  it('locks Online IM while signed out and skips Hub snapshot calls', () => {
    mockHubStoreState.authenticated = false;
    Object.assign(mockHubAuthState, {
      token: null,
      refreshToken: null,
      user: null,
      isAuthenticated: false,
    });

    renderSettings('onlineIm');

    expect(screen.getByText('settings.hubSignInRequired')).toBeInTheDocument();
    expect(screen.getAllByText('settings.onlineImSignedOutDesc').length).toBeGreaterThan(0);
    expect(mockHubClient.listContacts).not.toHaveBeenCalled();
    expect(mockHubClient.listSessions).not.toHaveBeenCalled();
  });

  it('renders Group Chat from real Hub group sessions', async () => {
    mockSessions.splice(
      0,
      mockSessions.length,
      {
        session_id: 'sess-group-1',
        type: 'group',
        name: 'Build Room',
        member_count: 3,
        updated_at: '2026-05-25T01:04:00Z',
      },
      {
        session_id: 'sess-private-1',
        type: 'private',
        name: 'Alice DM',
        member_count: 2,
      },
    );

    renderSettings('groupChat');

    expect(await screen.findByText('Build Room')).toBeInTheDocument();
    expect(screen.getByText('settings.groupChatHubRooms')).toBeInTheDocument();
    expect(screen.getByText('settings.status.snapshot')).toBeInTheDocument();
    expect(screen.queryByText('settings.contractPending')).not.toBeInTheDocument();
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

    renderSettings('agentProfiles');

    expect(screen.getByText('settings.runtimeInventory')).toBeInTheDocument();
    expect(screen.getByText('settings.profileComposition')).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('settings.runtimeAdapter: claude-code')).toBeInTheDocument();
    expect(screen.getByText('settings.localProfileName')).toBeInTheDocument();
    expect(screen.getByText('settings.profileRuntime: claude-code')).toBeInTheDocument();
    expect(screen.getByText('settings.profileModel: claude-opus-4-7')).toBeInTheDocument();
    expect(screen.getByText('settings.modelAliasProvider: anthropic')).toBeInTheDocument();
    expect(screen.getByText('settings.modelAliasReasoning: max')).toBeInTheDocument();
    expect(screen.getByText('settings.profileAlias: opus')).toBeInTheDocument();
    expect(screen.getByText('settings.executionTargets: settings.targetLocalEdge')).toBeInTheDocument();
    expect(screen.getByText('settings.profileConfigSource: AGENTS.md / memory / skills')).toBeInTheDocument();
    expect(screen.getByText('settings.profileRuntime')).toBeInTheDocument();
    expect(screen.getByText('settings.profileModel')).toBeInTheDocument();
    expect(screen.getByText('settings.profileConfig')).toBeInTheDocument();
    expect(screen.getAllByText('settings.executionTargets').length).toBeGreaterThan(0);
  });

  it('renders agent market readiness from Hub CustomAgents and capabilities', async () => {
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

    mockCustomAgents.splice(0, mockCustomAgents.length, {
      id: 'agent-market-codex',
      name: 'Market Codex',
      agent_type: 'custom',
      system_prompt: 'Hub market agent',
      capability_tags: ['streaming', 'toolCalls'],
      updated_at: '2026-05-25T01:00:00Z',
    });

    renderSettings('agentMarket');

    expect(screen.getByText('settings.marketLocalProfiles')).toBeInTheDocument();
    expect(screen.getByText('settings.marketPublishReady')).toBeInTheDocument();
    expect(screen.getByText('settings.marketInstalledProfiles')).toBeInTheDocument();
    expect(await screen.findByText('Market Codex')).toBeInTheDocument();
    expect(screen.getByText('streaming')).toBeInTheDocument();
    expect(screen.getByText('toolCalls')).toBeInTheDocument();
    expect(screen.getByText('settings.status.snapshot')).toBeInTheDocument();
    expect(screen.getByText('settings.marketTokenDancePublish')).toBeInTheDocument();
    expect(screen.getByText('settings.marketGuard')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'settings.marketRefresh' }));
    expect(mockHubClient.listCustomAgents).toHaveBeenCalledTimes(2);
  });

  it('requires Hub sign-in for Agent Market and does not render local runtimes as fake market agents', () => {
    mockHubStoreState.authenticated = false;
    Object.assign(mockHubAuthState, {
      token: null,
      refreshToken: null,
      user: null,
      isAuthenticated: false,
    });
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

    renderSettings('agentMarket');

    expect(screen.getByText('settings.hubSignInRequired')).toBeInTheDocument();
    expect(screen.queryByText('Codex')).not.toBeInTheDocument();
    expect(mockHubClient.listCustomAgents).not.toHaveBeenCalled();
  });

  it('shows Hub failure for Agent Market instead of falling back to local fake agents', async () => {
    mockHubClient.listCustomAgents.mockRejectedValueOnce(new Error('hub down'));
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

    renderSettings('agentMarket');

    expect(await screen.findByText('settings.hubUnavailable')).toBeInTheDocument();
    expect(screen.getByText('settings.status.error')).toBeInTheDocument();
    expect(screen.queryByText('settings.status.snapshot')).not.toBeInTheDocument();
    expect(screen.queryByText('Codex')).not.toBeInTheDocument();
  });

  it('defines localized settings status error labels', () => {
    expect(enLocale['settings.status.error']).toBe('Error');
    expect(zhLocale['settings.status.error']).toBe('错误');
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

    renderSettings('mcp');

    expect(screen.getByText('settings.mcpRuntimeSupport')).toBeInTheDocument();
    expect(screen.getByText('settings.mcpRuntimeMatrix')).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Codex')).toBeInTheDocument();
    expect(screen.getByText('settings.mcpTemplates')).toBeInTheDocument();
    expect(screen.getByText('settings.mcpTokenDanceHub')).toBeInTheDocument();
    expect(screen.getByText('settings.mcpGuard')).toBeInTheDocument();
  });

  it('keeps MCP local-source only when Edge is offline', () => {
    Object.assign(mockUseHealthState, {
      online: false,
      health: null,
    });

    renderSettings('mcp');

    expect(screen.getByText('settings.mcpNoRuntimes')).toBeInTheDocument();
    expect(screen.getAllByText('settings.status.interfaceGap').length).toBeGreaterThan(0);
    expect(screen.queryByText('settings.statusReady')).not.toBeInTheDocument();
  });

  it('renders account identity boundary from Hub session and registered device state', async () => {
    localStorage.setItem('agenthub_device_id', '00000000-0000-0000-0000-00000000a001');
    sessionStorage.setItem('td_code_verifier', 'verifier');
    sessionStorage.setItem('td_state', 'state');

    renderSettings('account');

    expect(screen.getAllByText('TokenDance User').length).toBeGreaterThan(0);
    expect(screen.getAllByText('settings.hubSession').length).toBeGreaterThan(0);
    expect(screen.getByText('settings.desktopDevice')).toBeInTheDocument();
    expect((await screen.findAllByText('settings.deviceStatus.registered')).length).toBeGreaterThan(0);
    expect(screen.getByText('00000000...a001')).toBeInTheDocument();
    expect(screen.getByText('settings.identityBoundary')).toBeInTheDocument();
    expect(screen.getByText('settings.authTokenSource')).toBeInTheDocument();
    expect(screen.getByText('settings.deviceProof')).toBeInTheDocument();
    expect(mockHubClient.registerDevice).toHaveBeenCalledWith({
      device_id: '00000000-0000-0000-0000-00000000a001',
      app_version: expect.any(String),
    });
    expect(screen.getByText('settings.accountGuard')).toBeInTheDocument();
  });

  it('renders project skill registry with script and review metadata', () => {
    renderSettings('skills');

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
    renderSettings('models');

    fireEvent.change(screen.getByDisplayValue('Auto'), { target: { value: 'gpt-5.5' } });
    fireEvent.change(screen.getByDisplayValue('TokenDance Relay'), { target: { value: 'openai' } });
    fireEvent.change(screen.getByDisplayValue('High'), { target: { value: 'max' } });

    expect(useModelSettingsStore.getState()).toMatchObject({
      defaultModel: 'gpt-5.5',
      defaultProvider: 'openai',
      reasoningEffort: 'max',
    });
    expect(screen.getByText('settings.modelConfigSource')).toBeInTheDocument();
    expect(screen.getByText('settings.status.localSource')).toBeInTheDocument();
    expect(screen.getByText('settings.modelLocalGuard')).toBeInTheDocument();
  });

  it('edits model alias routing from the model mapping panel', () => {
    renderSettings('modelMapping');

    expect(screen.getByText('opus')).toBeInTheDocument();
    fireEvent.change(screen.getAllByDisplayValue('claude-opus-4-7')[0], {
      target: { value: 'gpt-5.5' },
    });
    fireEvent.click(screen.getAllByRole('switch')[1]);

    const opus = useModelSettingsStore.getState().aliases.find((item) => item.alias === 'opus');
    expect(opus).toMatchObject({ model: 'gpt-5.5', enabled: false });
    expect(screen.getByText('settings.modelMappingSource')).toBeInTheDocument();
    expect(screen.getByText('settings.status.localSource')).toBeInTheDocument();
    expect(screen.getByText('settings.modelPolicy')).toBeInTheDocument();
  });

  it('edits cc-switch provider health and notes locally', () => {
    renderSettings('ccSwitch');

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
    expect(screen.getByText('settings.ccSwitchSource')).toBeInTheDocument();
    expect(screen.getByText('settings.status.localSource')).toBeInTheDocument();
    expect(screen.getAllByText('settings.ccSwitchHealth').length).toBeGreaterThan(0);
  });

  it('labels remote control devices with explicit interface gap state', () => {
    renderSettings('remoteControl');
    expect(screen.getByText('settings.status.interfaceGap')).toBeInTheDocument();
  });

  it('labels platform sync with local-source and interface gap states', () => {
    renderSettings('platforms');
    expect(screen.getAllByText('settings.status.localSource').length).toBeGreaterThan(0);
    expect(screen.getAllByText('settings.status.interfaceGap').length).toBeGreaterThan(0);
  });

  it('labels browser preview as an unwired Settings interface gap', () => {
    renderSettings('browser');

    expect(screen.getByText('settings.browserPreview')).toBeInTheDocument();
    expect(screen.getByText('settings.browserPreviewBoundaryDesc')).toBeInTheDocument();
    expect(screen.getByText('settings.status.interfaceGap')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('labels computer-use approval as an unwired Settings interface gap', () => {
    renderSettings('computerUse');

    expect(screen.getByText('settings.computerConfirm')).toBeInTheDocument();
    expect(screen.getByText('settings.computerConfirmBoundaryDesc')).toBeInTheDocument();
    expect(screen.getByText('settings.status.interfaceGap')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('labels security audit with local-source and interface gap states', () => {
    renderSettings('securityAudit');
    expect(screen.getByText('settings.auditTrailSource')).toBeInTheDocument();
    expect(screen.getByText('settings.status.localSource')).toBeInTheDocument();
    expect(screen.getAllByText('settings.status.interfaceGap').length).toBeGreaterThan(0);
  });
});
