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
});
