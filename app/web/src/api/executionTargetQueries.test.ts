import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccessToken } from '@/hooks/useAuth';
import {
  fetchExecutionTargets,
  summarizeExecutionTargets,
  type ExecutionTargetInventoryItem,
} from './executionTargetQueries';

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
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer hub-access' });
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
                health_state: 'healthy',
                is_online: true,
              },
            ],
            page: { hasMore: false },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchExecutionTargets(true);

    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      name: 'Desktop Edge',
      target_type: 'local_edge',
      workspace_allowlist: ['D:\\Code'],
      health_state: 'healthy',
      is_online: true,
    });
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
        health_state: 'healthy',
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
        health_state: 'unknown',
        trust_level: 'cloud',
        is_online: false,
      },
    ];

    expect(summarizeExecutionTargets(targets)).toEqual({
      total: 4,
      online: 2,
      healthy: 1,
      degraded: 1,
      offline: 1,
      unknown: 1,
      byType: {
        local_edge: 1,
        hub_relay: 1,
        remote_ssh: 1,
        tailscale: 0,
        cloud_edge: 1,
      },
    });
  });
});
