import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AssistantThreadList, type ConversationActions } from './AssistantThreadList';

const conversations = [
  { id: 'a', title: 'Alpha', kind: 'group' as const, canRename: true },
  { id: 'b', title: 'Beta', kind: 'direct' as const, canRename: false },
];

describe('official assistant-ui thread list', () => {
  it('switches threads, filters titles and opens the create flow', async () => {
    const onSelect = vi.fn();
    const onNew = vi.fn();
    render(<AssistantThreadList conversations={conversations} currentId="a" onSelect={onSelect} onNew={onNew} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Beta' }));
    expect(onSelect).toHaveBeenCalledWith('b');
    await user.type(screen.getByRole('searchbox'), 'Beta');
    expect(screen.queryByRole('button', { name: 'Alpha' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New Thread' }));
    expect(onNew).toHaveBeenCalledOnce();
  });

  it('renames through the backing service and shows a failed mutation', async () => {
    const actions: ConversationActions = { rename: vi.fn().mockRejectedValue(new Error('No permission')) };
    render(<AssistantThreadList conversations={conversations} currentId="a" actions={actions} />);
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: 'More options' })[0]!);
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByDisplayValue('Alpha');
    await user.clear(input);
    await user.type(input, 'New title{Enter}');
    await waitFor(() => expect(actions.rename).toHaveBeenCalledWith('a', 'New title'));
    expect(await screen.findByRole('alert')).toHaveTextContent('No permission');
    expect(screen.getByDisplayValue('New title')).toBeInTheDocument();
  });

  it('hides rename for a thread the current user cannot rename', async () => {
    render(<AssistantThreadList conversations={conversations} currentId="a" actions={{ rename: vi.fn(), delete: vi.fn() }} />);
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: 'More options' })[1]!);
    expect(within(screen.getByRole('menu')).queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('deletes through the service and can restore the last archived conversation', async () => {
    const actions: ConversationActions = { delete: vi.fn().mockResolvedValue(undefined), archive: vi.fn().mockResolvedValue(undefined) };
    const view = render(<AssistantThreadList conversations={[...conversations, { id: 'c', title: 'Archived', kind: 'group', archived: true }]} currentId="a" actions={actions} />);
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: 'More options' })[0]!);
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(actions.delete).toHaveBeenCalledWith('a'));
    await user.click(screen.getByRole('button', { name: 'Archived conversations' }));
    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Unarchive' }));
    await waitFor(() => expect(actions.archive).toHaveBeenCalledWith('c', false));
    view.rerender(<AssistantThreadList conversations={conversations} currentId="a" actions={actions} />);
    await user.click(screen.getByRole('button', { name: 'Active conversations' }));
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument();
  });
});
