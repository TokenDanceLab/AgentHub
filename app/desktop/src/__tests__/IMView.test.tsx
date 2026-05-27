import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import IMView from '@/views/IMView';

Element.prototype.scrollIntoView = vi.fn();

vi.mock('@/hooks/useIMChat', () => ({
  useIMChat: vi.fn(() => ({
    messages: [],
    contacts: [
      { id: 'c1', name: 'Alice', type: 'user' as const, online: true },
      { id: 'c2', name: 'Bob', type: 'user' as const, online: false },
    ],
    hubContacts: [],
    sendMessage: vi.fn(),
    getSessionMessages: vi.fn(() => []),
    upsertContact: vi.fn(),
    removeContact: vi.fn(),
    searchContacts: vi.fn(() => []),
    friendRequests: [],
    notifications: [],
    acceptFriendRequest: vi.fn(),
    rejectFriendRequest: vi.fn(),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    recallMessage: vi.fn(),
    loadSessionMessages: vi.fn(),
    createPrivateSession: vi.fn(),
    createGroupSession: vi.fn(),
    selectContact: vi.fn(),
    actionState: {},
    activeSessionId: null,
    status: 'loaded' as const,
    actionCapabilities: {},
    markSessionRead: vi.fn(),
    sessionReadError: null,
    addContact: vi.fn(() => Promise.resolve({ ok: true })),
    error: null,
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
    // Re-mock with empty state for this test
    vi.mocked(useIMChat).mockReturnValue({
      ...vi.mocked(useIMChat)(),
      contacts: [],
      status: 'loaded' as const,
    } as never);
    render(<IMView online={false} isConnected={false} isStreaming={false} isMobile={false} isTablet={false} />);
    expect(screen.getByText("No Hub conversations yet")).toBeInTheDocument();
  });
});

// Re-import for mock manipulation
import { useIMChat } from '@/hooks/useIMChat';
