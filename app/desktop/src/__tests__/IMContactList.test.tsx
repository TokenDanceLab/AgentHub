import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { IMContactList } from '@/components/IM';
import type { IMContact } from '@/components/IM';

function makeContact(overrides: Partial<IMContact> = {}): IMContact {
  return {
    id: 'c-1',
    name: 'Alice',
    type: 'user',
    online: true,
    ...overrides,
  };
}

describe('IMContactList', () => {
  it('renders contact items', () => {
    const contacts = [
      makeContact({ id: 'c1', name: 'Alice', type: 'user', online: true }),
      makeContact({ id: 'c2', name: 'Claude', type: 'agent', online: false }),
    ];
    render(<IMContactList contacts={contacts} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Claude')).toBeInTheDocument();
    expect(screen.getByText('user')).toBeInTheDocument();
    expect(screen.getByText('agent')).toBeInTheDocument();
  });

  it('shows empty state when no contacts', () => {
    render(<IMContactList contacts={[]} />);
    expect(screen.getByText('No contacts yet')).toBeInTheDocument();
  });

  it('filters contacts by search', () => {
    const contacts = [
      makeContact({ id: 'c1', name: 'Alice' }),
      makeContact({ id: 'c2', name: 'Bob' }),
    ];
    render(<IMContactList contacts={contacts} />);
    const searchInput = screen.getByPlaceholderText('Search contacts...');
    fireEvent.change(searchInput, { target: { value: 'Ali' } });
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Bob')).toBeNull();
  });

  it('shows "no matches" when search has no results', () => {
    const contacts = [makeContact({ id: 'c1', name: 'Alice' })];
    render(<IMContactList contacts={contacts} />);
    fireEvent.change(screen.getByPlaceholderText('Search contacts...'), {
      target: { value: 'xyz' },
    });
    expect(screen.getByText('No contacts match your search')).toBeInTheDocument();
  });

  it('calls onSelect when contact clicked', () => {
    const onSelect = vi.fn();
    const contacts = [makeContact({ id: 'c1', name: 'Alice' })];
    render(<IMContactList contacts={contacts} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Alice'));
    expect(onSelect).toHaveBeenCalledWith(contacts[0]);
  });

  it('shows online indicator for online contacts', () => {
    const contacts = [
      makeContact({ id: 'c1', name: 'Online', online: true }),
      makeContact({ id: 'c2', name: 'Offline', online: false }),
    ];
    render(<IMContactList contacts={contacts} />);
    expect(screen.getByLabelText('Online')).toBeInTheDocument();
    expect(screen.getByLabelText('Offline')).toBeInTheDocument();
  });

  it('does not expose compose actions without Hub handlers', () => {
    render(<IMContactList contacts={[]} />);
    expect(screen.queryByRole('button', { name: 'Open Hub compose' })).not.toBeInTheDocument();
  });

  it('shows Hub contact form when compose is opened', () => {
    render(<IMContactList contacts={[]} onAddContact={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Hub compose' }));
    expect(screen.getByLabelText('Hub user ID')).toBeInTheDocument();
    expect(screen.getByText('Add')).toBeInTheDocument();
  });

  it('calls onAddContact with Hub user id when add confirmed', async () => {
    const onAddContact = vi.fn(async () => true);
    render(<IMContactList contacts={[]} onAddContact={onAddContact} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Hub compose' }));
    fireEvent.change(screen.getByLabelText('Hub user ID'), {
      target: { value: 'user-2' },
    });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(onAddContact).toHaveBeenCalledWith('user-2'));
  });

  it('calls onAddContact on Enter in Hub user id input', async () => {
    const onAddContact = vi.fn(async () => true);
    render(<IMContactList contacts={[]} onAddContact={onAddContact} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Hub compose' }));
    const input = screen.getByLabelText('Hub user ID');
    fireEvent.change(input, { target: { value: 'user-entered' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onAddContact).toHaveBeenCalledWith('user-entered'));
  });

  it('hides add form on Escape', () => {
    render(<IMContactList contacts={[]} onAddContact={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Hub compose' }));
    const input = screen.getByLabelText('Hub user ID');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByLabelText('Hub user ID')).toBeNull();
  });

  it('creates private session from an existing Hub contact', async () => {
    const onCreatePrivateSession = vi.fn(async () => true);
    render(
      <IMContactList
        contacts={[]}
        hubContacts={[{ user_id: 'friend-1', username: 'alice', nickname: 'Alice', online: true, type: 'friend' }]}
        onCreatePrivateSession={onCreatePrivateSession}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open Hub compose' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create direct chat' }));
    fireEvent.change(screen.getByLabelText('Hub contact'), { target: { value: 'friend-1' } });
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() => expect(onCreatePrivateSession).toHaveBeenCalledWith('friend-1'));
  });

  it('creates group session from checked Hub contacts', async () => {
    const onCreateGroupSession = vi.fn(async () => true);
    render(
      <IMContactList
        contacts={[]}
        hubContacts={[
          { user_id: 'friend-1', username: 'alice', nickname: 'Alice', online: true, type: 'friend' },
          { user_id: 'friend-2', username: 'bob', nickname: 'Bob', online: true, type: 'friend' },
        ]}
        onCreateGroupSession={onCreateGroupSession}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open Hub compose' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create group chat' }));
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Build Room' } });
    fireEvent.click(screen.getByLabelText('Alice'));
    fireEvent.click(screen.getByLabelText('Bob'));
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() =>
      expect(onCreateGroupSession).toHaveBeenCalledWith('Build Room', ['friend-1', 'friend-2']),
    );
  });

  it('highlights selected contact', () => {
    const contacts = [makeContact({ id: 'c1', name: 'Alice' })];
    render(<IMContactList contacts={contacts} selectedId="c1" />);
    expect(screen.getByRole('option', { name: /Alice/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('displays authority in contact meta', () => {
    const contacts = [makeContact({ id: 'c1', name: 'EdgeAgent', type: 'agent', authority: 'edge' })];
    render(<IMContactList contacts={contacts} />);
    expect(screen.getByText(/edge/)).toBeInTheDocument();
  });
});
