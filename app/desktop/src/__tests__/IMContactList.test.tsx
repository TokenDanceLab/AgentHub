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

  it('shows add contact form when + button clicked', () => {
    render(<IMContactList contacts={[]} />);
    fireEvent.click(screen.getByLabelText('Add contact'));
    expect(screen.getByPlaceholderText('Contact name...')).toBeInTheDocument();
    expect(screen.getByText('Add')).toBeInTheDocument();
  });

  it('calls onAdd with name when add confirmed', () => {
    const onAdd = vi.fn();
    render(<IMContactList contacts={[]} onAdd={onAdd} />);
    fireEvent.click(screen.getByLabelText('Add contact'));
    fireEvent.change(screen.getByPlaceholderText('Contact name...'), {
      target: { value: 'NewContact' },
    });
    fireEvent.click(screen.getByText('Add'));
    expect(onAdd).toHaveBeenCalledWith('NewContact');
  });

  it('calls onAdd on Enter in add input', () => {
    const onAdd = vi.fn();
    render(<IMContactList contacts={[]} onAdd={onAdd} />);
    fireEvent.click(screen.getByLabelText('Add contact'));
    const input = screen.getByPlaceholderText('Contact name...');
    fireEvent.change(input, { target: { value: 'Entered' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAdd).toHaveBeenCalledWith('Entered');
  });

  it('hides add form on Escape', () => {
    render(<IMContactList contacts={[]} />);
    fireEvent.click(screen.getByLabelText('Add contact'));
    const input = screen.getByPlaceholderText('Contact name...');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByPlaceholderText('Contact name...')).toBeNull();
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
