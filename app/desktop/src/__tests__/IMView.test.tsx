import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import IMView from '@/views/IMView';

// jsdom does not implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

// Mock useIMChat
vi.mock('@/hooks/useIMChat', () => ({
  useIMChat: vi.fn(() => ({
    messages: new Map(),
    contacts: [
      { id: 'c1', name: 'Alice', type: 'user' as const, online: true },
      { id: 'c2', name: 'Bob', type: 'user' as const, online: false },
    ],
    sendMessage: vi.fn(),
    getSessionMessages: vi.fn(() => []),
    upsertContact: vi.fn(),
    removeContact: vi.fn(),
    searchContacts: vi.fn((q: string) =>
      q
        ? [{ id: 'c1', name: 'Alice', type: 'user' as const, online: true }]
        : [
            { id: 'c1', name: 'Alice', type: 'user' as const, online: true },
            { id: 'c2', name: 'Bob', type: 'user' as const, online: false },
          ],
    ),
  })),
}));

// Mock useHubStore
vi.mock('@/stores/hubStore', () => ({
  useHubStore: vi.fn((selector?: (s: { authenticated: boolean; userId: string | null; username: string | null }) => unknown) => {
    const state = { authenticated: true, userId: 'user-1', username: 'testuser' };
    return selector ? selector(state) : state;
  }),
}));

describe('IMView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders contact list with contacts', () => {
    render(<IMView online={false} isConnected={false} isStreaming={false} isMobile={false} isTablet={false} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('renders contacts sidebar header', () => {
    render(<IMView online={false} isConnected={false} isStreaming={false} isMobile={false} isTablet={false} />);
    expect(screen.getByText('Contacts')).toBeInTheDocument();
  });

  it('renders Select a contact placeholder when no contact selected', () => {
    render(<IMView online={false} isConnected={false} isStreaming={false} isMobile={false} isTablet={false} />);
    expect(screen.getByText('Select a contact to start messaging')).toBeInTheDocument();
  });

  it('shows empty message area when no contact selected', () => {
    render(<IMView online={false} isConnected={false} isStreaming={false} isMobile={false} isTablet={false} />);
    expect(screen.getByRole('listbox', { name: 'Contacts' })).toBeInTheDocument();
  });

  it('has message input enabled after selecting a contact', () => {
    render(<IMView online={false} isConnected={false} isStreaming={false} isMobile={false} isTablet={false} />);
    // Click on the first contact (Alice) to select it
    const contact = screen.getByRole('option', { name: /Alice/i });
    fireEvent.click(contact);
    // After selection, the message input should appear and be enabled
    const input = screen.getByRole('textbox', { name: 'Message input' });
    expect(input).toBeInTheDocument();
    expect(input).not.toBeDisabled();
  });

  it('renders search contact input', () => {
    render(<IMView online={false} isConnected={false} isStreaming={false} isMobile={false} isTablet={false} />);
    expect(screen.getByPlaceholderText('Search contacts...')).toBeInTheDocument();
  });

  it('renders add contact button', () => {
    render(<IMView online={false} isConnected={false} isStreaming={false} isMobile={false} isTablet={false} />);
    expect(screen.getByRole('button', { name: 'Add contact' })).toBeInTheDocument();
  });
});
