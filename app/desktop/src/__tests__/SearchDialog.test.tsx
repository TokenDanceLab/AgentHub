import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import SearchDialog from '@/components/SearchDialog';
import type { ChatMessage } from '@/components/ChatView.types';
import { useSearchStore } from '@/stores/searchStore';

const translations: Record<string, string> = {
  'search.title': 'Search messages',
  'search.inputLabel': 'Message search input',
  'search.placeholder': 'Search messages...',
  'search.results': 'Message search results',
  'search.resultLabel': '{{role}}: {{snippet}}',
  'search.role.user': 'User',
  'search.role.agent': 'Agent',
  'search.role.system': 'System',
  'search.empty': 'No messages found',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      let text = translations[key] ?? key;
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.replace(`{{${name}}}`, String(value));
        }
      }
      return text;
    },
    i18n: { language: 'en' },
  }),
}));

function message(id: string, role: ChatMessage['role'], content: string): ChatMessage {
  return {
    id,
    role,
    timestamp: '2026-05-26T08:00:00.000Z',
    blocks: [{ kind: 'text', content }],
  };
}

function openSearch(query: string, selectedIndex = 0) {
  useSearchStore.getState().openDialog();
  useSearchStore.getState().setQuery(query);
  useSearchStore.getState().setSelectedIndex(selectedIndex);
}

describe('SearchDialog', () => {
  beforeEach(() => {
    useSearchStore.setState({
      open: false,
      query: '',
      results: [],
      selectedIndex: 0,
    });
  });

  it('renders translated dialog labels and search results without raw keys', () => {
    openSearch('searchable');
    render(
      <SearchDialog
        messages={[message('msg-1', 'user', 'A searchable user request')]}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Search messages' })).toBeInTheDocument();
    expect(screen.getByLabelText('Message search input')).toHaveAttribute(
      'placeholder',
      'Search messages...',
    );
    expect(screen.getByRole('list', { name: 'Message search results' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'User: A searchable user request' })).toBeInTheDocument();
    expect(screen.queryByText(/^search\./)).not.toBeInTheDocument();
  });

  it('selects a result through the result button and closes the dialog', () => {
    const onSelect = vi.fn();
    openSearch('target');
    render(
      <SearchDialog
        messages={[
          message('msg-user', 'user', 'A user prompt'),
          message('msg-agent', 'agent', 'Target response from agent'),
        ]}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Agent: Target response from agent' }));

    expect(onSelect).toHaveBeenCalledWith('msg-agent');
    expect(screen.queryByRole('dialog', { name: 'Search messages' })).not.toBeInTheDocument();
  });

  it('selects the highlighted result with Enter', () => {
    const onSelect = vi.fn();
    openSearch('target', 1);
    render(
      <SearchDialog
        messages={[
          message('msg-user', 'user', 'Target user prompt'),
          message('msg-agent', 'agent', 'Target response from agent'),
        ]}
        onSelect={onSelect}
      />,
    );

    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Search messages' }), {
      key: 'Enter',
    });

    expect(onSelect).toHaveBeenCalledWith('msg-agent');
    expect(screen.queryByRole('dialog', { name: 'Search messages' })).not.toBeInTheDocument();
  });

  it('shows a translated empty state when no messages match', () => {
    openSearch('needle');
    render(
      <SearchDialog
        messages={[message('msg-1', 'system', 'Different content')]}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText('No messages found')).toBeInTheDocument();
    expect(screen.queryByText('search.empty')).not.toBeInTheDocument();
  });
});
