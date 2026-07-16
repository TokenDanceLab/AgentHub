import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findRegisteredLocalEdgeTarget,
  useHubExecutionTargets,
  usePingHubExecutionTarget,
  useSyncLocalEdgeExecutionTarget,
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
    expect(url).toBe('http://test.local/web/execution-targets/target-relay-1:ping');
    expect(init.method).toBe('POST');
  });

  it('creates a Hub local_edge target for the current Desktop without sending health or process fields', async () => {
    const fetchSpy = mockFetch(201, {
      code: 'ok',
      data: {
        id: 'local-target-current',
        device_id: 'desktop-current',
        name: 'AgentHub Desktop Local Edge',
        target_type: 'local_edge',
        trust_level: 'local',
        health_state: 'unknown',
        is_online: false,
      },
    });

    const { result } = renderHook(
      () => useSyncLocalEdgeExecutionTarget({ getToken: () => 'tok', baseUrl: 'http://test.local' }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await result.current.mutateAsync({
        deviceId: 'desktop-current',
        localEdgeTarget: {
          id: 'local-edge',
          type: 'local_edge',
          name: 'Local Edge',
          status: 'healthy',
          route: 'local-edge-api',
          runnerCount: 1,
          onlineRunnerCount: 1,
          agentCount: 2,
          modelCount: 3,
          capabilityIds: ['streaming', 'workspace-allowlist'],
        },
      });
    });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/web/execution-targets');
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body));
    expect(body).toEqual(expect.objectContaining({
      device_id: 'desktop-current',
      name: 'AgentHub Desktop Local Edge',
      target_type: 'local_edge',
      trust_level: 'local',
      auth_method: 'hub_jwt',
      capabilities: expect.objectContaining({
        route: 'local-edge-api',
        runner_count: 1,
        online_runner_count: 1,
        agent_count: 2,
        model_count: 3,
      }),
      metadata: expect.objectContaining({
        source: 'agenthub-desktop',
        registration: 'desktop-local-edge-readiness',
      }),
    }));
    expect(body).not.toHaveProperty('health_state');
    expect(body).not.toHaveProperty('command');
    expect(body).not.toHaveProperty('cliPath');
    expect(body).not.toHaveProperty('sidecar_args');
  });

  it('updates an existing Hub local_edge target instead of creating a duplicate', async () => {
    const fetchSpy = mockFetch(200, {
      code: 'ok',
      data: {
        id: 'local-target-current',
        device_id: 'desktop-current',
        name: 'AgentHub Desktop Local Edge',
        target_type: 'local_edge',
        trust_level: 'local',
        health_state: 'healthy',
        is_online: true,
      },
    });

    const { result } = renderHook(
      () => useSyncLocalEdgeExecutionTarget({ getToken: () => 'tok', baseUrl: 'http://test.local' }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await result.current.mutateAsync({
        registeredTargetId: 'local-target-current',
        deviceId: 'desktop-current',
        localEdgeTarget: {
          id: 'local-edge',
          type: 'local_edge',
          name: 'Local Edge',
          status: 'healthy',
          route: 'local-edge-api',
          runnerCount: 1,
          onlineRunnerCount: 1,
          agentCount: 1,
          modelCount: 1,
          capabilityIds: ['streaming'],
        },
      });
    });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/web/execution-targets/local-target-current');
    expect(init.method).toBe('PATCH');
    const body = JSON.parse(String(init.body));
    expect(body).toEqual(expect.objectContaining({
      device_id: 'desktop-current',
      target_type: 'local_edge',
      trust_level: 'local',
    }));
    expect(body).not.toHaveProperty('health_state');
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

  it('does not select a sole local edge target when the desktop device id is missing', () => {
    const target = findRegisteredLocalEdgeTarget(
      [
        {
          id: 'local-only',
          device_id: 'desktop-other',
          name: 'Other desktop',
          target_type: 'local_edge',
          workspace_allowlist: [],
          trust_level: 'local',
          health_state: 'healthy',
          is_online: true,
        },
      ],
      null,
    );

    expect(target).toBeNull();
  });

  it('does not select a sole local edge target when the desktop device id mismatches', () => {
    const target = findRegisteredLocalEdgeTarget(
      [
        {
          id: 'local-only',
          device_id: 'desktop-other',
          name: 'Other desktop',
          target_type: 'local_edge',
          workspace_allowlist: [],
          trust_level: 'local',
          health_state: 'healthy',
          is_online: true,
        },
      ],
      'desktop-current',
    );

    expect(target).toBeNull();
  });

  it('loads subsequent Hub execution target pages before reporting inventory', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          code: 'ok',
          data: {
            items: [
              {
                id: 'relay-first-page',
                name: 'Relay',
                target_type: 'hub_relay',
                health_state: 'healthy',
                is_online: true,
              },
            ],
            page: { hasMore: true, nextCursor: 'cursor-2' },
          },
        }), {
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          code: 'ok',
          data: {
            items: [
              {
                id: 'local-second-page',
                device_id: 'desktop-current',
                name: 'Current desktop',
                target_type: 'local_edge',
                health_state: 'healthy',
                is_online: true,
              },
            ],
            page: { hasMore: false },
          },
        }), {
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const { result } = renderHook(
      () => useHubExecutionTargets({ enabled: true, getToken: () => 'tok', baseUrl: 'http://test.local' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items.map((target) => target.id)).toEqual([
      'relay-first-page',
      'local-second-page',
    ]);
    expect(fetchSpy.mock.calls[1]?.[0]).toBe('http://test.local/web/execution-targets?pageSize=50&pageCursor=cursor-2');
  });
});
