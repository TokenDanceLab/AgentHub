import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccessToken } from '@/hooks/useAuth';
import {
  fetchExecutionTargets,
  summarizeExecutionTargets,
  type ExecutionTargetInventoryItem,
} from './executionTargetQueries';
import { getAuthorization } from '@/__tests__/requestInitTestUtils';

vi.mock('@/hooks/useAuth', () => ({
  getAccessToken: vi.fn(),
}));

describe('web execution target queries', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.mocked(getAccessToken).mockReturnValue(null);
  });

  it('fetches real Hub execution target inventory when a Hub session token is available', async () => {
    vi.mocked(getAccessToken).mockReturnValue('hub-access');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://localhost:8080/web/execution-targets?pageSize=50');
      expect(getAuthorization(init)).toBe('Bearer hub-access');
      return new Response(
        JSON.stringify({
          code: 'ok',
          data: {
            items: [
              {
                id: '00000000-0000-0000-0000-00000000e201',
                owner_id: '00000000-0000-0000-0000-00000000u201',
                name: 'Desktop Edge',
                target_type: 'local_edge',
                workspace_allowlist: '["D:\\\\Code"]',
                trust_level: 'local',
                health_state: 'online',
                is_online: true,
              },
            ],
            page: { hasMore: false },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchExecutionTargets(true);

    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      name: 'Desktop Edge',
      target_type: 'local_edge',
      workspace_allowlist: ['D:\\Code'],
      health_state: 'online',
      is_online: true,
    });
  });

  it('walks cursor pages up to the shared 50x10 cap and reports hasMore honestly', async () => {
    vi.mocked(getAccessToken).mockReturnValue('hub-access');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          code: 'ok',
          data: {
            items: [{
              id: '00000000-0000-0000-0000-00000000e101',
              name: 'Page 1 Target',
              target_type: 'local_edge',
              workspace_allowlist: [],
              trust_level: 'local',
              health_state: 'online',
              is_online: true,
            }],
            page: { hasMore: true, nextCursor: 'cur-1' },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          code: 'ok',
          data: {
            items: [{
              id: '00000000-0000-0000-0000-00000000e102',
              name: 'Page 2 Target',
              target_type: 'remote_ssh',
              workspace_allowlist: [],
              trust_level: 'remote',
              health_state: 'healthy',
              is_online: false,
            }],
            page: { hasMore: false },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchExecutionTargets(true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://localhost:8080/web/execution-targets?pageSize=50');
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('http://localhost:8080/web/execution-targets?pageSize=50&pageCursor=cur-1');
    expect(res.items).toHaveLength(2);
    expect(res.page.hasMore).toBe(false);
  });

  it('reports hasMore=true after exhausting the maximum cursor pages', async () => {
    vi.mocked(getAccessToken).mockReturnValue('hub-access');
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({
        code: 'ok',
        data: {
          items: [{
            id: '00000000-0000-0000-0000-00000000e201',
            name: 'Always More',
            target_type: 'local_edge',
            workspace_allowlist: [],
            trust_level: 'local',
            health_state: 'registered',
            is_online: false,
          }],
          page: { hasMore: true, nextCursor: 'cur-next' },
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchExecutionTargets(true);

    expect(fetchMock).toHaveBeenCalledTimes(10);
    expect(res.items).toHaveLength(10);
    expect(res.page.hasMore).toBe(true);
  });

  it('does not fall back to static target previews when Hub auth is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchExecutionTargets(true);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.items).toEqual([]);
    expect(res.page.hasMore).toBe(false);
  });

  it('summarizes target counts and health from Hub inventory', () => {
    const targets: ExecutionTargetInventoryItem[] = [
      {
        id: 'local-1',
        name: 'Local',
        target_type: 'local_edge',
        workspace_allowlist: [],
        health_state: 'online',
        trust_level: 'local',
        is_online: true,
      },
      {
        id: 'relay-1',
        name: 'Relay',
        target_type: 'hub_relay',
        workspace_allowlist: [],
        health_state: 'degraded',
        trust_level: 'relay',
        is_online: true,
      },
      {
        id: 'remote-1',
        name: 'Remote',
        target_type: 'remote_ssh',
        workspace_allowlist: [],
        health_state: 'offline',
        trust_level: 'remote',
        is_online: false,
      },
      {
        id: 'cloud-1',
        name: 'Cloud',
        target_type: 'cloud_edge',
        workspace_allowlist: [],
        health_state: 'mismatch',
        trust_level: 'cloud',
        is_online: false,
      },
      {
        id: 'tailscale-1',
        name: 'Tailscale',
        target_type: 'tailscale',
        workspace_allowlist: [],
        health_state: 'stale',
        trust_level: 'remote',
        is_online: true,
      },
    ];

    expect(summarizeExecutionTargets(targets)).toEqual({
      total: 5,
      online: 3,
      healthy: 1,
      degraded: 1,
      offline: 1,
      mismatch: 1,
      stale: 1,
      unknown: 0,
      byType: {
        local_edge: 1,
        hub_relay: 1,
        remote_ssh: 1,
        tailscale: 1,
        cloud_edge: 1,
      },
    });
  });

  it('surfaces 401 unauthorized from execution target inventory as AppError', async () => {
    vi.mocked(getAccessToken).mockReturnValue('stale-token');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: 'unauthorized', message: 'bad token' }), {
            status: 401,
            statusText: 'Unauthorized',
            headers: { 'Content-Type': 'application/json' },
          })
      )
    );

    await expect(fetchExecutionTargets(true)).rejects.toMatchObject({
      code: 'unauthorized',
      message: 'bad token',
      status: 401,
    });
  });

  it.each([
    ['NOT_FOUND', 404, 'Not Found', 'targets missing'],
    ['INTERNAL_ERROR', 500, 'Internal Server Error', 'hub down'],
  ])('surfaces %s from execution target inventory as AppError', async (code, status, statusText, message) => {
    vi.mocked(getAccessToken).mockReturnValue('hub-access');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code, message }), {
            status,
            statusText,
            headers: { 'Content-Type': 'application/json' },
          })
      )
    );

    await expect(fetchExecutionTargets(true)).rejects.toMatchObject({
      code,
      status,
    });
  });

  it('normalizes malformed inventory fields without leaking backend dialects into UI state', async () => {
    vi.mocked(getAccessToken).mockReturnValue('hub-access');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: 'OK',
              data: {
                items: [
                  {
                    id: 'array',
                    name: 'Array',
                    target_type: 'remote_ssh',
                    workspace_allowlist: [' /workspace ', '', 4],
                    trust_level: 'cloud',
                    health_state: 'healthy',
                    is_online: true,
                  },
                  {
                    id: 'bad-json',
                    name: 'Bad JSON',
                    target_type: 'bogus',
                    workspace_allowlist: '[bad',
                    trust_level: 'bogus',
                    health_state: 'bogus',
                    is_online: 1,
                  },
                  {
                    id: 'empty',
                    name: 'Empty',
                    target_type: undefined,
                    workspace_allowlist: '',
                    trust_level: undefined,
                    health_state: undefined,
                    is_online: false,
                  },
                  {
                    id: 'object',
                    name: 'Object',
                    target_type: 'tailscale',
                    workspace_allowlist: '{"not":"array"}',
                    trust_level: 'remote',
                    health_state: 'stale',
                    is_online: false,
                  },
                ],
                page: { hasMore: false },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
      )
    );

    const result = await fetchExecutionTargets(true);
    expect(result.items).toMatchObject([
      {
        target_type: 'remote_ssh',
        workspace_allowlist: [' /workspace '],
        trust_level: 'cloud',
        health_state: 'healthy',
        is_online: true,
      },
      {
        target_type: 'local_edge',
        workspace_allowlist: [],
        trust_level: 'local',
        health_state: 'unknown',
        is_online: false,
      },
      {
        target_type: 'local_edge',
        workspace_allowlist: [],
        trust_level: 'local',
        health_state: 'unknown',
        is_online: false,
      },
      {
        target_type: 'tailscale',
        workspace_allowlist: [],
        trust_level: 'remote',
        health_state: 'stale',
        is_online: false,
      },
    ]);
  });

  it('keeps registered health states in the pass-through instead of collapsing to unknown', async () => {
    vi.mocked(getAccessToken).mockReturnValue('hub-access');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: 'ok',
              data: {
                items: [
                  {
                    id: 'registered-1',
                    name: 'Bound but not proven live',
                    target_type: 'local_edge',
                    workspace_allowlist: [],
                    trust_level: 'local',
                    health_state: 'registered',
                    is_online: false,
                  },
                ],
                page: { hasMore: false },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
      )
    );

    const result = await fetchExecutionTargets(true);
    expect(result.items[0]?.health_state).toBe('registered');
  });

  it('counts unknown health states and preserves zero-filled type buckets', () => {
    expect(
      summarizeExecutionTargets([
        {
          id: 'unknown',
          name: 'Unknown',
          target_type: 'local_edge',
          workspace_allowlist: [],
          trust_level: 'local',
          health_state: 'unexpected',
          is_online: false,
        },
      ])
    ).toMatchObject({
      total: 1,
      unknown: 1,
      online: 0,
      byType: { local_edge: 1, hub_relay: 0, remote_ssh: 0, tailscale: 0, cloud_edge: 0 },
    });
  });
});
