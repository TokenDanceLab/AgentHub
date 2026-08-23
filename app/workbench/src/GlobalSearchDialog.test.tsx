import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GlobalSearchDialog } from './GlobalSearchDialog';
import type { WorkbenchConversation } from '@shared/platform';

const conversations: WorkbenchConversation[] = [
  { id: 'c1', title: 'Auth bug triage', kind: 'direct', avatarLabel: 'A' },
  { id: 'c2', title: 'Login flow review', kind: 'group', avatarLabel: 'L' },
  { id: 'c3', title: 'Deploy pipeline', kind: 'direct', avatarLabel: 'D' },
];

describe('GlobalSearchDialog', () => {
  const onClose = vi.fn();
  const onSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <GlobalSearchDialog open={false} conversations={conversations} onClose={onClose} onSelect={onSelect} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('lists all conversations when the query is empty', () => {
    render(
      <GlobalSearchDialog open conversations={conversations} onClose={onClose} onSelect={onSelect} />,
    );
    expect(screen.getByText('Auth bug triage')).toBeInTheDocument();
    expect(screen.getByText('Deploy pipeline')).toBeInTheDocument();
  });

  it('filters conversations by title', () => {
    render(
      <GlobalSearchDialog open conversations={conversations} onClose={onClose} onSelect={onSelect} />,
    );
    fireEvent.change(screen.getByPlaceholderText('搜索或切换会话…'), { target: { value: 'login' } });
    expect(screen.getByText('Login flow review')).toBeInTheDocument();
    expect(screen.queryByText('Auth bug triage')).not.toBeInTheDocument();
  });

  it('shows the current conversation marker', () => {
    render(
      <GlobalSearchDialog
        open
        conversations={conversations}
        currentConversationId="c2"
        onClose={onClose}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByText('当前')).toBeInTheDocument();
  });

  it('#1822: ArrowDown moves the active row and Enter selects it', () => {
    render(
      <GlobalSearchDialog open conversations={conversations} onClose={onClose} onSelect={onSelect} />,
    );
    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('c2');
  });

  it('#1822: Enter selects the active row after filtering', () => {
    render(
      <GlobalSearchDialog open conversations={conversations} onClose={onClose} onSelect={onSelect} />,
    );
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'deploy' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('c3');
  });

  it('#1853 review: Enter on non-input controls does not hijack the active row', () => {
    render(
      <GlobalSearchDialog open conversations={conversations} onClose={onClose} onSelect={onSelect} />,
    );
    // Enter on a result button must activate THAT button (its own click
    // handler), not the keyboard-cursor row — the dialog-level handler only
    // listens to the search input.
    const deployRow = screen.getByRole('option', { name: /Deploy pipeline/ });
    fireEvent.keyDown(deployRow, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();

    const closeButton = screen.getByRole('button', { name: '关闭搜索' });
    fireEvent.keyDown(closeButton, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    render(
      <GlobalSearchDialog open conversations={conversations} onClose={onClose} onSelect={onSelect} />,
    );
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('selects on click', () => {
    render(
      <GlobalSearchDialog open conversations={conversations} onClose={onClose} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByText('Auth bug triage'));
    expect(onSelect).toHaveBeenCalledWith('c1');
  });

  it('caps the result list at 50 rows', () => {
    const many = Array.from({ length: 55 }, (_, i) => ({
      id: `c${i}`,
      title: `Conversation ${i}`,
      kind: 'direct' as const,
      avatarLabel: 'A',
    }));
    render(
      <GlobalSearchDialog open conversations={many} onClose={onClose} onSelect={onSelect} />,
    );
    expect(screen.getAllByText(/^Conversation \d+$/)).toHaveLength(50);
  });

  it('resets query and selection when reopened', () => {
    const { rerender } = render(
      <GlobalSearchDialog open conversations={conversations} onClose={onClose} onSelect={onSelect} />,
    );
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'deploy' } });
    expect(screen.getByText('Deploy pipeline')).toBeInTheDocument();

    rerender(
      <GlobalSearchDialog open={false} conversations={conversations} onClose={onClose} onSelect={onSelect} />,
    );
    rerender(
      <GlobalSearchDialog open conversations={conversations} onClose={onClose} onSelect={onSelect} />,
    );
    expect(screen.getByRole('combobox')).toHaveValue('');
    expect(screen.getByText('Auth bug triage')).toBeInTheDocument();
  });
});
