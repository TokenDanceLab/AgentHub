import { createElement, type ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ListResponse, RunInfo } from '@shared/types';
import { edgeQueryKeys } from '@shared/stores/queryKeys';
import {
  findActiveEdgeRun,
  isEdgeRunStatusActive,
  updateRunStatusInQueries,
  upsertRunInQueries,
  useCancelRun,
  useDecideEdgePermission,
} from '@/api/runQueries';
import { cancelRun, decidePermission } from '@/api/edgeClient';

vi.mock('@/api/edgeClient', () => ({
  startRun: vi.fn(),
  cancelRun: vi.fn(),
  fetchRuns: vi.fn(),
  decidePermission: vi.fn(),
}));

const mockedCancelRun = vi.mocked(cancelRun);
const mockedDecidePermission = vi.mocked(decidePermission);

function runs(items: RunInfo[]): ListResponse<RunInfo> {
  return { items, page: { hasMore: false } };
}

function createQueryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('runQueries cache helpers', () => {
  it('upserts active runs across compatible run query filters', () => {
    const qc = new QueryClient();
    qc.setQueryData(edgeQueryKeys.runs.all(), runs([]));
    qc.setQueryData(edgeQueryKeys.runs.all('project-1', 'thread-1'), runs([]));
    qc.setQueryData(edgeQueryKeys.runs.all('project-2', 'thread-2'), runs([]));

    upsertRunInQueries(qc, {
      runId: 'run-1',
      projectId: 'project-1',
      threadId: 'thread-1',
      status: 'running',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(qc.getQueryData<ListResponse<RunInfo>>(edgeQueryKeys.runs.all())?.items).toHaveLength(1);
    expect(qc.getQueryData<ListResponse<RunInfo>>(edgeQueryKeys.runs.all('project-1', 'thread-1'))?.items[0]).toMatchObject({
      runId: 'run-1',
      status: 'running',
    });
    expect(qc.getQueryData<ListResponse<RunInfo>>(edgeQueryKeys.runs.all('project-2', 'thread-2'))?.items).toHaveLength(1);
  });

  it('marks terminal statuses in every cached list containing the run', () => {
    const qc = new QueryClient();
    const item: RunInfo = {
      runId: 'run-1',
      projectId: 'project-1',
      threadId: 'thread-1',
      status: 'running',
    };
    qc.setQueryData(edgeQueryKeys.runs.all(), runs([item]));
    qc.setQueryData(edgeQueryKeys.runs.all('project-1', 'thread-1'), runs([item]));

    updateRunStatusInQueries(qc, 'run-1', 'finished', {
      finishedAt: '2026-01-01T00:01:00.000Z',
    });

    expect(qc.getQueryData<ListResponse<RunInfo>>(edgeQueryKeys.runs.all())?.items[0]).toMatchObject({
      status: 'finished',
      finishedAt: '2026-01-01T00:01:00.000Z',
    });
    expect(qc.getQueryData<ListResponse<RunInfo>>(edgeQueryKeys.runs.all('project-1', 'thread-1'))?.items[0]?.status).toBe('finished');
  });
});

describe('edge run status helpers (#1816 W1)', () => {
  it('treats lifecycle-active statuses as active and settled ones as terminal', () => {
    expect(isEdgeRunStatusActive('queued')).toBe(true);
    expect(isEdgeRunStatusActive('started')).toBe(true);
    expect(isEdgeRunStatusActive('cancelling')).toBe(true);
    expect(isEdgeRunStatusActive('completed')).toBe(false);
    expect(isEdgeRunStatusActive('finished')).toBe(false);
    expect(isEdgeRunStatusActive('failed')).toBe(false);
    expect(isEdgeRunStatusActive('cancelled')).toBe(false);
  });

  it('finds the first still-active run for the cancel target', () => {
    const settled: RunInfo = { runId: 'run-done', projectId: 'p', threadId: 't', status: 'completed' };
    const active: RunInfo = { runId: 'run-live', projectId: 'p', threadId: 't', status: 'started' };

    expect(findActiveEdgeRun([settled, active])?.runId).toBe('run-live');
    expect(findActiveEdgeRun([settled])).toBeUndefined();
    expect(findActiveEdgeRun(undefined)).toBeUndefined();
  });
});

describe('run control wiring (#1816 W1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useCancelRun calls edgeClient.cancelRun with the target runId', async () => {
    mockedCancelRun.mockResolvedValue({
      runId: 'run-live',
      projectId: 'project-1',
      threadId: 'thread-1',
      status: 'cancelled',
    });

    const { result } = renderHook(() => useCancelRun(), { wrapper: createQueryWrapper() });
    const cancelled = await result.current.mutateAsync('run-live');

    expect(mockedCancelRun).toHaveBeenCalledTimes(1);
    expect(mockedCancelRun).toHaveBeenCalledWith('run-live');
    expect(cancelled.status).toBe('cancelled');
  });

  it('useDecideEdgePermission calls edgeClient.decidePermission with the exact request', async () => {
    mockedDecidePermission.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDecideEdgePermission(), { wrapper: createQueryWrapper() });
    await result.current.mutateAsync({
      runId: 'run-live',
      requestId: 'perm-1',
      decision: 'allow',
    });

    expect(mockedDecidePermission).toHaveBeenCalledTimes(1);
    expect(mockedDecidePermission).toHaveBeenCalledWith({
      runId: 'run-live',
      requestId: 'perm-1',
      decision: 'allow',
    });
  });

  it('useDecideEdgePermission propagates Edge failures to the caller', async () => {
    mockedDecidePermission.mockRejectedValue(new Error('permission not found'));

    const { result } = renderHook(() => useDecideEdgePermission(), { wrapper: createQueryWrapper() });

    await expect(
      result.current.mutateAsync({ runId: 'run-live', requestId: 'perm-gone', decision: 'deny' }),
    ).rejects.toThrow('permission not found');
  });
});
