import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { WORKBENCH_DATA_MODE_STORAGE_KEY, resolveDemoWorkbenchTranscript } from '@shared/demo';
import { useThreadMessages, useThreadPins, useThreads } from '@/api/threadQueries';
import { useHubSessions, useHubMessages } from '@/api/sessionQueries';
import { getAccessToken } from '@/hooks/useAuth';
import { useHubStore } from '@/stores/hubStore';
import { useDesktopWorkbenchModel } from './useDesktopWorkbenchModel';
import { useDesktopEdgeEvents } from './useDesktopEdgeEvents';
import { fetchHealth } from '@/api/edgeClient';

vi.mock('@/api/threadQueries', () => ({
  useThreadPins: vi.fn(),
  useThreadMessages: vi.fn(),
  useThreads: vi.fn(),
}));

vi.mock('@/api/sessionQueries', () => ({
  useHubSessions: vi.fn(),
  useHubMessages: vi.fn(),
  useHubSendMessage: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useHubRecallMessage: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useHubEditMessage: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useHubPinMessage: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useHubUnpinMessage: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useHubMarkRead: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock('@/api/hubQueries', () => ({
  useHubContacts: vi.fn(() => ({ data: undefined })),
  useHubSearchUser: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useHubSendFriendRequest: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useHubAcceptFriendRequest: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useHubRejectFriendRequest: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useHubRemoveContact: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useHubBlockContact: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useHubUnblockContact: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useHubUpdateContactRemark: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useHubCreateContactGroup: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useHubWorkspaceProjects: vi.fn(() => ({ data: undefined, isFetching: false })),
  useCreateHubWorkspaceProject: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUpdateHubWorkspaceProject: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock('@/stores/hubStore', () => ({
  useHubStore: vi.fn(() => false),
}));

vi.mock('@/hooks/useAuth', () => ({
  getAccessToken: vi.fn(() => null),
}));

vi.mock('./useDesktopEdgeEvents', () => ({
  useDesktopEdgeEvents: vi.fn(() => []),
}));

vi.mock('@/api/edgeClient', () => ({
  fetchHealth: vi.fn(() => Promise.reject(new Error('Edge not available'))),
}));

const mockedUseThreads = vi.mocked(useThreads);
const mockedUseThreadMessages = vi.mocked(useThreadMessages);
const mockedUseThreadPins = vi.mocked(useThreadPins);
const mockedUseHubSessions = vi.mocked(useHubSessions);
const mockedUseHubMessages = vi.mocked(useHubMessages);
const mockedUseDesktopEdgeEvents = vi.mocked(useDesktopEdgeEvents);
const mockedFetchHealth = vi.mocked(fetchHealth);
const mockedUseHubStore = vi.mocked(useHubStore);
const mockedGetAccessToken = vi.mocked(getAccessToken);

describe('useDesktopWorkbenchModel', () => {
  const queryClient = new QueryClient();

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      configurable: true,
    });
    mockedUseThreads.mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useThreads>);
    mockedUseThreadMessages.mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useThreadMessages>);
    mockedUseThreadPins.mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useThreadPins>);
    mockedUseHubSessions.mockReturnValue({
      data: undefined,
    } as unknown as ReturnType<typeof useHubSessions>);
    mockedUseHubMessages.mockReturnValue({
      data: undefined,
    } as unknown as ReturnType<typeof useHubMessages>);
    mockedUseDesktopEdgeEvents.mockReturnValue([]);
    mockedFetchHealth.mockRejectedValue(new Error('Edge not available'));
    mockedUseHubStore.mockReturnValue(false as never);
    mockedGetAccessToken.mockReturnValue(null);
  });

  function renderWithProvider() {
    return renderHook(() => useDesktopWorkbenchModel(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    });
  }

  it('uses the Desktop demo conversation while live threads are loading', () => {
    const { result } = renderWithProvider();

    expect(result.current.activeConversationId).toBe('agent-collab');
    expect(result.current.isDemo).toBe(true);
    expect(result.current.conversations.length).toBeGreaterThan(0);
    expect(result.current.transcript).toEqual(resolveDemoWorkbenchTranscript('agent-collab'));
    expect(mockedUseThreads).toHaveBeenCalledWith(undefined, { enabled: false });
    expect(mockedUseThreadMessages).toHaveBeenCalledWith(null);
    expect(mockedUseThreadPins).toHaveBeenCalledWith(null);
  });

  it('keeps the mock workbench usable when Local Edge has no threads', () => {
    mockedUseThreads.mockReturnValue({
      data: { items: [], page: { hasMore: false } },
    } as unknown as ReturnType<typeof useThreads>);

    const { result } = renderWithProvider();

    expect(result.current.activeConversationId).toBe('agent-collab');
    expect(result.current.dataMode).toBe('auto');
    expect(result.current.conversations.length).toBeGreaterThan(0);
    expect(result.current.transcript).toEqual(resolveDemoWorkbenchTranscript('agent-collab'));
  });

  it('keeps auto mode on the mock workbench even when Local Edge has existing threads', () => {
    mockedUseThreads.mockReturnValue({
      data: {
        items: [{
          threadId: 'live-thread',
          title: 'Local Thread',
          status: 'active',
        }],
        page: { hasMore: false },
      },
    } as ReturnType<typeof useThreads>);

    const { result } = renderWithProvider();

    expect(result.current.activeConversationId).toBe('agent-collab');
    expect(result.current.dataMode).toBe('auto');
    expect(result.current.isDemo).toBe(true);
    expect(result.current.conversations.some((conversation) => conversation.title === 'Local Thread')).toBe(false);
    expect(result.current.transcript).toEqual(resolveDemoWorkbenchTranscript('agent-collab'));
  });

  it('keeps explicit mock mode isolated from Local Edge probing and data', async () => {
    window.localStorage.setItem(WORKBENCH_DATA_MODE_STORAGE_KEY, 'mock');
    mockedUseThreads.mockReturnValue({
      data: {
        items: [{
          threadId: 'live-thread',
          title: 'Local Thread',
          status: 'active',
        }],
        page: { hasMore: false },
      },
    } as ReturnType<typeof useThreads>);

    const { result } = renderWithProvider();

    await waitFor(() => {
      expect(mockedUseThreads).toHaveBeenCalledWith(undefined, { enabled: false });
    });
    expect(mockedFetchHealth).not.toHaveBeenCalled();
    expect(result.current.dataMode).toBe('mock');
    expect(result.current.isDemo).toBe(true);
    expect(result.current.conversations.some((conversation) => conversation.title === 'Local Thread')).toBe(false);
  });

  it('uses Local Edge threads only after approved-real is explicitly selected', () => {
    window.localStorage.setItem(WORKBENCH_DATA_MODE_STORAGE_KEY, 'approved-real');
    mockedUseThreads.mockReturnValue({
      data: {
        items: [{
          threadId: 'live-thread',
          title: 'Local Thread',
          status: 'active',
        }],
        page: { hasMore: false },
      },
    } as ReturnType<typeof useThreads>);

    const { result } = renderWithProvider();

    expect(result.current.activeConversationId).toBe('live-thread');
    expect(result.current.dataMode).toBe('approved-real');
    expect(result.current.isDemo).toBe(false);
    expect(result.current.conversations).toEqual([
      expect.objectContaining({
        id: 'live-thread',
        title: 'Local Thread',
      }),
    ]);
    expect(mockedUseThreads).toHaveBeenCalledWith(undefined, { enabled: true });
  });

  it('merges persisted thread items and live Edge events by transcript time', () => {
    window.localStorage.setItem(WORKBENCH_DATA_MODE_STORAGE_KEY, 'approved-real');
    mockedUseThreads.mockReturnValue({
      data: {
        items: [{
          threadId: 'live-thread',
          title: 'Local Thread',
          status: 'active',
        }],
        page: { hasMore: false },
      },
    } as ReturnType<typeof useThreads>);
    mockedUseThreadMessages.mockReturnValue({
      data: {
        items: [{
          itemId: 'persisted-later',
          type: 'message',
          role: 'agent',
          senderName: 'Agent',
          content: 'persisted later',
          createdAt: '2026-06-26T10:00:05.000Z',
        }],
        page: { hasMore: false },
      },
    } as unknown as ReturnType<typeof useThreadMessages>);
    mockedUseDesktopEdgeEvents.mockReturnValue([{
      id: 'live-earlier',
      kind: 'text',
      text: 'live earlier',
      author: { id: 'agent', name: 'Agent', role: 'agent' },
      createdAt: '2026-06-26T10:00:01.000Z',
    }]);

    const { result } = renderWithProvider();

    expect(result.current.transcript.map((block) => block.id)).toEqual([
      'live-earlier',
      'thread-item-persisted-later',
    ]);
  });

  it('does not let hubSessions[0] steal an explicit Edge thread selection (#1010)', () => {
    window.localStorage.setItem(WORKBENCH_DATA_MODE_STORAGE_KEY, 'approved-real');
    mockedUseHubStore.mockReturnValue(true as never);
    mockedGetAccessToken.mockReturnValue('token');

    mockedUseHubSessions.mockReturnValue({
      data: [{ id: 'hub-session-1', title: 'Hub DM', type: 'private' }],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useHubSessions>);
    mockedUseHubMessages.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useHubMessages>);
    mockedUseThreads.mockReturnValue({
      data: {
        items: [{
          threadId: 'edge-thread-1',
          title: 'Edge Thread',
          status: 'active',
        }],
        page: { hasMore: false },
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useThreads>);
    mockedUseThreadMessages.mockReturnValue({
      data: { items: [], page: { hasMore: false } },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useThreadMessages>);
    mockedUseThreadPins.mockReturnValue({
      data: { items: [] },
    } as unknown as ReturnType<typeof useThreadPins>);

    const { result } = renderHook(
      () => useDesktopWorkbenchModel('edge-thread-1'),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        ),
      },
    );

    expect(result.current.activeConversationId).toBe('edge-thread-1');
    expect(result.current.activeThreadId).toBe('edge-thread-1');
    expect(result.current.conversations.map((c) => c.id)).toEqual(
      expect.arrayContaining(['hub-session-1', 'edge-thread-1']),
    );
  });

  it('exposes the IM transcript unread marker from the Hub session watermark (T8)', () => {
    window.localStorage.setItem(WORKBENCH_DATA_MODE_STORAGE_KEY, 'approved-real');
    mockedUseHubStore.mockReturnValue(true as never);
    mockedGetAccessToken.mockReturnValue('token');

    mockedUseHubSessions.mockReturnValue({
      data: [{
        id: 'hub-session-1',
        title: 'Hub DM',
        type: 'private',
        unread_count: 2,
      }],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useHubSessions>);
    mockedUseHubMessages.mockReturnValue({
      data: [
        { id: 'm1', session_id: 'hub-session-1', seq_id: 1, sender_type: 'user', sender_id: 'me', content_type: 'text/plain', content: 'hi' },
        { id: 'm2', session_id: 'hub-session-1', seq_id: 2, sender_type: 'user', sender_id: 'other', content_type: 'text/plain', content: 'hello' },
        { id: 'm3', session_id: 'hub-session-1', seq_id: 3, sender_type: 'user', sender_id: 'other', content_type: 'text/plain', content: 'unread-1' },
        { id: 'm4', session_id: 'hub-session-1', seq_id: 4, sender_type: 'user', sender_id: 'other', content_type: 'text/plain', content: 'unread-2' },
      ],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useHubMessages>);

    const { result } = renderWithProvider();

    expect(result.current.transcriptUnread).toEqual({
      anchorBlockId: 'hub-message-m3',
      count: 2,
      readThroughSeq: 2,
    });
    // The transcript itself stays marker-free (blocks unchanged).
    expect(result.current.transcript.map((b) => b.id)).toEqual([
      'hub-message-m1',
      'hub-message-m2',
      'hub-message-m3',
      'hub-message-m4',
    ]);
  });

  it('omits the IM transcript unread marker when the session is fully read', () => {
    window.localStorage.setItem(WORKBENCH_DATA_MODE_STORAGE_KEY, 'approved-real');
    mockedUseHubStore.mockReturnValue(true as never);
    mockedGetAccessToken.mockReturnValue('token');

    mockedUseHubSessions.mockReturnValue({
      data: [{
        id: 'hub-session-1',
        title: 'Hub DM',
        type: 'private',
        unread_count: 0,
      }],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useHubSessions>);
    mockedUseHubMessages.mockReturnValue({
      data: [
        { id: 'm1', session_id: 'hub-session-1', seq_id: 1, sender_type: 'user', sender_id: 'me', content_type: 'text/plain', content: 'hi' },
      ],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useHubMessages>);

    const { result } = renderWithProvider();

    expect(result.current.transcriptUnread).toBeUndefined();
  });
});
