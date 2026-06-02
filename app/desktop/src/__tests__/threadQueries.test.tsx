import type { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListResponse, ThreadInfo } from '@shared/types';
import { useArchiveThread, useDeleteThread, useRenameThread, useRestoreThread } from '@/api/threadQueries';

const {
  mockArchiveThread,
  mockUpdateThreadStatus,
  mockFetchThreads,
  mockFetchThreadItems,
  mockCreateThread,
  mockRenameThread,
  mockDeleteThread,
} = vi.hoisted(() => ({
  mockArchiveThread: vi.fn(),
  mockUpdateThreadStatus: vi.fn(),
  mockFetchThreads: vi.fn(),
  mockFetchThreadItems: vi.fn(),
  mockCreateThread: vi.fn(),
  mockRenameThread: vi.fn(),
  mockDeleteThread: vi.fn(),
}));

vi.mock('@/api/edgeClient', () => ({
  fetchThreads: mockFetchThreads,
  fetchThreadItems: mockFetchThreadItems,
  createThread: mockCreateThread,
  renameThread: mockRenameThread,
  deleteThread: mockDeleteThread,
  archiveThread: mockArchiveThread,
  updateThreadStatus: mockUpdateThreadStatus,
}));

function makeThread(overrides: Partial<ThreadInfo> = {}): ThreadInfo {
  return {
    threadId: 'thread_one',
    projectId: 'proj_local',
    title: 'Thread one',
    status: 'active',
    createdAt: '2026-05-29T00:00:00Z',
    updatedAt: '2026-05-29T00:00:00Z',
    ...overrides,
  };
}

function makeList(items: ThreadInfo[]): ListResponse<ThreadInfo> {
  return { items, page: { hasMore: false } };
}

function setupClient() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('threadQueries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renames matching threads across all cached thread query keys', async () => {
    const { queryClient, wrapper } = setupClient();
    queryClient.setQueryData(['threads', undefined], makeList([makeThread({ title: 'Codex' })]));
    queryClient.setQueryData(['threads', 'proj_local'], makeList([makeThread({ title: 'Codex' })]));
    mockRenameThread.mockResolvedValue(makeThread({ title: 'Repair message ordering' }));

    const { result } = renderHook(() => useRenameThread(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        threadId: 'thread_one',
        title: 'Repair message ordering',
      });
    });

    expect(queryClient.getQueryData<ListResponse<ThreadInfo>>(['threads', undefined])?.items[0]?.title).toBe('Repair message ordering');
    expect(queryClient.getQueryData<ListResponse<ThreadInfo>>(['threads', 'proj_local'])?.items[0]?.title).toBe('Repair message ordering');
    expect(mockRenameThread).toHaveBeenCalledWith('thread_one', 'Repair message ordering');
  });

  it('rolls back all cached thread query keys when rename fails', async () => {
    const { queryClient, wrapper } = setupClient();
    queryClient.setQueryData(['threads', undefined], makeList([makeThread({ title: 'Codex' })]));
    queryClient.setQueryData(['threads', 'proj_local'], makeList([makeThread({ title: 'Codex' })]));
    mockRenameThread.mockRejectedValue(new Error('rename failed'));

    const { result } = renderHook(() => useRenameThread(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync({
        threadId: 'thread_one',
        title: 'Repair message ordering',
      })).rejects.toThrow('rename failed');
    });

    expect(queryClient.getQueryData<ListResponse<ThreadInfo>>(['threads', undefined])?.items[0]?.title).toBe('Codex');
    expect(queryClient.getQueryData<ListResponse<ThreadInfo>>(['threads', 'proj_local'])?.items[0]?.title).toBe('Codex');
  });

  it('archives matching threads across all cached thread query keys', async () => {
    const { queryClient, wrapper } = setupClient();
    queryClient.setQueryData(['threads', undefined], makeList([makeThread()]));
    queryClient.setQueryData(['threads', 'proj_local'], makeList([makeThread()]));
    mockArchiveThread.mockResolvedValue(makeThread({ status: 'archived' }));

    const { result } = renderHook(() => useArchiveThread(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('thread_one');
    });

    expect(queryClient.getQueryData<ListResponse<ThreadInfo>>(['threads', undefined])?.items[0]?.status).toBe('archived');
    expect(queryClient.getQueryData<ListResponse<ThreadInfo>>(['threads', 'proj_local'])?.items[0]?.status).toBe('archived');
  });

  it('keeps a 405 delete fallback visible as archived instead of making it look deleted', async () => {
    const { queryClient, wrapper } = setupClient();
    queryClient.setQueryData(['threads', undefined], makeList([makeThread()]));
    queryClient.setQueryData(['threads', 'proj_local'], makeList([makeThread()]));
    mockDeleteThread.mockResolvedValue('archived');

    const { result } = renderHook(() => useDeleteThread(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('thread_one');
    });

    expect(queryClient.getQueryData<ListResponse<ThreadInfo>>(['threads', undefined])?.items[0]?.status).toBe('archived');
    expect(queryClient.getQueryData<ListResponse<ThreadInfo>>(['threads', 'proj_local'])?.items[0]?.status).toBe('archived');
  });

  it('removes threads from cache when Edge confirms a real delete', async () => {
    const { queryClient, wrapper } = setupClient();
    queryClient.setQueryData(['threads', undefined], makeList([makeThread()]));
    mockDeleteThread.mockResolvedValue('deleted');

    const { result } = renderHook(() => useDeleteThread(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('thread_one');
    });

    expect(queryClient.getQueryData<ListResponse<ThreadInfo>>(['threads', undefined])?.items).toEqual([]);
  });

  it('rolls back all cached thread query keys when restore fails', async () => {
    const { queryClient, wrapper } = setupClient();
    queryClient.setQueryData(['threads', undefined], makeList([makeThread({ status: 'archived' })]));
    queryClient.setQueryData(['threads', 'proj_local'], makeList([makeThread({ status: 'archived' })]));
    mockUpdateThreadStatus.mockRejectedValue(new Error('restore failed'));

    const { result } = renderHook(() => useRestoreThread(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync('thread_one')).rejects.toThrow('restore failed');
    });

    expect(queryClient.getQueryData<ListResponse<ThreadInfo>>(['threads', undefined])?.items[0]?.status).toBe('archived');
    expect(queryClient.getQueryData<ListResponse<ThreadInfo>>(['threads', 'proj_local'])?.items[0]?.status).toBe('archived');
  });
});
