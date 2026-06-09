import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '@/App';
import { useHubStore } from '@/stores/hubStore';

const useAgentListMock = vi.hoisted(() => vi.fn());
const useCreateAgentProfileMock = vi.hoisted(() => vi.fn());
const useUpdateAgentProfileMock = vi.hoisted(() => vi.fn());
const useDeleteAgentProfileMock = vi.hoisted(() => vi.fn());
const useWebWorkbenchModelMock = vi.hoisted(() => vi.fn());
const useWebAuthMock = vi.hoisted(() => vi.fn());
const ensureAuthMock = vi.hoisted(() => vi.fn());
const authPageSuccessUser = vi.hoisted(() => ({
  id: '00000000-0000-0000-0000-00000000b201',
  username: 'web-auth-user',
  nickname: 'Web Auth User',
  avatar_url: '',
}));
const capturedPlatformRef = vi.hoisted((): {
  current: {
    runs: {
      submitComposerIntent: (intent: {
        conversationId: string;
        text: string;
        mode: 'ask';
        mentions: unknown[];
        attachments: unknown[];
        approvalMode: 'suggest';
      }) => Promise<unknown>;
    };
  } | null;
} => ({ current: null }));

type CapturedPlatform = {
  runs: {
    submitComposerIntent: (intent: {
      conversationId: string;
      text: string;
      mode: 'ask';
      mentions: unknown[];
      attachments: unknown[];
      approvalMode: 'suggest';
    }) => Promise<unknown>;
  };
};

vi.mock('@shared/workbench', () => ({
  AgentHubWorkbench: (props: {
    activeConversationId?: string;
    conversations?: Array<{ id: string; title: string }>;
    platform?: CapturedPlatform;
    transcript?: Array<{ text?: string }>;
  }) => {
    const activeConversation =
      props.conversations?.find((conversation) => conversation.id === props.activeConversationId) ??
      props.conversations?.[0];
    capturedPlatformRef.current = props.platform ?? null;

    return (
      <>
        <nav aria-label="Global rail" />
        <main aria-label="Workspace" data-surface="web">
          <div role="tablist" aria-label="Workspace tabs" />
          <div role="tablist" aria-label="右侧工作区" />
          <h1>{activeConversation?.title ?? 'AgentHub'}</h1>
          <input placeholder={`发消息给 ${activeConversation?.title ?? 'AgentHub'}`} />
          <button
            type="button"
            onClick={() => {
              void props.platform?.runs.submitComposerIntent({
                conversationId: activeConversation?.id ?? 'agent-collab',
                text: '需要真实 Hub 会话',
                mode: 'ask',
                mentions: [],
                attachments: [],
                approvalMode: 'suggest',
              }).catch(() => {});
            }}
          >
            Submit Hub work
          </button>
          {props.transcript?.map((block, index) => (
            <p key={index}>{block.text}</p>
          ))}
        </main>
      </>
    );
  },
}));

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

describe('Web app root', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    capturedPlatformRef.current = null;
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
    expect(screen.getByRole('main', { name: 'Workspace' })).toHaveAttribute('data-surface', 'web');
    expect(screen.queryByRole('group', { name: 'Window controls' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '最小化' })).not.toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Workspace tabs' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: '右侧工作区' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Agent 协作群' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('发消息给 Agent 协作群')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '@Agent' })).not.toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: 'Composer modes' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Approval mode')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Work directory')).not.toBeInTheDocument();
    expect(text).not.toMatch(/shell\.(?:brand|toolbar|status|sidebar|statusPanel|workspace|page|source)/);
    expect(text).not.toMatch(/synced|marketplace connected|session active/i);
    expect(useAgentListMock).toHaveBeenCalledWith(true);
    expect(useWebWorkbenchModelMock).toHaveBeenCalledTimes(1);
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

  it('keeps Hub Agent Profiles inside the adapter model instead of adding first-screen composer controls', () => {
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
    });

    render(<App />);

    expect(useAgentListMock).toHaveBeenCalledWith(true);
    expect(screen.getByRole('heading', { name: 'Agent 协作群' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '@Agent' })).not.toBeInTheDocument();
    expect(screen.queryByText('@Hub Builder')).not.toBeInTheDocument();
  });

  it('mounts Web auth bootstrap and renders the TokenDance ID auth modal from Hub state', async () => {
    render(<App />);

    expect(useWebAuthMock).toHaveBeenCalledTimes(1);
    expect(capturedPlatformRef.current).not.toBeNull();
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

  it('opens auth instead of silently using mock data for guarded unauthenticated Hub work', async () => {
    ensureAuthMock.mockImplementation(() => {
      useHubStore.getState().setShowAuthModal(true);
      return false;
    });

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Submit Hub work' }));

    await waitFor(() => {
      expect(ensureAuthMock).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('dialog', { name: 'TokenDance ID login' })).toBeInTheDocument();
    });
  });
});
