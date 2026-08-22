import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '@/App';
import { queryClient } from '@/api/queryClient';
import { useHubStore } from '@/stores/hubStore';

/**
 * These tests render the REAL shared v4 workbench (`@agenthub/workbench`).
 * Only the data/network layer below App is mocked — Hub queries, the web
 * workbench projection hook, web auth, and the auth modal.
 *
 * Previously this file replaced `@agenthub/workbench` with a ~50-line hand-written
 * stub and then asserted against the DOM that stub itself rendered, which made
 * every assertion vacuously true against the real shell. Keep the mock surface
 * at the data layer; do not stub the workbench.
 */

const useAgentListMock = vi.hoisted(() => vi.fn());
const useCreateAgentProfileMock = vi.hoisted(() => vi.fn());
const useUpdateAgentProfileMock = vi.hoisted(() => vi.fn());
const useDeleteAgentProfileMock = vi.hoisted(() => vi.fn());
const useWebWorkbenchModelMock = vi.hoisted(() => vi.fn());
const useWebAuthMock = vi.hoisted(() => vi.fn());
const ensureAuthMock = vi.hoisted(() => vi.fn());
const logoutMock = vi.hoisted(() => vi.fn(async () => undefined));
const getAccessTokenMock = vi.hoisted(() => vi.fn<() => string | null>(() => null));
const hubClientStub = vi.hoisted(() => ({
  me: vi.fn(async () => ({ id: 'web-user', username: 'web-user', nickname: 'Web User', avatar_url: '' })),
  listPublicSkills: vi.fn(async () => ({ items: [] })),
  listPublicMCPServers: vi.fn(async () => ({ items: [] })),
  createPrivateSession: vi.fn(async () => ({ session_id: 'session-1' })),
  regenerateAgentTask: vi.fn(async () => undefined),
}));
const authPageSuccessUser = vi.hoisted(() => ({
  id: '00000000-0000-0000-0000-00000000b201',
  username: 'web-auth-user',
  nickname: 'Web Auth User',
  avatar_url: '',
}));

// Real i18n is not bootstrapped in unit tests, so react-i18next echoes the key.
// Accept the translated label or the raw key, same as the Desktop App test.
const workspaceLabel = /^(Workspace|aria\.workspace)$/;
const workspaceTabsLabel = /^(Workspace tabs|aria\.workspaceTabs)$/;
const conversationSidebarLabel = /^(Conversation sidebar|aria\.conversationSidebar)$/;
const composerInputLabel = /^(Composer input|aria\.composerInput)$/;
const sendMessageLabel = /^(发送消息|Send message|profile\.sendMessage)$/;
const atAgentLabel = /^(@Agent|aria\.atAgent)$/;

vi.mock('@/api/agentQueries', () => ({
  useAgentList: useAgentListMock,
  useCreateAgentProfile: useCreateAgentProfileMock,
  useUpdateAgentProfile: useUpdateAgentProfileMock,
  useDeleteAgentProfile: useDeleteAgentProfileMock,
}));

vi.mock('@/platform/useWebWorkbenchModel', () => ({
  useWebWorkbenchModel: useWebWorkbenchModelMock,
}));

vi.mock('@/hooks/useWebAuth', () => ({
  useWebAuth: useWebAuthMock,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ logout: logoutMock }),
  getAccessToken: getAccessTokenMock,
}));

vi.mock('@/api/hubClient', () => ({
  createHubClient: vi.fn(() => hubClientStub),
}));

vi.mock('@/components/AuthPage', () => ({
  default: ({ onClose, onLoginSuccess }: {
    onClose?: () => void;
    onLoginSuccess: (user: typeof authPageSuccessUser) => void;
  }) => (
    <section role="dialog" aria-label="TokenDance ID login">
      <button type="button" onClick={onClose}>Close auth</button>
      <button type="button" onClick={() => onLoginSuccess(authPageSuccessUser)}>Complete auth</button>
    </section>
  ),
}));

function visibleText(container: HTMLElement) {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('style, script').forEach((node) => node.remove());
  return clone.textContent ?? '';
}

function getComposerInput(): HTMLTextAreaElement {
  return screen.getByLabelText(composerInputLabel) as HTMLTextAreaElement;
}

describe('Web app root', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    queryClient.clear();
    getAccessTokenMock.mockReturnValue(null);
    ensureAuthMock.mockReturnValue(true);
    useWebAuthMock.mockReturnValue({ ensureAuth: ensureAuthMock });
    useHubStore.getState().clear();
    useAgentListMock.mockReturnValue({
      data: undefined,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    useCreateAgentProfileMock.mockReturnValue({
      mutateAsync: vi.fn(),
    });
    useUpdateAgentProfileMock.mockReturnValue({
      mutateAsync: vi.fn(),
    });
    useDeleteAgentProfileMock.mockReturnValue({
      mutateAsync: vi.fn(),
    });
    useWebWorkbenchModelMock.mockReturnValue({
      activeConversationId: 'agent-collab',
      conversations: [
        { id: 'agent-collab', title: 'Agent 协作群', kind: 'group', subtitle: '共享 v4 Web 工作台' },
        { id: 'builder', title: 'Builder', kind: 'direct', subtitle: 'Claude Code' },
      ],
      transcript: [
        {
          id: 'web-msg-1',
          kind: 'text',
          author: { id: 'system', name: 'AgentHub', role: 'system' },
          text: 'Web 已接入 shared v4 workbench。',
        },
      ],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('mounts the shared v4 workbench shell without legacy demo chrome', () => {
    const { container } = render(<App />);
    const text = visibleText(container);

    expect(screen.getByRole('navigation', { name: 'Global rail' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: conversationSidebarLabel })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: workspaceLabel })).toHaveAttribute('data-surface', 'web');
    expect(screen.queryByRole('group', { name: 'Window controls' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Desktop navigation controls' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '最小化' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '切换左侧栏' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '后退' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '前进' })).not.toBeInTheDocument();
    // #1821: the legacy workspace tab row (消息/云文档/新建频道) was dead
    // chrome (no onClick) and has been removed from WorkspaceHeader.
    expect(screen.queryByRole('tablist', { name: workspaceTabsLabel })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Agent 协作群' })).toBeInTheDocument();
    expect(getComposerInput()).toBeInTheDocument();
    // showComposerAgentPicker / showMainchainStatus={false} prop gating, on the real shell.
    // The real picker is a <select> (combobox), not the <button> the old stub invented.
    expect(screen.getByRole('combobox', { name: atAgentLabel })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Demo main chain status' })).not.toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: 'Composer modes' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Approval mode')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Work directory')).not.toBeInTheDocument();
    expect(text).not.toMatch(/shell\.(?:brand|toolbar|status|sidebar|statusPanel|workspace|page|source)/);
    expect(text).not.toMatch(/synced|marketplace connected|session active/i);
    expect(useAgentListMock).toHaveBeenCalledWith(true);
    expect(useWebWorkbenchModelMock).toHaveBeenCalled();
  });

  it('renders Hub sessions and messages projected into the shared workbench', () => {
    useWebWorkbenchModelMock.mockReturnValue({
      activeConversationId: 'hub-session-1',
      conversations: [
        { id: 'hub-session-1', title: '真实 Hub 会话', kind: 'group', subtitle: 'Hub group' },
      ],
      transcript: [
        {
          id: 'hub-message-1',
          kind: 'text',
          author: { id: 'hub-user', name: '用户', role: 'human' },
          text: '来自 Hub session 的真实消息',
        },
      ],
    });

    render(<App />);

    expect(screen.getByRole('heading', { name: '真实 Hub 会话' })).toBeInTheDocument();
    expect(screen.getByText('来自 Hub session 的真实消息')).toBeInTheDocument();
  });

  // #1821: text bubbles carry the same selectable/context-menu identity as
  // tool rows (`data-selectable-card`), so the context menu can reach the
  // Hub message actions — and a failed pin must surface an error toast
  // instead of being swallowed by `.catch(() => {})`.
  it('surfaces an error toast when pinning a Hub message fails', async () => {
    const onPinMessage = vi.fn().mockRejectedValue(new Error('pin failed'));
    useWebWorkbenchModelMock.mockReturnValue({
      activeConversationId: 'hub-session-1',
      conversations: [
        { id: 'hub-session-1', title: '真实 Hub 会话', kind: 'group', subtitle: 'Hub group' },
      ],
      transcript: [
        {
          id: 'hub-message-1',
          kind: 'text',
          author: { id: 'hub-user', name: '用户', role: 'human' },
          text: '来自 Hub session 的真实消息',
        },
      ],
      chatActions: { onPinMessage },
    });

    const { container } = render(<App />);

    const card = container.querySelector('[data-selectable-card="hub-message-1"]');
    expect(card).not.toBeNull();
    fireEvent.contextMenu(card!);

    const pinItem = await screen.findByRole('menuitem', { name: 'context.pinMessage' });
    fireEvent.click(pinItem);

    expect(onPinMessage).toHaveBeenCalledWith('1', 'hub-session-1');
    // The workbench toast surfaces the rejection reason (role=status chrome
    // toast), not the optimistic success copy.
    await screen.findByText('pin failed');
  });

  // #1821: a failed regenerate must keep the message visible and surface an
  // error toast — no silent swallow, no fake "regenerating" empty state.
  it('surfaces an error toast when the regenerate request fails', async () => {
    hubClientStub.regenerateAgentTask.mockRejectedValueOnce(new Error('regenerate failed'));
    useWebWorkbenchModelMock.mockReturnValue({
      activeConversationId: 'hub-session-1',
      conversations: [
        { id: 'hub-session-1', title: '真实 Hub 会话', kind: 'group', subtitle: 'Hub group' },
      ],
      transcript: [
        {
          id: 'hub-message-1',
          kind: 'text',
          author: { id: 'hub-agent', name: 'Builder', role: 'agent' },
          text: 'Agent 的回复内容',
        },
      ],
    });

    const { container } = render(<App />);

    const card = container.querySelector('[data-selectable-card="hub-message-1"]');
    expect(card).not.toBeNull();
    fireEvent.contextMenu(card!);

    const regenerateItem = await screen.findByRole('menuitem', { name: 'context.regenerate' });
    fireEvent.click(regenerateItem);

    await screen.findByText('regenerate failed');
    // The failed regenerate must not hide the original message.
    expect(screen.getByText('Agent 的回复内容')).toBeInTheDocument();
  });

  it('keeps Hub Agent Profiles available to the shared composer without legacy demo controls', () => {
    useAgentListMock.mockReturnValue({
      data: {
        items: [
          {
            id: 'agent-profile-hub-builder',
            name: 'Hub Builder',
            description: 'Runtime: claude-code - Model: glm-5.1',
            profileId: 'agent-profile-hub-builder',
            runtimeId: 'claude-code',
            model: 'glm-5.1',
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
        ],
        page: { hasMore: false },
      },
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<App />);

    expect(useAgentListMock).toHaveBeenCalledWith(true);
    expect(screen.getByRole('heading', { name: 'Agent 协作群' })).toBeInTheDocument();
    // The Hub profile reaches the real composer's agent picker as a selectable
    // option, and is not silently pre-mentioned into the composer text.
    const agentPicker = screen.getByRole('combobox', { name: atAgentLabel });
    expect(agentPicker).toBeEnabled();
    expect(screen.getByRole('option', { name: /Hub Builder/ })).toBeInTheDocument();
    expect(getComposerInput()).toHaveValue('');
    expect(screen.queryByText('@Hub Builder')).not.toBeInTheDocument();
  });

  it('mounts Web auth bootstrap and renders the TokenDance ID auth modal from Hub state', async () => {
    render(<App />);

    expect(useWebAuthMock).toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'TokenDance ID login' })).not.toBeInTheDocument();

    act(() => {
      useHubStore.getState().setShowAuthModal(true);
    });

    expect(await screen.findByRole('dialog', { name: 'TokenDance ID login' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Complete auth' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'TokenDance ID login' })).not.toBeInTheDocument();
    });
  });

  it('logs out the Web session, clears private queries, and opens the auth surface', async () => {
    getAccessTokenMock.mockReturnValue('web-token');
    logoutMock.mockImplementationOnce(async () => {
      getAccessTokenMock.mockReturnValue(null);
      useHubStore.getState().clear();
    });
    useHubStore.getState().setAuthenticated(true, 'web-user', 'Web User');
    queryClient.setQueryData(['private-session'], { secret: true });

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /^(Web User|user\.fallbackName)$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^(退出登录|Log out|user\.logout)$/ }));

    await waitFor(() => {
      expect(logoutMock).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('dialog', { name: 'TokenDance ID login' })).toBeInTheDocument();
    });
    expect(queryClient.getQueryData(['private-session'])).toBeUndefined();
    expect(useHubStore.getState().authenticated).toBe(false);
  });

  it('opens auth instead of silently using mock data for guarded unauthenticated Hub work', async () => {
    ensureAuthMock.mockImplementation(() => {
      useHubStore.getState().setShowAuthModal(true);
      return false;
    });

    render(<App />);

    // Drive the real composer, so the auth gate is exercised through the real
    // shared shell → web platform adapter path rather than a stub button.
    fireEvent.change(getComposerInput(), { target: { value: '需要真实 Hub 会话' } });
    fireEvent.click(screen.getByRole('button', { name: sendMessageLabel }));

    await waitFor(() => {
      expect(ensureAuthMock).toHaveBeenCalled();
      expect(screen.getByRole('dialog', { name: 'TokenDance ID login' })).toBeInTheDocument();
    });
  });
});
