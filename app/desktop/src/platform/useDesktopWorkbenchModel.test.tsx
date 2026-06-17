import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { WORKBENCH_DATA_MODE_STORAGE_KEY, resolveDemoWorkbenchTranscript } from '@shared/demo';
import { useThreadMessages, useThreadPins, useThreads } from '@/api/threadQueries';
import { useHubSessions, useHubMessages } from '@/api/sessionQueries';
import { useDesktopWorkbenchModel } from './useDesktopWorkbenchModel';

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

vi.mock('@/hooks/useHubWebSocket', () => ({
  useHubWebSocket: vi.fn(() => ({ lastEvent: null })),
}));

vi.mock('@/api/edgeClient', () => ({
  fetchHealth: vi.fn(() => Promise.reject(new Error('Edge not available'))),
}));

const mockedUseThreads = vi.mocked(useThreads);
const mockedUseThreadMessages = vi.mocked(useThreadMessages);
const mockedUseThreadPins = vi.mocked(useThreadPins);
const mockedUseHubSessions = vi.mocked(useHubSessions);
const mockedUseHubMessages = vi.mocked(useHubMessages);

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
    expect(result.current.dataMode).toBe('mock (auto fallback)');
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
    expect(result.current.dataMode).toBe('mock (auto fallback)');
    expect(result.current.isDemo).toBe(true);
    expect(result.current.conversations.some((conversation) => conversation.title === 'Local Thread')).toBe(false);
    expect(result.current.transcript).toEqual(resolveDemoWorkbenchTranscript('agent-collab'));
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
});
