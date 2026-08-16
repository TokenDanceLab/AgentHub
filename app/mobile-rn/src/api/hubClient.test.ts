import { describe, expect, it, vi } from 'vitest';

import {
  HubApiError,
  HubNetworkError,
  WS_BEARER_SUBPROTOCOL,
  buildWSAuthProtocols,
  createHubClient,
  createHubWsUrl,
  createMockHubClient,
} from './hubClient';

describe('Mobile Hub client facade', () => {
  it('maps REST base URLs to Hub WebSocket URLs with /client/ws path', () => {
    expect(createHubWsUrl('http://127.0.0.1:8080')).toBe('ws://127.0.0.1:8080/client/ws');
    expect(createHubWsUrl('https://hub.example.test')).toBe('wss://hub.example.test/client/ws');
    expect(createHubWsUrl('https://hub.example.test/api/')).toBe('wss://hub.example.test/client/ws');
    expect(createHubWsUrl('https://hub.example.test', { since: '123' })).toBe(
      'wss://hub.example.test/client/ws?since=123',
    );
  });

  it('buildWSAuthProtocols returns agenthub.bearer.v1 + jwt', () => {
    expect(buildWSAuthProtocols('jwt.token.here')).toEqual([
      WS_BEARER_SUBPROTOCOL,
      'jwt.token.here',
    ]);
    expect(buildWSAuthProtocols(null)).toBeUndefined();
    expect(buildWSAuthProtocols(undefined)).toBeUndefined();
    expect(buildWSAuthProtocols('')).toBeUndefined();
  });

  it('does not put token in query by default (prefer Sec-WebSocket-Protocol)', () => {
    const url = createHubWsUrl('https://hub.example.test', { token: 'test-jwt-token' });
    const parsed = new URL(url);
    expect(parsed.searchParams.has('access_token')).toBe(false);
    expect(parsed.searchParams.has('token')).toBe(false);
    expect(url).toBe('wss://hub.example.test/client/ws');
  });

  it('supports legacy token-based WS auth via access_token query when opted in', () => {
    const url = createHubWsUrl('https://hub.example.test', {
      token: 'test-jwt-token',
      useQueryTokenFallback: true,
    });
    const parsed = new URL(url);
    // Hub WSAuthMiddleware accepts access_token (or Authorization Bearer), not "token".
    expect(parsed.searchParams.get('access_token')).toBe('test-jwt-token');
    expect(parsed.searchParams.has('token')).toBe(false);
  });

  it('keeps Hub WebSocket URLs free of bearer tokens when no token is provided', () => {
    const url = createHubWsUrl('https://hub.example.test', { since: '123' });
    const parsed = new URL(url);

    expect(parsed.searchParams.has('access_token')).toBe(false);
    expect(url).not.toContain('Bearer');
  });

  it('awaits token resolution before authenticated API calls (no one-shot race)', async () => {
    let resolveToken!: (value: string) => void;
    const delayedToken = new Promise<string>((resolve) => {
      resolveToken = resolve;
    });
    const authHeaders: Array<string | null> = [];
    const fetchImpl = vi.fn(async (_url: string | Request | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      authHeaders.push(headers.get('Authorization'));
      return new Response(JSON.stringify({ code: 'OK', data: [] }), { status: 200 });
    });
    const client = createHubClient({
      baseUrl: 'http://127.0.0.1:8080',
      getAccessToken: () => delayedToken,
      fetchImpl,
    });

    const sessionsPromise = client.listSessions();
    // Give the client a chance to race if it does not await token resolution.
    await Promise.resolve();
    expect(fetchImpl).not.toHaveBeenCalled();

    resolveToken('resolved-token');
    await sessionsPromise;

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(authHeaders[0]).toBe('Bearer resolved-token');
  });

  it('refreshes token via onRefreshToken on 401 and retries once', async () => {
    const refresh = vi.fn(async () => 'refreshed-token');
    let calls = 0;
    const fetchImpl = vi.fn(async (_url: string | Request | URL, init?: RequestInit) => {
      calls += 1;
      const headers = new Headers(init?.headers);
      if (calls === 1) {
        expect(headers.get('Authorization')).toBe('Bearer stale-token');
        return new Response(
          JSON.stringify({ error: { code: 'AUTH_INVALID_TOKEN', message: 'expired' } }),
          { status: 401 },
        );
      }
      expect(headers.get('Authorization')).toBe('Bearer refreshed-token');
      return new Response(
        JSON.stringify({
          code: 'OK',
          data: { id: 'u1', username: 'alice', nickname: 'Alice' },
        }),
        { status: 200 },
      );
    });
    const client = createHubClient({
      baseUrl: 'http://127.0.0.1:8080',
      getAccessToken: async () => 'stale-token',
      onRefreshToken: refresh,
      fetchImpl,
    });

    const profile = await client.me();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(profile.id).toBe('u1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('clears cached token on logout', async () => {
    let token: string | null = 'active-token';
    const authHeaders: Array<string | null> = [];
    const fetchImpl = vi.fn(async (url: string | Request | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      authHeaders.push(headers.get('Authorization'));
      const urlStr = String(url);
      if (urlStr.includes('/client/auth/logout')) {
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({ code: 'OK', data: [] }), { status: 200 });
    });
    const client = createHubClient({
      baseUrl: 'http://127.0.0.1:8080',
      getAccessToken: async () => token,
      fetchImpl,
    });

    await client.listSessions();
    expect(authHeaders[0]).toBe('Bearer active-token');

    token = null;
    await client.logout();
    await client.listSessions();

    // After logout cache clear + provider returning null, no Authorization header.
    expect(authHeaders[authHeaders.length - 1]).toBeNull();
  });

  it('returns realistic mobile workflow snapshot data from the mock client', async () => {
    const snapshot = await createMockHubClient(0).getMobileSnapshot();

    expect(snapshot.threads.length).toBeGreaterThanOrEqual(3);
    expect(snapshot.runs.some((run) => run.status === 'approval_required')).toBe(true);
    expect(snapshot.transcript['mobile-design']?.some((block) => block.kind === 'diff')).toBe(true);
  });

  it('delegates to the shared Hub client for real API calls', async () => {
    const sessionsResponse = [
      { session_id: 's1', type: 'private', name: 'Test Chat', unread_count: 3 },
      // Sessions without any id must be filtered out (no `id: ''` threads).
      { type: 'private', name: 'No ID Session' },
    ];
    const fetchImpl = vi.fn(async (url: string | Request | URL) => {
      const urlStr = String(url);
      if (urlStr.includes('/client/sessions')) {
        return new Response(JSON.stringify({ code: 'OK', data: sessionsResponse }), { status: 200 });
      }
      return new Response(JSON.stringify({ code: 'OK', data: [] }), { status: 200 });
    });
    const client = createHubClient({
      baseUrl: 'http://127.0.0.1:8080',
      getAccessToken: async () => 'test-token',
      fetchImpl,
    });

    const snapshot = await client.getMobileSnapshot();

    expect(snapshot.threads).toHaveLength(1);
    expect(snapshot.threads[0]?.id).toBe('s1');
    expect(snapshot.threads[0]?.title).toBe('Test Chat');
    expect(snapshot.threads[0]?.unread).toBe(3);
    expect(snapshot.account.hubSession).toBe('active');
    // Snapshot needs a single RTT: sessions only, no discarded contacts call.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('falls back to empty data and degraded account state when Hub API calls fail', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Network error');
    });
    const client = createHubClient({
      baseUrl: 'http://127.0.0.1:8080',
      fetchImpl,
    });

    const snapshot = await client.getMobileSnapshot();

    expect(snapshot.threads).toHaveLength(0);
    // Account no longer claims an active session when the Hub is unreachable.
    expect(snapshot.account.tokenDanceId).toBe('recovering');
    expect(snapshot.account.hubSession).toBe('missing');
    expect(snapshot.account.hubSync).toBe('offline');
  });

  it('preserves HubApiError and HubNetworkError classes', () => {
    const apiError = new HubApiError({
      code: 'unauthorized',
      message: 'Session expired',
      status: 401,
      retryable: false,
    });

    expect(apiError).toBeInstanceOf(HubApiError);
    expect(apiError.code).toBe('unauthorized');
    expect(apiError.status).toBe(401);
    expect(apiError.retryable).toBe(false);

    const networkError = new HubNetworkError('Network request to AgentHub failed', new Error('cause'));

    expect(networkError).toBeInstanceOf(HubNetworkError);
    expect(networkError.code).toBe('network_error');
    expect(networkError.retryable).toBe(true);
  });
});

describe('Mobile preview snapshot glue', () => {
  const previewSnapshot = {
    threads: [{ id: 't1', title: 'Preview Thread', subtitle: 's', initials: 'PT', unread: 1, participantKind: 'group', status: 'online', lastActivity: '14:00' }],
    runs: [{ id: 'r1', threadId: 't1', title: 'Preview Run', status: 'approval_required', target: 'app/mobile-rn', updatedAt: '14:01', summary: 's', changedFiles: [] }],
    transcript: { t1: [] },
    account: {
      tokenDanceId: 'signed_in',
      hubSession: 'active',
      notification: 'prompt',
      hubSync: 'active',
      deviceLabel: 'TokenDance mobile preview',
    },
  };

  it('fetches the mock Hub mobile snapshot route and returns the parsed fixture', async () => {
    const fetchImpl = vi.fn(async (url: string | Request | URL) => {
      expect(String(url)).toBe('http://127.0.0.1:8088/v1/mobile/snapshot');
      return new Response(JSON.stringify(previewSnapshot), { status: 200 });
    });
    const client = createHubClient({
      baseUrl: 'http://127.0.0.1:8088',
      fetchImpl,
    });

    const snapshot = await client.getPreviewSnapshot();

    expect(snapshot.threads).toHaveLength(1);
    expect(snapshot.runs[0]?.status).toBe('approval_required');
    expect(snapshot.account.deviceLabel).toBe('TokenDance mobile preview');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails loudly with HubNetworkError when the snapshot route is unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Network error');
    });
    const client = createHubClient({
      baseUrl: 'http://127.0.0.1:8088',
      fetchImpl,
    });

    await expect(client.getPreviewSnapshot()).rejects.toBeInstanceOf(HubNetworkError);
  });

  it('fails loudly with HubApiError when the snapshot route responds with an error status', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: 'not_found', message: 'missing' } }), { status: 404 }));
    const client = createHubClient({
      baseUrl: 'http://127.0.0.1:8088',
      fetchImpl,
    });

    await expect(client.getPreviewSnapshot()).rejects.toMatchObject({ code: 'snapshot_unavailable', status: 404 });
  });

  it('rejects malformed snapshot payloads instead of rendering them', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ threads: 'not-an-array' }), { status: 200 }));
    const client = createHubClient({
      baseUrl: 'http://127.0.0.1:8088',
      fetchImpl,
    });

    await expect(client.getPreviewSnapshot()).rejects.toBeInstanceOf(HubApiError);
  });
});
