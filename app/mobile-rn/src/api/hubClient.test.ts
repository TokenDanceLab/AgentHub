import { describe, expect, it, vi } from 'vitest';

import {
  HubApiError,
  HubNetworkError,
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

  it('supports token-based WS auth via query parameter', () => {
    const url = createHubWsUrl('https://hub.example.test', { token: 'test-jwt-token' });
    expect(url).toContain('token=test-jwt-token');
  });

  it('keeps Hub WebSocket URLs free of bearer tokens in the path', () => {
    const url = createHubWsUrl('https://hub.example.test', { since: '123' });

    expect(url).not.toContain('access_token');
    expect(url).not.toContain('Bearer');
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
    ];
    const contactsResponse: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (url: string | Request | URL) => {
      const urlStr = String(url);
      if (urlStr.includes('/client/sessions')) {
        return new Response(JSON.stringify({ code: 'OK', data: sessionsResponse }), { status: 200 });
      }
      if (urlStr.includes('/client/contacts')) {
        return new Response(JSON.stringify({ code: 'OK', data: contactsResponse }), { status: 200 });
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
  });

  it('falls back to empty data when Hub API calls fail', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Network error');
    });
    const client = createHubClient({
      baseUrl: 'http://127.0.0.1:8080',
      fetchImpl,
    });

    const snapshot = await client.getMobileSnapshot();

    expect(snapshot.threads).toHaveLength(0);
    expect(snapshot.account.hubSession).toBe('active');
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
