vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return { ...actual };
});

import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SearchDialog from '@/components/SearchDialog';
import type { ChatMessage } from '@/components/ChatView.types';
import { useSearchStore } from '@/stores/searchStore';

function makeMessage(id: string, content: string, role: ChatMessage['role'] = 'agent'): ChatMessage {
  return {
    id,
    role,
    timestamp: '2026-05-26T00:00:00.000Z',
    blocks: [{ kind: 'text', content }],
  };
}

function openSearch(query: string) {
  act(() => {
    useSearchStore.setState({ open: false, query: '', results: [], selectedIndex: 0 });
    useSearchStore.getState().openDialog();
    useSearchStore.getState().setQuery(query);
  });
}

describe('SearchDialog', () => {
  beforeEach(() => {
    useSearchStore.setState({ open: false, query: '', results: [], selectedIndex: 0 });
  });

  it('selects a matching message result', () => {
    const onSelect = vi.fn();
    render(
      <SearchDialog
        messages={[
          makeMessage('msg-1', 'Ordinary message', 'user'),
          makeMessage('msg-2', 'Find the needle in this run'),
        ]}
        onSelect={onSelect}
      />,
    );

    openSearch('needle');

    expect(screen.getByPlaceholderText('search.messagesPlaceholder')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Find the needle in this run'));

    expect(onSelect).toHaveBeenCalledWith('msg-2');
    expect(useSearchStore.getState().open).toBe(false);
  });

  it('uses Enter to select the highlighted result', () => {
    const onSelect = vi.fn();
    render(
      <SearchDialog
        messages={[
          makeMessage('msg-1', 'First match for command center'),
          makeMessage('msg-2', 'Second match for command center'),
        ]}
        onSelect={onSelect}
      />,
    );

    openSearch('command center');
    const input = screen.getByLabelText('search.messagesLabel');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith('msg-1');
    expect(useSearchStore.getState().open).toBe(false);
  });

  it('shows an i18n-backed empty state', () => {
    render(<SearchDialog messages={[makeMessage('msg-1', 'Nothing nearby')]} onSelect={vi.fn()} />);

    openSearch('absent');

    expect(screen.getByText('search.noMessages')).toBeInTheDocument();
  });

  it('keeps selection stable when arrowing through an empty result set', () => {
    render(<SearchDialog messages={[makeMessage('msg-1', 'Nothing nearby')]} onSelect={vi.fn()} />);

    openSearch('absent');
    fireEvent.keyDown(screen.getByLabelText('search.messagesLabel'), { key: 'ArrowDown' });

    expect(useSearchStore.getState().selectedIndex).toBe(0);
  });
});
