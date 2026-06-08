import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findRegisteredLocalEdgeTarget,
  useHubExecutionTargets,
  usePingHubExecutionTarget,
} from '@/api/executionTargetQueries';

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

describe('execution target queries', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads Hub execution targets when enabled', async () => {
    const fetchSpy = mockFetch(200, {
      code: 'ok',
      data: {
        items: [
          {
            id: 'target-relay-1',
            owner_id: 'user_1',
            name: 'Hub relay alpha',
            target_type: 'hub_relay',
            health_state: 'healthy',
            is_online: true,
          },
        ],
        page: { hasMore: false, nextCursor: '' },
      },
    });

    const { result } = renderHook(
      () => useHubExecutionTargets({ enabled: true, getToken: () => 'tok', baseUrl: 'http://test.local' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items[0].name).toBe('Hub relay alpha');
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe('http://test.local/web/execution-targets?pageSize=50');
  });

  it('does not request Hub execution targets while disabled', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    renderHook(
      () => useHubExecutionTargets({ enabled: false, getToken: () => null, baseUrl: 'http://test.local' }),
      { wrapper: createWrapper() },
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('pings a Hub execution target and invalidates inventory', async () => {
    const fetchSpy = mockFetch(200, { code: 'ok', data: null });

    const { result } = renderHook(
      () => usePingHubExecutionTarget({ getToken: () => 'tok', baseUrl: 'http://test.local' }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await result.current.mutateAsync('target-relay-1');
    });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/web/execution-targets/target-relay-1/ping');
    expect(init.method).toBe('POST');
  });

  it('selects the registered local edge target for the current desktop device', () => {
    const target = findRegisteredLocalEdgeTarget(
      [
        {
          id: 'remote-1',
          name: 'Remote',
          target_type: 'remote_ssh',
          workspace_allowlist: [],
          trust_level: 'remote',
          health_state: 'healthy',
          is_online: true,
        },
        {
          id: 'local-other',
          device_id: 'desktop-other',
          name: 'Other desktop',
          target_type: 'local_edge',
          workspace_allowlist: [],
          trust_level: 'local',
          health_state: 'healthy',
          is_online: true,
        },
        {
          id: 'local-this-device',
          device_id: 'desktop-current',
          name: 'Doris Windows Local Edge',
          target_type: 'local_edge',
          workspace_allowlist: ['D:/Code/TokenDance/AgentHub'],
          trust_level: 'local',
          health_state: 'healthy',
          is_online: true,
          last_seen_at: '2026-06-09T01:00:00Z',
        },
      ],
      'desktop-current',
    );

    expect(target?.id).toBe('local-this-device');
    expect(target?.workspace_allowlist).toEqual(['D:/Code/TokenDance/AgentHub']);
  });
});
