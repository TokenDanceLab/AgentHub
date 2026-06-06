import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '@/App';

const useAgentListMock = vi.hoisted(() => vi.fn());

vi.mock('@/api/agentQueries', () => ({
  useAgentList: useAgentListMock,
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
    expect(screen.getByRole('tablist', { name: 'Workspace tabs' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Inspector tabs' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Agent 协作群' })).toBeInTheDocument();
    expect(text).not.toMatch(/shell\.(?:brand|toolbar|status|sidebar|statusPanel|workspace|page|source)/);
    expect(text).not.toMatch(/synced|marketplace connected|session active/i);
    expect(useAgentListMock).toHaveBeenCalledWith(true);
  });

  it('uses Hub Agent Profiles for the shared @Agent menu when available', () => {
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

    fireEvent.click(screen.getByRole('button', { name: '@Agent' }));

    expect(screen.getByRole('menuitemcheckbox', { name: /@Hub Builder/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitemcheckbox', { name: /@Builder/ })).not.toBeInTheDocument();
  });
});
