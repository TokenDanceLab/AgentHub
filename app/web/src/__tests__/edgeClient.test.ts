import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@shared/errors';
import { createEdgeClient } from '@/api/edgeClient';

describe('web edgeClient', () => {
  it('normalizes base URLs and preserves the list response contract', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: () =>
        Promise.resolve({
          items: [{ id: 'runner_local_1', name: 'Mock Runner', status: 'online' }],
          page: { hasMore: false },
        }),
    } as Response));

    const client = createEdgeClient({ baseUrl: 'http://127.0.0.1:3210/', fetcher: fetchMock });

    const runners = await client.fetchRunners();

    expect(runners.items[0]?.id).toBe('runner_local_1');
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:3210/v1/runners');
  });

  it('returns structured errors from the shared API error parser', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: () =>
        Promise.resolve({
          error: {
            code: 'runner_offline',
            message: 'Runner offline',
            traceId: 'trace_1',
          },
        }),
    } as Response));

    const client = createEdgeClient({ baseUrl: 'http://127.0.0.1:3210', fetcher: fetchMock });

    await expect(client.startRun()).rejects.toMatchObject({
      name: 'AppError',
      code: 'runner_offline',
      traceId: 'trace_1',
    } satisfies Partial<AppError>);
  });

  it('keeps project, thread, run and item endpoints behind the client boundary', async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: () => {
        if (url.includes('/v1/projects')) {
          return Promise.resolve({ items: [{ projectId: 'proj_1', name: 'AgentHub' }], page: { hasMore: false } });
        }
        if (url.includes('/v1/threads/thread%2F1/items')) {
          return Promise.resolve({ items: [{ itemId: 'item_1', threadId: 'thread/1' }], page: { hasMore: false } });
        }
        if (url.includes('/v1/items/item%2F1')) {
          return Promise.resolve({ itemId: 'item/1', status: 'ready' });
        }
        return Promise.resolve({ items: [{ runId: 'run_1', status: 'running' }], page: { hasMore: false } });
      },
    } as Response));

    const client = createEdgeClient({ baseUrl: 'http://127.0.0.1:3210/', fetcher: fetchMock });

    await client.fetchProjects({ pageSize: 20, pageCursor: 'cursor_1' });
    await client.fetchThreads({ projectId: 'proj_1' });
    await client.fetchRuns({ threadId: 'thread_1' });
    await client.fetchThreadItems('thread/1', { pageCursor: 'item_cursor' });
    await client.fetchItem('item/1');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:3210/v1/projects?pageSize=20&pageCursor=cursor_1',
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:3210/v1/threads?projectId=proj_1');
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'http://127.0.0.1:3210/v1/runs?threadId=thread_1');
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'http://127.0.0.1:3210/v1/threads/thread%2F1/items?pageCursor=item_cursor',
    );
    expect(fetchMock).toHaveBeenNthCalledWith(5, 'http://127.0.0.1:3210/v1/items/item%2F1');
  });
});
