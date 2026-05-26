import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@shared/errors';
import { createHubClient } from './hubClient';

describe('createHubClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('unwraps Hub response envelopes for typed callers', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({
        code: 'ok',
        data: {
          access_token: 'hub-access',
          refresh_token: 'hub-refresh',
          expires_in: 3600,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const client = createHubClient({ baseUrl: 'https://hub.example.test' });
    const res = await client.login({
      username: 'alice',
      password: 'secret',
      device_type: 'web',
      device_id: '00000000-0000-0000-0000-00000000a101',
    });

    expect(res).toEqual({
      access_token: 'hub-access',
      refresh_token: 'hub-refresh',
      expires_in: 3600,
    });
  });

  it('keeps legacy bare JSON compatibility', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({
        id: '00000000-0000-0000-0000-00000000b101',
        username: 'alice',
        nickname: 'Alice',
        avatar_url: '',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));

    const client = createHubClient({ baseUrl: 'https://hub.example.test' });
    await expect(client.me()).resolves.toMatchObject({ username: 'alice' });
  });

  it('converts Hub error envelopes into AppError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ code: 'unauthorized', message: 'bad token' }),
      { status: 401, statusText: 'Unauthorized', headers: { 'Content-Type': 'application/json' } },
    )));

    const client = createHubClient({ baseUrl: 'https://hub.example.test' });

    await expect(client.me()).rejects.toMatchObject({
      code: 'unauthorized',
      message: 'bad token',
      status: 401,
    });
    await expect(client.me()).rejects.toBeInstanceOf(AppError);
  });

  it('lists Hub execution targets with typed query params', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({
        code: 'ok',
        data: {
          items: [
            {
              id: '00000000-0000-0000-0000-00000000e101',
              owner_id: '00000000-0000-0000-0000-00000000u101',
              name: 'Workstation',
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
    ));
    vi.stubGlobal('fetch', fetchMock);

    const client = createHubClient({
      baseUrl: 'https://hub.example.test',
      getToken: () => 'hub-access',
    });
    const res = await client.listExecutionTargets({
      target_type: 'local_edge',
      pageCursor: 'cursor-1',
      pageSize: 20,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://hub.example.test/web/execution-targets?target_type=local_edge&pageCursor=cursor-1&pageSize=20',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer hub-access' }),
      }),
    );
    expect(res.items[0]).toMatchObject({
      name: 'Workstation',
      target_type: 'local_edge',
      health_state: 'healthy',
      is_online: true,
    });
  });

  it('pings a Hub execution target through the owner-scoped Hub route', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ code: 'ok', data: null }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const client = createHubClient({
      baseUrl: 'https://hub.example.test',
      getToken: () => 'hub-access',
    });
    await client.pingExecutionTarget('target/id');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://hub.example.test/web/execution-targets/target%2Fid/ping',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer hub-access' }),
      }),
    );
  });
});
