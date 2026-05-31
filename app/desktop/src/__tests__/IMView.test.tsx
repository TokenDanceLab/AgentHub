import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import IMView from '@/views/IMView';
import { useIMChat } from '@/hooks/useIMChat';

Element.prototype.scrollIntoView = vi.fn();

const {
  mockAddContact,
  mockCreatePrivateSession,
  mockCreateGroupSession,
  mockAcceptFriendRequest,
  mockRejectFriendRequest,
  mockMarkNotificationRead,
  mockReadAllNotifications,
  mockMarkSessionRead,
  mockRecallMessage,
  mockRefreshSessions,
} = vi.hoisted(() => ({
  mockAddContact: vi.fn(async () => ({ ok: true })),
  mockCreatePrivateSession: vi.fn(async () => ({ ok: true })),
  mockCreateGroupSession: vi.fn(async () => ({ ok: true })),
  mockAcceptFriendRequest: vi.fn(async () => ({ ok: true })),
  mockRejectFriendRequest: vi.fn(async () => ({ ok: true })),
  mockMarkNotificationRead: vi.fn(async () => ({ ok: true })),
  mockReadAllNotifications: vi.fn(async () => ({ ok: true })),
  mockMarkSessionRead: vi.fn(async () => ({ ok: true })),
  mockRecallMessage: vi.fn(async () => ({ ok: true })),
  mockRefreshSessions: vi.fn(async () => undefined),
}));

vi.mock('@/hooks/useIMChat', () => ({
  useIMChat: vi.fn(() => ({
    messages: [],
    contacts: [
      { id: 'c1', name: 'Alice', type: 'user' as const, online: true, unreadCount: 2 },
      { id: 'c2', name: 'Bob', type: 'user' as const, online: false },
    ],
    hubContacts: [
      { user_id: 'user-b', username: 'alice', nickname: 'Alice', online: true, type: 'friend' },
      { user_id: 'user-c', username: 'bob', nickname: 'Bob', online: false, type: 'friend' },
    ],
    friendRequests: [
      { request_id: 'fr-1', user_id: 'user-d', username: 'dana', nickname: 'Dana', message: 'hi', created_at: '2026-05-25T00:00:00Z' },
    ],
    notifications: [
      {
        id: 'notif-1',
        user_id: 'user-1',
        type: 'mention',
        payload: JSON.stringify({ title: 'Mention' }),
        read: false,
        created_at: '2026-05-25T00:00:00Z',
      },
    ],
    actionState: {},
    actionCapabilities: {
      friendRequests: true,
      notifications: true,
      sessionRead: true,
      recallMessage: true,
    },
    status: 'ready',
    error: null,
    sendMessage: vi.fn(),
    getSessionMessages: vi.fn(() => []),
    loadSessionMessages: vi.fn(),
    upsertContact: vi.fn(),
    removeContact: vi.fn(),
    addContact: mockAddContact,
    createPrivateSession: mockCreatePrivateSession,
    createGroupSession: mockCreateGroupSession,
    acceptFriendRequest: mockAcceptFriendRequest,
    rejectFriendRequest: mockRejectFriendRequest,
    markNotificationRead: mockMarkNotificationRead,
    readAllNotifications: mockReadAllNotifications,
    markSessionRead: mockMarkSessionRead,
    recallMessage: mockRecallMessage,
    refreshSessions: mockRefreshSessions,
    searchContacts: vi.fn((q: string) =>
      q
        ? [{ id: 'c1', name: 'Alice', type: 'user' as const, online: true }]
        : [
            { id: 'c1', name: 'Alice', type: 'user' as const, online: true },
            { id: 'c2', name: 'Bob', type: 'user' as const, online: false },
          ],
    ),
    selectContact: vi.fn(),
    activeSessionId: null,
    sessionReadError: null,
    label: (key: string, fallback: string) => fallback,
    actionPending: () => false,
  })),
}));

vi.mock('@/stores/hubStore', () => ({
  useHubStore: vi.fn((selector?: (s: { authenticated: boolean; userId: string | null }) => unknown) => {
    const state = { authenticated: true, userId: 'user-1' };
    return selector ? selector(state) : state;
  }),
}));

describe('IMView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with contacts', () => {
    render(<IMView online={false} isConnected={false} isStreaming={false} isMobile={false} isTablet={false} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('shows empty state when no conversations', () => {
    vi.mocked(useIMChat).mockReturnValueOnce({
      ...vi.mocked(useIMChat)(),
      contacts: [],
      status: 'loaded' as const,
    } as never);
    render(<IMView online={false} isConnected={false} isStreaming={false} isMobile={false} isTablet={false} />);
    expect(screen.getByText('Contacts')).toBeInTheDocument();
  });

  it('renders Select a contact placeholder when no contact selected', () => {
    render(<IMView online={false} isConnected={false} isStreaming={false} isMobile={false} isTablet={false} />);
    expect(screen.getByText('Select a contact to start messaging')).toBeInTheDocument();
  });

  it('shows Hub request and notification action summary', () => {
    render(<IMView online={false} isConnected={false} isStreaming={false} isMobile={false} isTablet={false} />);
    expect(screen.getByLabelText('Hub IM snapshot')).toBeInTheDocument();
    expect(screen.getByText('1 contact requests')).toBeInTheDocument();
    expect(screen.getByText('1 unread notifications')).toBeInTheDocument();
    expect(screen.getByText('2 unread sessions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept request' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject request' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark notification read' })).toBeInTheDocument();
  });

  it('calls Hub request and notification actions', () => {
    render(<IMView online={false} isConnected={false} isStreaming={false} isMobile={false} isTablet={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Accept request' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reject request' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark notification read' }));
    fireEvent.click(screen.getByRole('button', { name: 'Read all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(mockAcceptFriendRequest).toHaveBeenCalledWith('fr-1');
    expect(mockRejectFriendRequest).toHaveBeenCalledWith('fr-1');
    expect(mockMarkNotificationRead).toHaveBeenCalledWith('notif-1');
    expect(mockReadAllNotifications).toHaveBeenCalled();
    expect(mockRefreshSessions).toHaveBeenCalled();
  });

  it('offers retry when Hub sessions fail to load', () => {
    vi.mocked(useIMChat).mockReturnValueOnce({
      ...vi.mocked(useIMChat)(),
      status: 'error',
      error: 'im.state.unavailable',
    } as never);

    render(<IMView online={false} isConnected={false} isStreaming={false} isMobile={false} isTablet={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mockRefreshSessions).toHaveBeenCalled();
  });

  it('shows empty message area when no contact selected', () => {
    render(<IMView online={false} isConnected={false} isStreaming={false} isMobile={false} isTablet={false} />);
    expect(screen.getByRole('listbox', { name: 'Contacts' })).toBeInTheDocument();
  });

  it('has message input enabled after selecting a contact', () => {
    render(<IMView online={false} isConnected={false} isStreaming={false} isMobile={false} isTablet={false} />);
    const contact = screen.getByRole('option', { name: /Alice/i });
    fireEvent.click(contact);
    const input = screen.getByRole('textbox', { name: 'Message input' });
    expect(input).toBeInTheDocument();
    expect(input).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /Mark read/i })).toBeDisabled();
  });

  it('renders search contact input', () => {
    render(<IMView online={false} isConnected={false} isStreaming={false} isMobile={false} isTablet={false} />);
    expect(screen.getByPlaceholderText('Search contacts...')).toBeInTheDocument();
  });

  it('exposes Hub-backed compose actions instead of local-only fake contacts', () => {
    render(<IMView online={false} isConnected={false} isStreaming={false} isMobile={false} isTablet={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Hub compose' }));

    expect(screen.getByRole('button', { name: 'Add contact' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create direct chat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create group chat' })).toBeInTheDocument();
    expect(screen.getByLabelText('Hub user ID')).toBeInTheDocument();
  });

  it('creates private chat through useIMChat action', async () => {
    render(<IMView online={false} isConnected={false} isStreaming={false} isMobile={false} isTablet={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Hub compose' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create direct chat' }));
    fireEvent.change(screen.getByLabelText('Hub user ID'), { target: { value: 'user-b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(mockCreatePrivateSession).toHaveBeenCalledWith('user-b');
  });

  it('creates group chat through useIMChat action', async () => {
    render(<IMView online={false} isConnected={false} isStreaming={false} isMobile={false} isTablet={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Hub compose' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create group chat' }));
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Build Room' } });
    fireEvent.click(screen.getByLabelText('Alice'));
    fireEvent.click(screen.getByLabelText('Bob'));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(mockCreateGroupSession).toHaveBeenCalledWith('Build Room', ['user-b', 'user-c']);
  });
});
