import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTokenUsageBoard } from '@/api/agentTeamQueries';

/* ═══════════════════════════════════════════════════════════════════════
   Token usage board query (#1819) — transport-level contract test.

   Mocks the HTTP boundary (global fetch), NOT the hook, so the query
   composition itself is exercised: team listing, per-team run fetching,
   and the migration-0066 token_usage_total mapping (absent → undefined,
   never 0). Mirrors the executionTargetQueries test harness.
   ═══════════════════════════════════════════════════════════════════════ */

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function mockFetch(status: number, data: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(JSON.stringify(data), {
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

const options = { getToken: () => 'tok', baseUrl: 'http://test.local' };

describe('useTokenUsageBoard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('composes each team\'s runs and maps recorded token counters', async () => {
    mockFetch(200, {
      code: 'ok',
      data: [
        { id: 'team-1', name: 'Release Crew' },
        { id: 'team-2', name: 'Docs Team' },
      ],
    });
    mockFetch(200, {
      code: 'ok',
      data: [
        { id: 'run-1', status: 'completed', created_at: '2026-08-22T09:00:00.000Z', token_usage_total: 128_400, trigger_message: 'ship' },
        // Pre-0066 run: counter absent on the wire — must stay undefined.
        { id: 'run-2', status: 'failed' },
      ],
    });
    mockFetch(200, { code: 'ok', data: [] });

    const { result } = renderHook(() => useTokenUsageBoard(true, options), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      {
        id: 'team-1',
        name: 'Release Crew',
        runs: [
          {
            id: 'run-1',
            status: 'completed',
            createdAt: '2026-08-22T09:00:00.000Z',
            tokenUsageTotal: 128_400,
            triggerMessage: 'ship',
          },
          { id: 'run-2', status: 'failed' },
        ],
      },
      { id: 'team-2', name: 'Docs Team', runs: [] },
    ]);
  });

  it('fails without a Hub session instead of fabricating data', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const { result } = renderHook(
      () => useTokenUsageBoard(true, { getToken: () => null, baseUrl: 'http://test.local' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toBe('Hub session is required');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
