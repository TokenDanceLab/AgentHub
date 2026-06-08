import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { demoWorkbenchTranscripts } from '@shared/demo';
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

  it('does not show demo conversations while Desktop live threads are loading', () => {
    const { result } = renderHook(() => useDesktopWorkbenchModel());

    expect(result.current.activeConversationId).toBe('');
    expect(result.current.conversations).toEqual([]);
    expect(result.current.transcript).toEqual([]);
  });

  it('does not show the demo transcript when Local Edge has no threads', () => {
    mockedUseThreads.mockReturnValue({
      data: { items: [], page: { hasMore: false } },
    } as ReturnType<typeof useThreads>);

    const { result } = renderHook(() => useDesktopWorkbenchModel());

    expect(result.current.activeConversationId).toBe('');
    expect(result.current.conversations).toEqual([]);
    expect(result.current.transcript).toEqual([]);
    expect(result.current.transcript).not.toEqual(demoWorkbenchTranscripts.builder);
  });
});
