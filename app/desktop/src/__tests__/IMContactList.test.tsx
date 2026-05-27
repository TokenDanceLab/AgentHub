import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('renders with hub contacts when provided', () => {
    const contacts = [makeContact({ id: 'c1', name: 'Alice' })];
    const hubContacts = [{ id: 'h1', name: 'Bob', type: 'user' as const, online: true }];
    render(<IMContactList contacts={contacts} hubContacts={hubContacts} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('renders with add contact callback', () => {
    const onAddContact = vi.fn(() => Promise.resolve({ ok: true, contactId: 'new-1' }));
    const contacts = [makeContact({ id: 'c1', name: 'Alice' })];
    render(<IMContactList contacts={contacts} onAddContact={onAddContact} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('renders compose form when showCompose is true', () => {
    const contacts = [makeContact({ id: 'c1', name: 'Alice' })];
    render(<IMContactList contacts={contacts} showCompose />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
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
