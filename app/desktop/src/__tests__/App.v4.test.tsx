import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WORKBENCH_DATA_MODE_STORAGE_KEY } from '@shared/demo';
import type { EventEnvelope } from '@shared/events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App, { DesktopWorkbenchApp } from '@/App';
import { createEventStream } from '@/api/eventClient';
import { createHubClient } from '@/api/hubClient';
import { useAgentList } from '@/api/agentQueries';
import { useAgentProfileList, useCreateAgentProfile, useUpdateAgentProfile, useDeleteAgentProfile } from '@/api/agentProfileQueries';
import { useHubExecutionTargets, useSyncLocalEdgeExecutionTarget } from '@/api/executionTargetQueries';
import { useModelCatalog } from '@/api/modelCatalogQueries';
import { useRunEvidence } from '@/api/runEvidenceQueries';
import { useCreateRun, useCancelRun, useRuns, useDecideEdgePermission } from '@/api/runQueries';
import { useCreateThread, useCurrentUser, useThreadMessages, useThreadPins, useThreads } from '@/api/threadQueries';
import type { EventHandler, StatusHandler, StreamHandle } from '@/api/eventClient';
import { queryClient } from '@/api/queryClient';
import { getAgentActivityStore } from '@shared/transcript/agentActivity';
import { getAccessToken, useAuth } from '@/hooks/useAuth';
import { useDeviceRegistration } from '@/hooks/useDeviceRegistration';
import { useHealth } from '@/hooks/useHealth';
import { useHubEventStream } from '@/hooks/useHubEventStream';
import { useHubIntegration } from '@/hooks/useHubIntegration';

vi.mock('@/api/eventClient', () => ({
  createEventStream: vi.fn(),
}));

vi.mock('@/api/threadQueries', () => ({
  useCreateThread: vi.fn(),
  useThreadPins: vi.fn(),
  useThreadMessages: vi.fn(),
  useThreads: vi.fn(),
  useCurrentUser: vi.fn(),
}));

vi.mock('@/api/agentQueries', () => ({
  useAgentList: vi.fn(),
}));

vi.mock('@/api/executionTargetQueries', () => ({
  findRegisteredLocalEdgeTarget: vi.fn((targets, deviceId) => (
    targets.find((target: { target_type?: string; device_id?: string }) => (
      target.target_type === 'local_edge' && target.device_id === deviceId
    )) ?? null
  )),
  useHubExecutionTargets: vi.fn(),
  useSyncLocalEdgeExecutionTarget: vi.fn(),
}));

vi.mock('@/api/modelCatalogQueries', () => ({
  useModelCatalog: vi.fn(),
  useCCSwitchStatus: vi.fn(() => ({ data: undefined })),
  useCCSwitchProviders: vi.fn(() => ({ data: undefined })),
}));

vi.mock('@/api/runEvidenceQueries', () => ({
  useRunEvidence: vi.fn(),
}));

vi.mock('@/api/agentProfileQueries', () => ({
  useAgentProfileList: vi.fn(),
  useCreateAgentProfile: vi.fn(),
  useUpdateAgentProfile: vi.fn(),
  useDeleteAgentProfile: vi.fn(),
  edgeAgentProfileToWorkbenchAgent: vi.fn((profile) => profile),
  useHubAgentProfiles: vi.fn(() => ({ data: undefined })),
  hubAgentProfileToWorkbenchAgent: vi.fn((profile) => profile),
}));

vi.mock('@/api/runQueries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/runQueries')>();
  return {
    ...actual,
    useCreateRun: vi.fn(),
    useCancelRun: vi.fn(),
    useRuns: vi.fn(),
    useDecideEdgePermission: vi.fn(),
  };
});

vi.mock('@/api/hubClient', () => ({
  createHubClient: vi.fn(),
}));

vi.mock('@/api/queryClient', () => ({
  queryClient: {
    invalidateQueries: vi.fn(),
  },
}));

vi.mock('@/hooks/useAuth', () => ({
  getAccessToken: vi.fn(() => 'hub-token'),
  useAuth: vi.fn(),
}));

vi.mock('@/hooks/useHealth', () => ({
  useHealth: vi.fn(),
}));

vi.mock('@/hooks/useHubEventStream', () => ({
  useHubEventStream: vi.fn(),
}));

vi.mock('@/hooks/useDeviceRegistration', () => ({
  useDeviceRegistration: vi.fn(),
}));

vi.mock('@/hooks/useHubIntegration', () => ({
  useHubIntegration: vi.fn(),
}));

vi.mock('@/api/agentTeamQueries', () => ({
  useDecideTeamApproval: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock('@/api/documentQueries', () => ({
  useDocumentList: vi.fn(() => ({ data: undefined })),
  useCreateDocument: vi.fn(() => ({ mutateAsync: vi.fn() })),
  hubDocToDocRow: vi.fn((doc: unknown) => doc),
}));

vi.mock('@/api/hubQueries', () => ({
  getHubClient: vi.fn(() => ({
    listPublicSkills: vi.fn(() => ({ items: [] })),
    listPublicMCPServers: vi.fn(() => ({ items: [] })),
  })),
  useHubContacts: vi.fn(() => ({ data: undefined })),
  useHubSearchUser: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useHubSendFriendRequest: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useHubAcceptFriendRequest: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useHubRejectFriendRequest: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useHubRemoveContact: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useHubBlockContact: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useHubUnblockContact: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useHubUpdateContactRemark: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useHubCreateContactGroup: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useHubWorkspaceProjects: vi.fn(() => ({ data: undefined })),
  useCreateHubWorkspaceProject: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useUpdateHubWorkspaceProject: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock('@/api/sessionQueries', () => ({
  useHubSessions: vi.fn(() => ({ data: undefined })),
  useHubMessages: vi.fn(() => ({ data: undefined })),
  useHubSendMessage: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useHubRecallMessage: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useHubEditMessage: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useHubPinMessage: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useHubUnpinMessage: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useHubMarkRead: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useHubPinnedMessages: vi.fn(() => ({ data: undefined })),
}));

vi.mock('@/stores/hubStore', () => ({
  useHubStore: vi.fn(() => ({})),
}));

vi.mock('@shared/ui/toast', () => {
  const state = {
    toasts: [],
    showToast: vi.fn(),
    dismissToast: vi.fn(),
    removeToast: vi.fn(),
  };
  return {
    useToastStore: vi.fn(
      (selector?: (s: typeof state) => unknown) =>
        typeof selector === 'function' ? selector(state) : state,
    ),
    ToastContainer: () => null,
  };
});

vi.mock('@/demo/demoEvidence', () => ({
  getDemoRuntimeEvidence: vi.fn(),
}));

const eventHandlers: EventHandler[] = [];
const createRunMutateAsync = vi.fn();
const cancelRunMutateAsync = vi.fn();
const decideEdgePermissionMutateAsync = vi.fn();
const tryAutoLogin = vi.fn().mockResolvedValue(undefined);
const refetchHealth = vi.fn();
const composerInputLabel = /^(Composer input|aria\.composerInput)$/;
const conversationSidebarLabel = /^(Conversation sidebar|aria\.conversationSidebar)$/;
const workspaceLabel = /^(Workspace|aria\.workspace)$/;
const workspaceTabsLabel = /^(Workspace tabs|aria\.workspaceTabs)$/;
const railAvatarLabel = /^(demo-user|user\.fallbackName)$/;
const sendMessageLabel = /^(发送消息|Send message|profile\.sendMessage)$/;
const overviewInspectorTabLabel = /^×(概览|Overview|inspector\.overview)$/;
const browserInspectorTabLabel = /^×(浏览器|Browser|inspector\.browser)$/;
const logoutLabel = /^(退出登录|Log out|user\.logout)$/;

function getComposerInput(): HTMLTextAreaElement {
  return screen.getByLabelText(composerInputLabel) as HTMLTextAreaElement;
}
const mockHubClient = { ackTask: vi.fn() };
const mockHubWS = {
  on: vi.fn(() => vi.fn()),
  onAny: vi.fn(() => vi.fn()),
  onStatus: vi.fn(() => vi.fn()),
  send: vi.fn(),
  sendTyping: vi.fn(),
  close: vi.fn(),
  reconnect: vi.fn(),
  connect: vi.fn(),
  getStatus: vi.fn(() => 'connected'),
  isAuthenticated: vi.fn(() => true),
};
const mockedUseThreads = vi.mocked(useThreads);
const mockedUseThreadMessages = vi.mocked(useThreadMessages);
const mockedUseCurrentUser = vi.mocked(useCurrentUser);
const mockedUseAgentProfileList = vi.mocked(useAgentProfileList);
const mockedUseCreateAgentProfile = vi.mocked(useCreateAgentProfile);
const mockedUseUpdateAgentProfile = vi.mocked(useUpdateAgentProfile);
const mockedUseDeleteAgentProfile = vi.mocked(useDeleteAgentProfile);
const mockedUseThreadPins = vi.mocked(useThreadPins);
const mockedUseAgentList = vi.mocked(useAgentList);
const mockedUseHubExecutionTargets = vi.mocked(useHubExecutionTargets);
const mockedUseSyncLocalEdgeExecutionTarget = vi.mocked(useSyncLocalEdgeExecutionTarget);
const mockedUseModelCatalog = vi.mocked(useModelCatalog);
const mockedUseRunEvidence = vi.mocked(useRunEvidence);
const mockedCreateEventStream = vi.mocked(createEventStream);
const mockedUseCreateRun = vi.mocked(useCreateRun);
const mockedUseCancelRun = vi.mocked(useCancelRun);
const mockedUseRuns = vi.mocked(useRuns);
const mockedUseDecideEdgePermission = vi.mocked(useDecideEdgePermission);
const mockedUseCreateThread = vi.mocked(useCreateThread);
const mockedCreateHubClient = vi.mocked(createHubClient);
const mockedQueryClient = vi.mocked(queryClient);
const mockedUseAuth = vi.mocked(useAuth);
const mockedUseDeviceRegistration = vi.mocked(useDeviceRegistration);
const mockedUseHealth = vi.mocked(useHealth);
const mockedUseHubEventStream = vi.mocked(useHubEventStream);
const mockedUseHubIntegration = vi.mocked(useHubIntegration);

const testQueryClient = new QueryClient();
const renderWithProviders = (ui: Parameters<typeof render>[0]) =>
  render(<QueryClientProvider client={testQueryClient}>{ui}</QueryClientProvider>);

function mockAuthSession(user: ReturnType<typeof useAuth>['user']): void {
  mockedUseAuth.mockReturnValue({
    isAuthenticated: user !== null,
    token: user ? 'hub-token' : null,
    user,
    loading: false,
    error: null,
    loginWithTokenDance: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    tryAutoLogin,
  } as ReturnType<typeof useAuth>);
}

describe('Desktop App v4 root', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testQueryClient.clear();
    window.localStorage.clear();
    // The agent activity store is a process-level singleton fed by Edge
    // events; clear it so a previous test's streaming agents cannot leak
    // into the composer running/stop-button state of the next test.
    getAgentActivityStore().reset();
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      configurable: true,
    });
    eventHandlers.length = 0;
    mockedCreateEventStream.mockReturnValue(createMockEventStream());
    mockedUseHealth.mockReturnValue({
      online: true,
      health: {
        status: 'ok',
        version: 'test',
      },
      lastError: null,
      refetch: refetchHealth,
    } as ReturnType<typeof useHealth>);
    mockAuthSession(null);
    mockedUseHubEventStream.mockReturnValue({
      hubWS: mockHubWS,
      status: 'connected',
      lastFrame: null,
      lastMessage: null,
      lastNotification: null,
      lastAgentTask: null,
      onlineUsers: [],
      sendTyping: vi.fn(),
      onFrame: vi.fn(() => vi.fn()),
      on: vi.fn(() => vi.fn()),
      reconnect: vi.fn(),
    } as ReturnType<typeof useHubEventStream>);
    mockedCreateHubClient.mockReturnValue(mockHubClient as ReturnType<typeof createHubClient>);
    mockedUseDeviceRegistration.mockReturnValue({
      deviceId: '00000000-0000-4000-8000-00000000d001',
      status: 'registered',
      error: null,
    });
    mockedUseHubIntegration.mockReturnValue({
      tasks: [],
      activeTaskCount: 0,
      getTaskByRunId: vi.fn(),
      getRunByTaskId: vi.fn(),
    });
    createRunMutateAsync.mockResolvedValue({
      runId: 'run-created',
      projectId: 'project-1',
      threadId: 'thread-real',
      status: 'queued',
      createdAt: '2026-06-07T04:00:01Z',
    });
    mockedUseCreateRun.mockReturnValue({
      mutateAsync: createRunMutateAsync,
    } as ReturnType<typeof useCreateRun>);
    cancelRunMutateAsync.mockResolvedValue({
      runId: 'run-live',
      projectId: 'project-1',
      threadId: 'thread-real',
      status: 'cancelled',
      createdAt: '2026-06-07T04:00:01Z',
    });
    mockedUseCancelRun.mockReturnValue({
      mutateAsync: cancelRunMutateAsync,
    } as ReturnType<typeof useCancelRun>);
    decideEdgePermissionMutateAsync.mockResolvedValue(undefined);
    mockedUseDecideEdgePermission.mockReturnValue({
      mutateAsync: decideEdgePermissionMutateAsync,
    } as ReturnType<typeof useDecideEdgePermission>);
    mockedUseRuns.mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useRuns>);
    mockedUseCreateThread.mockReturnValue({
      mutateAsync: vi.fn(),
    } as ReturnType<typeof useCreateThread>);
    mockedUseAgentList.mockReturnValue({
      data: { items: [], page: { hasMore: false } },
    } as ReturnType<typeof useAgentList>);
    mockedUseHubExecutionTargets.mockReturnValue({
      data: {
        items: [{
          id: 'hub-local-edge-target-1',
          device_id: '00000000-0000-4000-8000-00000000d001',
          name: 'Current Desktop Local Edge',
          target_type: 'local_edge',
          workspace_allowlist: [],
          trust_level: 'local',
          health_state: 'healthy',
          is_online: true,
        }],
        page: { hasMore: false },
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useHubExecutionTargets>);
    mockedUseSyncLocalEdgeExecutionTarget.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useSyncLocalEdgeExecutionTarget>);
    mockedUseModelCatalog.mockReturnValue({
      data: { items: [], sources: [] },
    } as ReturnType<typeof useModelCatalog>);
    mockedUseRunEvidence.mockReturnValue({
      diffs: [],
      artifacts: [],
      previews: [],
      diffLoading: false,
      artifactLoading: false,
      previewLoading: false,
      diffError: false,
      artifactError: false,
      previewError: false,
      diffSource: 'none',
      artifactSource: 'none',
      previewSource: 'none',
    });
    mockedUseThreads.mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useThreads>);
    mockedUseCurrentUser.mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useCurrentUser>);
    mockedUseThreadMessages.mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useThreadMessages>);
    mockedUseAgentProfileList.mockReturnValue({
      data: { items: [], page: { hasMore: false } },
    } as ReturnType<typeof useAgentProfileList>);
    mockedUseCreateAgentProfile.mockReturnValue({ mutateAsync: vi.fn() } as ReturnType<typeof useCreateAgentProfile>);
    mockedUseUpdateAgentProfile.mockReturnValue({ mutateAsync: vi.fn() } as ReturnType<typeof useUpdateAgentProfile>);
    mockedUseDeleteAgentProfile.mockReturnValue({ mutateAsync: vi.fn() } as ReturnType<typeof useDeleteAgentProfile>);
    mockedUseThreadPins.mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useThreadPins>);
  });

  it('shows the Desktop login card before entering the workbench', () => {
    renderWithProviders(<App />);

    expect(screen.getByRole('group', { name: 'Window controls' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最小化' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最大化' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Desktop navigation controls' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '切换左侧栏' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '后退' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '前进' })).not.toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Desktop entry' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '登录 AgentHub' })).toBeInTheDocument();
    expect(screen.getByAltText('AgentHub')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '切换主题' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '使用 TokenDance ID 继续' })).toBeInTheDocument();
    expect(screen.getByTestId('tokendance-id-logo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '使用 Demo 模式继续' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Global rail' })).not.toBeInTheDocument();
  });

  it('enters a clean Desktop demo workbench from the login card', () => {
    renderWithProviders(<App />);

    fireEvent.click(screen.getByRole('button', { name: '使用 Demo 模式继续' }));

    const desktopNavigation = screen.getByRole('group', { name: 'Desktop navigation controls' });
    expect(desktopNavigation).toBeInTheDocument();
    expect(within(desktopNavigation).getByRole('button', { name: '切换左侧栏' })).toBeInTheDocument();
    expect(within(desktopNavigation).getByRole('button', { name: '后退' })).toBeInTheDocument();
    expect(within(desktopNavigation).getByRole('button', { name: '前进' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Global rail' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: conversationSidebarLabel })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: workspaceLabel })).toHaveAttribute('data-surface', 'desktop');
    expect(screen.getByRole('complementary', { name: 'Right inspector' })).toBeInTheDocument();
    // #1821: the legacy workspace tab row was dead chrome and was removed
    // from WorkspaceHeader (both surfaces).
    expect(screen.queryByRole('tablist', { name: workspaceTabsLabel })).not.toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'aria.rightWorkspace' })).toBeInTheDocument();
    expect(getComposerInput()).toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: 'Composer modes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '@Agent' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '添加本机附件' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Approval mode')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Work directory')).not.toBeInTheDocument();
    /* P77 #1318: themed blank demo previews must not auto-open browser tab. */
    expect(screen.getByRole('tab', { name: overviewInspectorTabLabel })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: browserInspectorTabLabel })).not.toBeInTheDocument();
    expect(screen.getByRole('heading')).toBeInTheDocument();
    expect(getComposerInput()).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: '数据模式' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('@Agent')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Demo main chain status' })).not.toBeInTheDocument();

    // Demo mode writes 'mock' to localStorage
    expect(window.localStorage.getItem(WORKBENCH_DATA_MODE_STORAGE_KEY)).toBe('mock');
  });

  it('enters observed mode workbench when clicking Connect Local Edge', () => {
    renderWithProviders(<App />);

    // The "连接 Local Edge" button should be enabled since edgeOnline is true in mock
    const edgeButton = screen.getByRole('button', { name: '连接 Local Edge' });
    expect(edgeButton).toBeEnabled();

    fireEvent.click(edgeButton);

    // Should enter workbench (same shell as demo)
    expect(screen.getByRole('group', { name: 'Desktop navigation controls' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Global rail' })).toBeInTheDocument();

    // Should write 'observed' to localStorage (not 'mock')
    expect(window.localStorage.getItem(WORKBENCH_DATA_MODE_STORAGE_KEY)).toBe('observed');
  });

  it('disables Connect Local Edge when Edge is offline', () => {
    mockedUseHealth.mockReturnValue({
      online: false,
      health: null,
      lastError: 'Local Edge health check failed',
      refetch: refetchHealth,
    } as ReturnType<typeof useHealth>);

    renderWithProviders(<App />);

    const edgeButton = screen.getByRole('button', { name: 'Local Edge 未运行' });
    expect(edgeButton).toBeDisabled();
  });

  it('logs out the real Desktop session before returning to the login card', async () => {
    let authenticatedUser: { id: string; username: string } | null = {
      id: 'user-delicious233',
      username: 'demo-user',
    };
    const logout = vi.fn(async () => {
      authenticatedUser = null;
    });
    mockedUseAuth.mockImplementation(() => ({
      isAuthenticated: authenticatedUser !== null,
      token: authenticatedUser ? 'hub-token' : null,
      user: authenticatedUser,
      loading: false,
      error: null,
      loginWithTokenDance: vi.fn().mockResolvedValue(undefined),
      logout,
      tryAutoLogin,
    }) as ReturnType<typeof useAuth>);
    mockedUseCurrentUser.mockReturnValue({
      data: {
        userId: 'user-delicious233',
        displayName: 'demo-user',
        avatarUrl: '',
      },
    } as ReturnType<typeof useCurrentUser>);
    window.localStorage.setItem(WORKBENCH_DATA_MODE_STORAGE_KEY, 'approved-real');
    testQueryClient.setQueryData(['private-session'], { secret: true });

    renderWithProviders(<App />);

    fireEvent.click(screen.getByRole('button', { name: railAvatarLabel }));
    fireEvent.click(screen.getByRole('button', { name: logoutLabel }));

    await waitFor(() => {
      expect(logout).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('heading', { name: '登录 AgentHub' })).toBeInTheDocument();
    });
    expect(testQueryClient.getQueryData(['private-session'])).toBeUndefined();
    expect(window.localStorage.getItem(WORKBENCH_DATA_MODE_STORAGE_KEY)).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Global rail' })).not.toBeInTheDocument();
  });

  it('mounts the Hub task bridge on the Desktop active path when Hub auth and Local Edge are available', async () => {
    mockAuthSession({ id: 'user-delicious233', username: 'demo-user' } as ReturnType<typeof useAuth>['user']);
    window.localStorage.setItem(WORKBENCH_DATA_MODE_STORAGE_KEY, 'approved-real');
    renderWithProviders(<DesktopWorkbenchApp />);

    await waitFor(() => {
      expect(mockedUseHubIntegration).toHaveBeenCalledWith({
        hubWS: mockHubWS,
        hubClient: mockHubClient,
        edgeBaseUrl: 'http://127.0.0.1:3210',
        dispatchTarget: {
          targetId: 'hub-local-edge-target-1',
          deviceId: '00000000-0000-4000-8000-00000000d001',
        },
      });
    });
    expect(mockedUseDeviceRegistration).toHaveBeenCalledWith(mockHubClient);
    await waitFor(() => {
      expect(mockedQueryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['execution-targets'] });
    });
    expect(mockedUseHubEventStream).toHaveBeenCalledWith(getAccessToken);
    expect(mockedCreateHubClient).toHaveBeenCalledWith({ getToken: getAccessToken });
    expect(tryAutoLogin).not.toHaveBeenCalled();
  });

  it('waits for Desktop device registration before accepting Hub dispatch frames', async () => {
    mockAuthSession({ id: 'user-delicious233', username: 'demo-user' } as ReturnType<typeof useAuth>['user']);
    window.localStorage.setItem(WORKBENCH_DATA_MODE_STORAGE_KEY, 'approved-real');
    mockedUseDeviceRegistration.mockReturnValue({
      deviceId: '00000000-0000-4000-8000-00000000d001',
      status: 'registering',
      error: null,
    });

    renderWithProviders(<DesktopWorkbenchApp />);

    await waitFor(() => {
      expect(mockedUseHubIntegration).toHaveBeenCalledWith({
        hubWS: null,
        hubClient: mockHubClient,
        edgeBaseUrl: 'http://127.0.0.1:3210',
        dispatchTarget: null,
      });
    });
    expect(mockedQueryClient.invalidateQueries).not.toHaveBeenCalled();
  });

  it('uses Edge thread data when Desktop queries return conversations and items', () => {
    window.localStorage.setItem(WORKBENCH_DATA_MODE_STORAGE_KEY, 'approved-real');
    mockedUseThreads.mockReturnValue({
      data: {
        items: [
          {
            threadId: 'thread-real',
            projectId: 'project-1',
            title: '真实 Edge 会话',
            status: 'active',
            createdAt: '2026-06-07T01:00:00Z',
            updatedAt: '2026-06-07T01:00:03Z',
          },
        ],
        page: { hasMore: false },
      },
    } as ReturnType<typeof useThreads>);
    mockedUseThreadMessages.mockReturnValue({
      data: {
        items: [
          {
            itemId: 'item-user',
            projectId: 'project-1',
            threadId: 'thread-real',
            type: 'user_message',
            role: 'user',
            status: 'completed',
            content: '把 Desktop 接到真实 thread',
            createdAt: '2026-06-07T01:00:01Z',
            updatedAt: '2026-06-07T01:00:01Z',
          },
          {
            itemId: 'item-agent',
            projectId: 'project-1',
            threadId: 'thread-real',
            runId: 'run-real',
            type: 'agent_message',
            role: 'agent',
            status: 'completed',
            content: '已读取 Edge thread item。',
            createdAt: '2026-06-07T01:00:02Z',
            updatedAt: '2026-06-07T01:00:02Z',
          },
        ],
        page: { hasMore: false },
      },
    } as ReturnType<typeof useThreadMessages>);

    renderWithProviders(<DesktopWorkbenchApp />);

    expect(screen.getByRole('heading', { name: '真实 Edge 会话' })).toBeInTheDocument();
    expect(screen.getByText('把 Desktop 接到真实 thread')).toBeInTheDocument();
    expect(screen.getByText('已读取 Edge thread item。')).toBeInTheDocument();
    expect(mockedUseThreadMessages).toHaveBeenCalledWith('thread-real');
  });

  // TODO: normalizeEdgeEvents rewrite (Wave 7) changed tool_call content rendering;
  // 'rg' toolName no longer appears as standalone text — investigate label/params flow.
  it('merges live Edge events into the shared v4 transcript and evidence', async () => {
    window.localStorage.setItem(WORKBENCH_DATA_MODE_STORAGE_KEY, 'approved-real');
    mockedUseThreads.mockReturnValue({
      data: {
        items: [
          {
            threadId: 'thread-live',
            projectId: 'project-1',
            title: 'Live Edge 会话',
            status: 'active',
            createdAt: '2026-06-07T03:00:00Z',
            updatedAt: '2026-06-07T03:00:00Z',
          },
        ],
        page: { hasMore: false },
      },
    } as ReturnType<typeof useThreads>);
    mockedUseThreadMessages.mockReturnValue({
      data: {
        items: [],
        page: { hasMore: false },
      },
    } as ReturnType<typeof useThreadMessages>);

    const { rerender } = renderWithProviders(<DesktopWorkbenchApp />);

    act(() => {
      emitEdgeEvent({
        version: 'v1',
        id: 'evt-tool',
        seq: 1,
        type: 'run.agent.tool_call',
        scope: { threadId: 'thread-live', runId: 'run-live' },
        sentAt: '2026-06-07T03:00:01Z',
        payload: {
          runId: 'run-live',
          callId: 'call-rg',
          toolName: 'rg',
          status: 'running',
        },
      });
      emitEdgeEvent({
        version: 'v1',
        id: 'evt-text',
        seq: 2,
        type: 'run.agent.text_block',
        scope: { runId: 'run-live' },
        sentAt: '2026-06-07T03:00:02Z',
        payload: {
          runId: 'run-live',
          content: '持久化前的实时回答',
        },
      });
      emitEdgeEvent({
        version: 'v1',
        id: 'evt-text',
        seq: 2,
        type: 'run.agent.text_block',
        scope: { runId: 'run-live' },
        sentAt: '2026-06-07T03:00:02Z',
        payload: {
          runId: 'run-live',
          content: '持久化前的实时回答',
        },
      });
    });

    expect(screen.getByRole('heading', { name: 'Live Edge 会话' })).toBeInTheDocument();
    // Edge events flush asynchronously (rAF / 50ms batch timer), so the
    // evidence fetch is asserted with waitFor rather than synchronously.
    await waitFor(() => {
      expect(mockedUseRunEvidence).toHaveBeenLastCalledWith('run-live');
    });

    mockedUseThreadMessages.mockReturnValue({
      data: {
        items: [
          {
            itemId: 'item-agent-live',
            projectId: 'project-1',
            threadId: 'thread-live',
            runId: 'run-live',
            type: 'agent_message',
            role: 'agent',
            status: 'completed',
            content: '持久化前的实时回答',
            createdAt: '2026-06-07T03:00:03Z',
            updatedAt: '2026-06-07T03:00:03Z',
          },
        ],
        page: { hasMore: false },
      },
    } as ReturnType<typeof useThreadMessages>);
    rerender(<QueryClientProvider client={testQueryClient}><DesktopWorkbenchApp /></QueryClientProvider>);

    expect(screen.getAllByText('持久化前的实时回答')).toHaveLength(1);
    expect(mockedCreateEventStream).toHaveBeenCalledTimes(1);
  });

  it('submits composer text to the active Edge thread through the v4 platform adapter', async () => {
    window.localStorage.setItem(WORKBENCH_DATA_MODE_STORAGE_KEY, 'approved-real');
    mockedUseThreads.mockReturnValue({
      data: {
        items: [
          {
            threadId: 'thread-real',
            projectId: 'project-1',
            title: '真实 Edge 会话',
            status: 'active',
            createdAt: '2026-06-07T04:00:00Z',
            updatedAt: '2026-06-07T04:00:00Z',
          },
        ],
        page: { hasMore: false },
      },
    } as ReturnType<typeof useThreads>);
    mockedUseThreadMessages.mockReturnValue({
      data: {
        items: [],
        page: { hasMore: false },
      },
    } as ReturnType<typeof useThreadMessages>);

    renderWithProviders(<DesktopWorkbenchApp />);

    fireEvent.change(getComposerInput(), {
      target: { value: '跑一下 v4 smoke' },
    });
    fireEvent.click(screen.getByRole('button', { name: sendMessageLabel }));

    await waitFor(() => {
      expect(createRunMutateAsync).toHaveBeenCalledTimes(1);
    });

    const submittedRun = createRunMutateAsync.mock.calls[0]?.[0];
    expect(submittedRun).toEqual({
      projectId: 'project-1',
      prompt: '跑一下 v4 smoke',
      threadId: 'thread-real',
    });
    expect(getComposerInput()).toHaveValue('');
  });

  it('cancels the active Edge run through the composer stop button (#1816 W1)', async () => {
    window.localStorage.setItem(WORKBENCH_DATA_MODE_STORAGE_KEY, 'approved-real');
    mockedUseThreads.mockReturnValue({
      data: {
        items: [
          {
            threadId: 'thread-real',
            projectId: 'project-1',
            title: '真实 Edge 会话',
            status: 'active',
            createdAt: '2026-06-07T05:00:00Z',
            updatedAt: '2026-06-07T05:00:00Z',
          },
        ],
        page: { hasMore: false },
      },
    } as ReturnType<typeof useThreads>);
    mockedUseThreadMessages.mockReturnValue({
      data: { items: [], page: { hasMore: false } },
    } as ReturnType<typeof useThreadMessages>);
    mockedUseRuns.mockReturnValue({
      data: {
        items: [
          {
            runId: 'run-live',
            projectId: 'project-1',
            threadId: 'thread-real',
            status: 'started',
            createdAt: '2026-06-07T05:00:01Z',
          },
        ],
        page: { hasMore: false },
      },
    } as ReturnType<typeof useRuns>);

    renderWithProviders(<DesktopWorkbenchApp />);

    const stopButton = await screen.findByRole('button', {
      name: /^(停止运行|Stop|action\.stopRun)$/,
    });
    fireEvent.click(stopButton);

    await waitFor(() => {
      expect(cancelRunMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(cancelRunMutateAsync).toHaveBeenCalledWith('run-live');
  });

  it('routes local permission approvals to the Edge permission decide mutation (#1816 W1)', async () => {
    window.localStorage.setItem(WORKBENCH_DATA_MODE_STORAGE_KEY, 'approved-real');
    mockedUseThreads.mockReturnValue({
      data: {
        items: [
          {
            threadId: 'thread-real',
            projectId: 'project-1',
            title: '真实 Edge 会话',
            status: 'active',
            createdAt: '2026-06-07T06:00:00Z',
            updatedAt: '2026-06-07T06:00:00Z',
          },
        ],
        page: { hasMore: false },
      },
    } as ReturnType<typeof useThreads>);
    mockedUseThreadMessages.mockReturnValue({
      data: { items: [], page: { hasMore: false } },
    } as ReturnType<typeof useThreadMessages>);

    renderWithProviders(<DesktopWorkbenchApp />);
    expect(await screen.findByRole('heading', { name: '真实 Edge 会话' })).toBeInTheDocument();

    act(() => {
      emitEdgeEvent({
        version: 'v1',
        id: 'evt-permission',
        seq: 1,
        type: 'run.agent.permission_requested',
        scope: { threadId: 'thread-real', runId: 'run-live' },
        sentAt: '2026-06-07T06:00:01Z',
        payload: {
          runId: 'run-live',
          requestId: 'perm-live',
          toolName: 'shell',
          title: 'Execute shell command',
        },
      });
    });

    // The waiting approval card arrives collapsed (same as the web shell);
    // expand it (aria-label `card.expand`) to reveal the approve/deny actions.
    const approvalCard = await screen.findByRole('button', {
      name: /^(card\.expand|展开|Expand)$/,
    });
    fireEvent.click(approvalCard);

    const approveButton = await screen.findByRole('button', {
      name: /^(批准|Approve|card\.approval\.approve)$/,
    });
    fireEvent.click(approveButton);

    await waitFor(() => {
      expect(decideEdgePermissionMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(decideEdgePermissionMutateAsync).toHaveBeenCalledWith({
      runId: 'run-live',
      requestId: 'perm-live',
      decision: 'allow',
    });
  });
});

function createMockEventStream(): StreamHandle {
  return {
    subscribe(handler: EventHandler) {
      eventHandlers.push(handler);
      return () => {
        const index = eventHandlers.indexOf(handler);
        if (index >= 0) eventHandlers.splice(index, 1);
      };
    },
    onStatusChange(_handler: StatusHandler) {
      return () => {};
    },
    send: vi.fn(),
    getLatency: () => null,
    close: vi.fn(),
  };
}

function emitEdgeEvent(event: EventEnvelope): void {
  for (const handler of eventHandlers) handler(event);
}
