// AgentHubWorkbench conversation sidebar: collapse/resize, titlebar toggle,
// pinned announcements, conversation switching and sorting
// (#1763 split of AgentHubWorkbench.test.tsx).
// Shared vi.mock registration + suite hooks for the #1763 AgentHubWorkbench
// test shards. Must stay the first import so mock factories register before
// the component tree (and its virtua/@lobehub/icons deps) is evaluated.
import { installWorkbenchTestHooks } from './helpers';

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockPlatform } from '@shared/platform/createMockPlatform';
import { AgentHubWorkbench } from '../AgentHubWorkbench';
import {
  workbenchAgents as agents,
  workbenchTranscript as transcript,
} from '../workbenchTestFixtures';

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
    const sidebar = screen.getByRole('complementary', { name: 'Conversation sidebar' });
    const resizer = screen.getByRole('separator', { name: '调整最近频道宽度' });

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

    fireEvent.click(screen.getByRole('button', { name: '对话' }));
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
            author: 'Delicious233',
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
        { id: 'builder', title: 'Builder', kind: 'direct', subtitle: 'B0 SQLite', updatedLabel: '14:49' },
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
    expect(within(reviewer).getAllByText('12:15').length).toBeGreaterThan(0);
    expect(within(reviewer).getByText('2')).toBeInTheDocument();
    fireEvent.click(reviewer);

    expect(handleConversationChange).toHaveBeenCalledWith('reviewer');
    expect(reviewer).toHaveAttribute('aria-current', 'true');
    expect(screen.getByPlaceholderText('发消息给 Reviewer')).toBeInTheDocument();
  });

  describe('conversation sort', () => {
    afterEach(() => {
      window.localStorage.removeItem('agenthub.conversationSort');
    });

    it('renders sort dropdown with 3 options, default recent', () => {
      const platform = createMockPlatform({
        surface: 'desktop',
        conversations: [
          { id: 'a', title: 'Alpha', kind: 'direct' },
          { id: 'b', title: 'Beta', kind: 'direct' },
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
      const select = screen.getByRole('combobox', { name: '排序方式' });
      expect(select).toBeInTheDocument();
      expect(select).toHaveValue('recent');
      const options = within(select).getAllByRole('option');
      expect(options).toHaveLength(3);
      expect(options[0]).toHaveValue('recent');
      expect(options[1]).toHaveValue('name');
      expect(options[2]).toHaveValue('active');
    });

    it('sorts by name alphabetically', () => {
      const platform = createMockPlatform({
        surface: 'desktop',
        conversations: [
          { id: 'c', title: 'Charlie', kind: 'direct' },
          { id: 'a', title: 'Alpha', kind: 'direct' },
          { id: 'b', title: 'Beta', kind: 'direct' },
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
      const sidebar = screen.getByRole('complementary', { name: 'Conversation sidebar' });
      const select = within(sidebar).getByRole('combobox');
      fireEvent.change(select, { target: { value: 'name' } });
      expect(select).toHaveValue('name');

      const titles = within(sidebar).getAllByText(/^(Alpha|Beta|Charlie)$/);
      expect(titles).toHaveLength(3);
      expect(titles[0]).toHaveTextContent('Alpha');
      expect(titles[1]).toHaveTextContent('Beta');
      expect(titles[2]).toHaveTextContent('Charlie');
    });

    it('keeps pinned conversations on top regardless of sort mode', () => {
      const platform = createMockPlatform({
        surface: 'desktop',
        conversations: [
          { id: 'b', title: 'Beta', kind: 'direct', pinned: true },
          { id: 'a', title: 'Alpha', kind: 'direct' },
          { id: 'c', title: 'Charlie', kind: 'direct' },
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
      const sidebar = screen.getByRole('complementary', { name: 'Conversation sidebar' });
      const select = within(sidebar).getByRole('combobox');
      fireEvent.change(select, { target: { value: 'name' } });
      expect(select).toHaveValue('name');

      const titles = within(sidebar).getAllByText(/^(Alpha|Beta|Charlie)$/);
      // Beta is pinned, so it should be first
      expect(titles[0]).toHaveTextContent('Beta');
      expect(titles[1]).toHaveTextContent('Alpha');
      expect(titles[2]).toHaveTextContent('Charlie');
    });

    it('persists sort preference to localStorage', () => {
      const platform = createMockPlatform({
        surface: 'desktop',
        conversations: [
          { id: 'a', title: 'Alpha', kind: 'direct' },
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
      const select = screen.getByRole('combobox', { name: '排序方式' });
      fireEvent.change(select, { target: { value: 'name' } });
      expect(window.localStorage.getItem('agenthub.conversationSort')).toBe('name');
    });

    it('loads sort preference from localStorage on mount', () => {
      window.localStorage.setItem('agenthub.conversationSort', 'name');
      const platform = createMockPlatform({
        surface: 'desktop',
        conversations: [
          { id: 'a', title: 'Alpha', kind: 'direct' },
          { id: 'b', title: 'Beta', kind: 'direct' },
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
      const select = screen.getByRole('combobox', { name: '排序方式' });
      expect(select).toHaveValue('name');
    });

    it('sorts by active (unread count descending)', () => {
      const platform = createMockPlatform({
        surface: 'desktop',
        conversations: [
          { id: 'a', title: 'Alpha', kind: 'direct', unreadCount: 1 },
          { id: 'b', title: 'Beta', kind: 'direct', unreadCount: 5 },
          { id: 'c', title: 'Charlie', kind: 'direct' },
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
      const sidebar = screen.getByRole('complementary', { name: 'Conversation sidebar' });
      const select = within(sidebar).getByRole('combobox');
      fireEvent.change(select, { target: { value: 'active' } });
      expect(select).toHaveValue('active');

      const titles = within(sidebar).getAllByText(/^(Alpha|Beta|Charlie)$/);
      // Beta has 5 unread, Alpha has 1, Charlie has 0
      expect(titles[0]).toHaveTextContent('Beta');
      expect(titles[1]).toHaveTextContent('Alpha');
      expect(titles[2]).toHaveTextContent('Charlie');
    });
  });
});
