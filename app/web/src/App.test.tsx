import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '@/App';

const useAgentListMock = vi.hoisted(() => vi.fn());
const useWebWorkbenchModelMock = vi.hoisted(() => vi.fn());

vi.mock('@/api/agentQueries', () => ({
  useAgentList: useAgentListMock,
}));

vi.mock('@/platform/useWebWorkbenchModel', () => ({
  useWebWorkbenchModel: useWebWorkbenchModelMock,
}));

function visibleText(container: HTMLElement) {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('style, script').forEach((node) => node.remove());
  return clone.textContent ?? '';
}

describe('Web app root', () => {
  beforeEach(() => {
    useAgentListMock.mockReturnValue({
      data: undefined,
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
});
