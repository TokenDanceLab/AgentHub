import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { ListResponse, RunInfo } from '@shared/types';
import { updateRunStatusInQueries, upsertRunInQueries } from '@/api/runQueries';

function runs(items: RunInfo[]): ListResponse<RunInfo> {
  return { items, page: { hasMore: false } };
}

describe('runQueries cache helpers', () => {
  it('upserts active runs across compatible run query filters', () => {
    const qc = new QueryClient();
    qc.setQueryData(['runs'], runs([]));
    qc.setQueryData(['runs', 'project-1', 'thread-1'], runs([]));
    qc.setQueryData(['runs', 'project-2', 'thread-2'], runs([]));

    upsertRunInQueries(qc, {
      runId: 'run-1',
      projectId: 'project-1',
      threadId: 'thread-1',
      status: 'running',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(qc.getQueryData<ListResponse<RunInfo>>(['runs'])?.items).toHaveLength(1);
    expect(qc.getQueryData<ListResponse<RunInfo>>(['runs', 'project-1', 'thread-1'])?.items[0]).toMatchObject({
      runId: 'run-1',
      status: 'running',
    });
    expect(qc.getQueryData<ListResponse<RunInfo>>(['runs', 'project-2', 'thread-2'])?.items).toHaveLength(1);
  });

  it('marks terminal statuses in every cached list containing the run', () => {
    const qc = new QueryClient();
    const item: RunInfo = {
      runId: 'run-1',
      projectId: 'project-1',
      threadId: 'thread-1',
      status: 'running',
    };
    qc.setQueryData(['runs'], runs([item]));
    qc.setQueryData(['runs', 'project-1', 'thread-1'], runs([item]));

    updateRunStatusInQueries(qc, 'run-1', 'finished', {
      finishedAt: '2026-01-01T00:01:00.000Z',
    });

    expect(qc.getQueryData<ListResponse<RunInfo>>(['runs'])?.items[0]).toMatchObject({
      status: 'finished',
      finishedAt: '2026-01-01T00:01:00.000Z',
    });
    expect(qc.getQueryData<ListResponse<RunInfo>>(['runs', 'project-1', 'thread-1'])?.items[0]?.status).toBe('finished');
  });
});
