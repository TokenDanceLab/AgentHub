import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WorkbenchConversation } from '@shared/platform';
import { ForwardConversationPicker } from './ForwardConversationPicker';

const conversations: WorkbenchConversation[] = [
  { id: 's1', title: '产品需求讨论', kind: 'direct' },
  { id: 's2', title: 'Bug 复现', kind: 'group' },
  { id: 's3', title: '架构评审', kind: 'group' },
];

describe('ForwardConversationPicker', () => {
  it('renders a labeled multi-select listbox with the conversation options', () => {
    render(<ForwardConversationPicker conversations={conversations} onConfirm={vi.fn()} />);
    const listbox = screen.getByRole('listbox', { name: '选择转发目标会话' });
    expect(listbox).toHaveAttribute('aria-multiselectable', 'true');
    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      '产品需求讨论',
      'Bug 复现',
      '架构评审',
    ]);
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
    // Roving tabindex: only the active option is tabbable.
    expect(options[0]).toHaveAttribute('tabindex', '0');
    expect(options[1]).toHaveAttribute('tabindex', '-1');
  });

  it('toggles options on click and fires onConfirm with all selected ids', () => {
    const onConfirm = vi.fn();
    render(<ForwardConversationPicker conversations={conversations} onConfirm={onConfirm} />);
    const options = screen.getAllByRole('option');

    fireEvent.click(options[0]!);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(options[2]!);
    expect(options[2]).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('button', { name: '确认转发' }));
    expect(onConfirm).toHaveBeenCalledWith(['s1', 's3']);
  });

  it('keeps the confirm button disabled until at least one target is selected', () => {
    render(<ForwardConversationPicker conversations={conversations} onConfirm={vi.fn()} />);
    expect(screen.getByRole('button', { name: '确认转发' })).toBeDisabled();

    fireEvent.click(screen.getAllByRole('option')[1]!);
    expect(screen.getByRole('button', { name: '确认转发' })).toBeEnabled();

    // Un-selecting everything disables it again.
    fireEvent.click(screen.getAllByRole('option')[1]!);
    expect(screen.getByRole('button', { name: '确认转发' })).toBeDisabled();
  });

  it('fires onCancel when the cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<ForwardConversationPicker conversations={conversations} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('hides the cancel button when onCancel is absent', () => {
    render(<ForwardConversationPicker conversations={conversations} onConfirm={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument();
  });

  it('roves focus with arrow keys, toggles with Space and commits with Enter (listbox pattern)', () => {
    const onConfirm = vi.fn();
    render(<ForwardConversationPicker conversations={conversations} onConfirm={onConfirm} ariaLabel="forward targets" autoFocus />);
    const listbox = screen.getByRole('listbox');
    const options = screen.getAllByRole('option');
    expect(document.activeElement).toBe(options[0]);

    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(options[1]);
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(options[2]);
    fireEvent.keyDown(listbox, { key: 'ArrowDown' }); // wraps to the start
    expect(document.activeElement).toBe(options[0]);
    fireEvent.keyDown(listbox, { key: 'ArrowUp' }); // wraps to the end
    expect(document.activeElement).toBe(options[2]);

    fireEvent.keyDown(listbox, { key: ' ' });
    expect(options[2]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(listbox, { key: ' ' }); // toggle off
    expect(options[2]).toHaveAttribute('aria-selected', 'false');

    // Select two then commit with Enter.
    fireEvent.keyDown(listbox, { key: 'ArrowUp' });
    fireEvent.keyDown(listbox, { key: ' ' });
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: ' ' });
    fireEvent.keyDown(listbox, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledWith(['s2', 's3']);
  });

  it('does not commit with Enter when nothing is selected', () => {
    const onConfirm = vi.fn();
    render(<ForwardConversationPicker conversations={conversations} onConfirm={onConfirm} ariaLabel="forward targets" autoFocus />);
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('commits via the confirm button with Enter (native button activation)', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ForwardConversationPicker conversations={conversations} onConfirm={onConfirm} ariaLabel="forward targets" />);
    fireEvent.click(screen.getAllByRole('option')[0]!);
    const confirm = screen.getByRole('button', { name: '确认转发' });
    confirm.focus();
    await user.keyboard('{Enter}');
    expect(onConfirm).toHaveBeenCalledWith(['s1']);
  });

  it('leaves Escape alone (submenu hosts own close handling)', () => {
    const onConfirm = vi.fn();
    render(<ForwardConversationPicker conversations={conversations} onConfirm={onConfirm} ariaLabel="forward targets" autoFocus />);
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows the empty state and no confirm action when there are no conversations', () => {
    render(<ForwardConversationPicker conversations={[]} onConfirm={vi.fn()} emptyLabel="没有可转发的会话" />);
    expect(screen.getByRole('status')).toHaveTextContent('没有可转发的会话');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认转发' })).not.toBeInTheDocument();
  });
});
