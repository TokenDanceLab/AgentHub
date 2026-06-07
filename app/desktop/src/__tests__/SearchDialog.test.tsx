vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import SearchDialog from '@/components/SearchDialog';
import { useSearchStore } from '@/stores/searchStore';
import type { ChatMessage } from '@shared/types/chat';
import type { ThreadInfo } from '@shared/types';

describe('SearchDialog', () => {
  beforeEach(() => {
    useSearchStore.setState({ open: false, query: '', results: [], selectedIndex: 0 });
  });

  it('does not index hidden thinking text', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg-1',
        role: 'agent',
        timestamp: '2026-01-01T00:00:00Z',
        blocks: [
          { kind: 'thinking', content: 'hidden-secret-token' },
          { kind: 'text', content: 'visible answer' },
        ],
      },
    ];
    useSearchStore.setState({ open: true, query: 'hidden-secret-token', selectedIndex: 0 });

    render(<SearchDialog messages={messages} onSelect={vi.fn()} />);

    expect(screen.getByText('search.empty')).toBeInTheDocument();
    expect(screen.queryByText(/hidden-secret-token/)).not.toBeInTheDocument();
  });

  it('exposes dialog, searchbox, and selectable result semantics', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        timestamp: '2026-01-01T00:00:00Z',
        blocks: [{ kind: 'text', content: 'visible token alpha' }],
      },
      {
        id: 'msg-2',
        role: 'agent',
        timestamp: '2026-01-01T00:00:01Z',
        blocks: [{ kind: 'text', content: 'visible token beta' }],
      },
    ];
    const onSelect = vi.fn();
    useSearchStore.setState({ open: true, query: 'visible token', selectedIndex: 0 });

    render(<SearchDialog messages={messages} onSelect={onSelect} />);

    expect(screen.getByRole('dialog', { name: 'search.title' })).toBeInTheDocument();
    const searchbox = screen.getByRole('searchbox', { name: 'search.messages' });
    const listbox = screen.getByRole('listbox', { name: 'search.results' });
    const options = screen.getAllByRole('option');

    expect(searchbox).toHaveAttribute('aria-controls', 'search-results');
    expect(listbox).toContainElement(options[0]);
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[1]).toHaveAttribute('aria-selected', 'false');

    fireEvent.keyDown(searchbox, { key: 'ArrowDown' });

    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'false');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('selects the highlighted result with Enter and closes the dialog', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        timestamp: '2026-01-01T00:00:00Z',
        blocks: [{ kind: 'text', content: 'first visible token' }],
      },
      {
        id: 'msg-2',
        role: 'agent',
        timestamp: '2026-01-01T00:00:01Z',
        blocks: [{ kind: 'text', content: 'second visible token' }],
      },
    ];
    const onSelect = vi.fn();
    useSearchStore.setState({ open: true, query: 'visible token', selectedIndex: 1 });

    render(<SearchDialog messages={messages} onSelect={onSelect} />);

    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'search.messages' }), { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith('msg-2');
    expect(screen.queryByRole('dialog', { name: 'search.title' })).not.toBeInTheDocument();
  });

  it('opens with an initial query', () => {
    useSearchStore.getState().openDialog('Planning');

    expect(useSearchStore.getState().open).toBe(true);
    expect(useSearchStore.getState().query).toBe('Planning');
    expect(useSearchStore.getState().selectedIndex).toBe(0);
  });

  it('searches threads and selects the highlighted thread result', () => {
    const threads: ThreadInfo[] = [
      {
        threadId: 'thread-planning',
        projectId: 'proj_local',
        title: 'Planning workspace handoff',
        status: 'active',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:02Z',
      },
    ];
    const onSelectThread = vi.fn();
    useSearchStore.setState({ open: true, query: 'handoff', selectedIndex: 0 });

    render(
      <SearchDialog
        messages={[]}
        threads={threads}
        onSelect={vi.fn()}
        onSelectThread={onSelectThread}
      />,
    );

    expect(screen.getByText('Planning workspace handoff')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'search.messages' }), { key: 'Enter' });

    expect(onSelectThread).toHaveBeenCalledWith(threads[0]);
    expect(screen.queryByRole('dialog', { name: 'search.title' })).not.toBeInTheDocument();
  });
});
