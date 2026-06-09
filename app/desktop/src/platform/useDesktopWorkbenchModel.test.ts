import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKBENCH_DATA_MODE_STORAGE_KEY, demoWorkbenchTranscripts } from '@shared/demo';
import { useThreadMessages, useThreadPins, useThreads } from '@/api/threadQueries';
import { useDesktopWorkbenchModel } from './useDesktopWorkbenchModel';

vi.mock('@/api/threadQueries', () => ({
  useThreadPins: vi.fn(),
  useThreadMessages: vi.fn(),
  useThreads: vi.fn(),
}));

vi.mock('./useDesktopEdgeEvents', () => ({
  useDesktopEdgeEvents: vi.fn(() => []),
}));

const mockedUseThreads = vi.mocked(useThreads);
const mockedUseThreadMessages = vi.mocked(useThreadMessages);
const mockedUseThreadPins = vi.mocked(useThreadPins);

describe('useDesktopWorkbenchModel', () => {
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
  });

  it('uses the Desktop demo conversation while live threads are loading', () => {
    const { result } = renderHook(() => useDesktopWorkbenchModel());

    expect(result.current.activeConversationId).toBe('agent-collab');
    expect(result.current.isDemo).toBe(true);
    expect(result.current.conversations.length).toBeGreaterThan(0);
    expect(result.current.transcript).toEqual(demoWorkbenchTranscripts['agent-collab']);
    expect(mockedUseThreads).toHaveBeenCalledWith(undefined, { enabled: false });
    expect(mockedUseThreadMessages).toHaveBeenCalledWith(null);
    expect(mockedUseThreadPins).toHaveBeenCalledWith(null);
  });

  it('keeps the mock workbench usable when Local Edge has no threads', () => {
    mockedUseThreads.mockReturnValue({
      data: { items: [], page: { hasMore: false } },
    } as ReturnType<typeof useThreads>);

    const { result } = renderHook(() => useDesktopWorkbenchModel());

    expect(result.current.activeConversationId).toBe('agent-collab');
    expect(result.current.dataMode).toBe('mock (auto fallback)');
    expect(result.current.conversations.length).toBeGreaterThan(0);
    expect(result.current.transcript).toEqual(demoWorkbenchTranscripts['agent-collab']);
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

    const { result } = renderHook(() => useDesktopWorkbenchModel());

    expect(result.current.activeConversationId).toBe('agent-collab');
    expect(result.current.dataMode).toBe('mock (auto fallback)');
    expect(result.current.isDemo).toBe(true);
    expect(result.current.conversations.some((conversation) => conversation.title === 'Local Thread')).toBe(false);
    expect(result.current.transcript).toEqual(demoWorkbenchTranscripts['agent-collab']);
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

    const { result } = renderHook(() => useDesktopWorkbenchModel());

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
