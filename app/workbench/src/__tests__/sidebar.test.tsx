// AgentHubWorkbench conversation sidebar: collapse/resize, titlebar toggle,
// pinned announcements, conversation switching and sorting
// (#1763 split of AgentHubWorkbench.test.tsx).
// Shared vi.mock registration + suite hooks for the #1763 AgentHubWorkbench
// test shards. Must stay the first import so mock factories register before
// the component tree (and its virtua/@lobehub/icons deps) is evaluated.
import { installWorkbenchTestHooks } from './helpers';

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockPlatform } from '@shared/platform/createMockPlatform';
import { AgentHubWorkbench } from '../AgentHubWorkbench';
import {
  workbenchAgents as agents,
  workbenchTranscript as transcript,
} from './fixtures/workbenchTestFixtures';

installWorkbenchTestHooks();

describe('AgentHubWorkbench', () => {

  it('auto-collapses the conversation sidebar when inspector resize squeezes the chat column', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct' }],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={transcript}
      />,
    );

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1024,
    });
    const shell = screen.getByTestId('agenthub-workbench');
    const resizer = screen.getByRole('separator', { name: '调整右侧栏宽度' });

    expect(shell).toHaveAttribute('data-sidebar-collapsed', 'false');

    fireEvent.pointerDown(resizer, { clientX: 240, pointerId: 1 });

    expect(shell).toHaveStyle({ '--inspector-w': '760px' });
    expect(shell).toHaveAttribute('data-sidebar-collapsed', 'true');
  });

  it('supports v4 conversation sidebar collapse and keyboard resize controls', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct' }],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={transcript}
      />,
    );

    const shell = screen.getByTestId('agenthub-workbench');
    const sidebar = screen.getByRole('complementary', { name: '会话侧边栏' });
    const resizer = screen.getByRole('separator', { name: '调整侧边栏宽度' });

    expect(shell).toHaveStyle({ '--sidebar-w': '260px' });
    expect(shell).toHaveAttribute('data-sidebar-collapsed', 'false');
    expect(sidebar).toBeInTheDocument();
    expect(resizer).toHaveAttribute('aria-valuemin', '180');
    expect(resizer).toHaveAttribute('aria-valuemax', '360');
    expect(resizer).toHaveAttribute('aria-valuenow', '260');

    fireEvent.keyDown(resizer, { key: 'ArrowRight', shiftKey: true });
    expect(shell).toHaveStyle({ '--sidebar-w': '300px' });
    expect(resizer).toHaveAttribute('aria-valuenow', '300');

    for (let index = 0; index < 4; index += 1) {
      fireEvent.keyDown(resizer, { key: 'ArrowRight', shiftKey: true });
    }
    expect(shell).toHaveStyle({ '--sidebar-w': '360px' });
    expect(resizer).toHaveAttribute('aria-valuenow', '360');

    fireEvent.click(screen.getByRole('button', { name: '会话' }));
    expect(shell).toHaveAttribute('data-sidebar-collapsed', 'false');

    for (let index = 0; index < 5; index += 1) {
      fireEvent.keyDown(resizer, { key: 'ArrowLeft', shiftKey: true });
    }
    expect(shell).toHaveStyle({ '--sidebar-w': '180px' });
    expect(shell).toHaveAttribute('data-sidebar-collapsed', 'false');

    fireEvent.keyDown(resizer, { key: 'ArrowLeft', shiftKey: true });
    expect(shell).toHaveStyle({ '--sidebar-w': '180px' });
    expect(shell).toHaveAttribute('data-sidebar-collapsed', 'true');
  });

  it('toggles the conversation sidebar from the Desktop titlebar event', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct' }],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={transcript}
      />,
    );

    const shell = screen.getByTestId('agenthub-workbench');
    expect(shell).toHaveAttribute('data-sidebar-collapsed', 'false');

    act(() => {
      window.dispatchEvent(new Event('agenthub:desktop-toggle-sidebar'));
    });

    expect(shell).toHaveAttribute('data-sidebar-collapsed', 'true');

    act(() => {
      window.dispatchEvent(new Event('agenthub:desktop-toggle-sidebar'));
    });

    expect(shell).toHaveAttribute('data-sidebar-collapsed', 'false');
  });

  it('renders pinned announcements from the active conversation only', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: false },
      conversations: [
        {
          id: 'builder',
          title: 'Builder',
          kind: 'direct',
          pinnedAnnouncement: {
            title: 'Builder',
            content: 'Builder 会话自己的置顶',
            author: 'Demo User',
            time: '14:49',
          },
        },
        { id: 'reviewer', title: 'Reviewer', kind: 'direct' },
      ],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={transcript}
      />,
    );

    expect(screen.getByText('Builder 会话自己的置顶')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Reviewer/ }));

    expect(screen.queryByText('Builder 会话自己的置顶')).not.toBeInTheDocument();
  });

  it('switches conversations from the sidebar and reports the selected id', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: true },
      conversations: [
        { id: 'builder', title: 'Builder', kind: 'direct', subtitle: 'SQLite', updatedLabel: '14:49' },
        { id: 'reviewer', title: 'Reviewer', kind: 'direct', subtitle: '代码审查', updatedLabel: '12:15', unreadCount: 2 },
      ],
    });
    const handleConversationChange = vi.fn();

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        onActiveConversationChange={handleConversationChange}
        transcript={transcript}
      />,
    );

    const reviewer = screen.getByRole('button', { name: /Reviewer/ });
    expect(within(reviewer).getByText('2')).toBeInTheDocument();
    fireEvent.click(reviewer);

    expect(handleConversationChange).toHaveBeenCalledWith('reviewer');
    expect(screen.getByRole('heading', { name: 'Reviewer' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '输入框' })).toBeInTheDocument();
  });

  it('keeps pinned conversations first and filters through the official thread list', () => {
    const platform = createMockPlatform({ surface: 'web', conversations: [
      { id: 'a', title: 'Alpha', kind: 'group' }, { id: 'b', title: 'Beta', kind: 'group', pinned: true },
    ] });
    render(<AgentHubWorkbench platform={platform} conversations={platform.seed.conversations} transcript={[]} />);
    const sidebar = screen.getByRole('complementary', { name: '会话侧边栏' });
    expect(within(sidebar).getAllByRole('button').filter((button) => ['Alpha', 'Beta'].includes(button.textContent ?? '')).map((button) => button.textContent)).toEqual(['Beta', 'Alpha']);
    fireEvent.change(within(sidebar).getByRole('searchbox'), { target: { value: 'Alpha' } });
    expect(within(sidebar).queryByRole('button', { name: 'Beta' })).not.toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: 'Alpha' })).toBeInTheDocument();
  });

  it.each(['auto', 'observed', 'approved-real'])(
    'does not mix demo tasks into the %s workbench surface',
    (dataMode) => {
      const platform = createMockPlatform({
        surface: 'web',
        conversations: [{ id: 'c1', title: 'Conversation One', kind: 'direct' }],
      });
      render(
        <AgentHubWorkbench
          activeConversationId="c1"
          agents={agents}
          platform={platform}
          conversations={platform.seed.conversations}
          transcript={transcript}
          workbenchStatus={{ dataMode }}
        />,
      );
      expect(screen.queryByText('任务队列')).not.toBeInTheDocument();
      expect(screen.queryByText('演示')).not.toBeInTheDocument();
      expect(screen.queryByText('Fixture')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: '任务' }));
      expect(screen.queryByText('分页任务 01')).not.toBeInTheDocument();
      expect(screen.queryByText('分页任务 52')).not.toBeInTheDocument();
    },
  );
});
