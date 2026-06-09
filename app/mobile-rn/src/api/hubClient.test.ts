import { describe, expect, it, vi } from 'vitest';

import {
  HubApiError,
  HubNetworkError,
  createHubClient,
  createHubWsUrl,
  createMockHubClient,
} from './hubClient';

import type { MobileAppFixture } from '@/types';

describe('Mobile Hub client facade', () => {
  it('maps REST base URLs to Hub event WebSocket URLs', () => {
    expect(createHubWsUrl('http://127.0.0.1:8080')).toBe('ws://127.0.0.1:8080/v1/events');
    expect(createHubWsUrl('https://hub.example.test')).toBe('wss://hub.example.test/v1/events');
    expect(createHubWsUrl('https://hub.example.test/api/')).toBe('wss://hub.example.test/v1/events');
    expect(createHubWsUrl('https://hub.example.test', { since: 'evt-9' })).toBe(
      'wss://hub.example.test/v1/events?since=evt-9',
    );
  });

  it('keeps Hub WebSocket URLs free of bearer tokens', () => {
    const url = createHubWsUrl('https://hub.example.test', { since: 'evt-9' });

    expect(url).not.toContain('access_token');
    expect(url).not.toContain('Bearer');
  });

  it('returns realistic mobile workflow snapshot data from the mock client', async () => {
    const snapshot = await createMockHubClient(0).getMobileSnapshot();

    expect(snapshot.threads.length).toBeGreaterThanOrEqual(3);
    expect(snapshot.runs.some((run) => run.status === 'approval_required')).toBe(true);
    expect(snapshot.transcript['mobile-design']?.some((block) => block.kind === 'diff')).toBe(true);
  });

  it('fetches a typed mobile snapshot with bearer auth', async () => {
    const responseBody: MobileAppFixture = {
      threads: [],
      runs: [],
      transcript: {},
      account: {
        tokenDanceId: 'signed_in',
        hubSession: 'active',
        notification: 'granted',
        hubSync: 'active',
        deviceLabel: 'TokenDance mobile test',
      },
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(responseBody), { status: 200 }));
    const client = createHubClient({
      baseUrl: 'https://hub.tokendance.test/api/',
      getAccessToken: async () => 'TokenDance-test-token',
      fetchImpl,
    });

    await expect(client.getMobileSnapshot()).resolves.toEqual(responseBody);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hub.tokendance.test/api/v1/mobile/snapshot',
      expect.objectContaining({
        headers: expect.objectContaining({
          accept: 'application/json',
          authorization: 'Bearer TokenDance-test-token',
        }),
        method: 'GET',
      }),
    );
  });

  it('does not add an auth header when no token is available', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const client = createHubClient({
      baseUrl: 'https://hub.tokendance.test',
      getAccessToken: async () => undefined,
      fetchImpl,
    });

    await client.getMobileSnapshot();

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hub.tokendance.test/v1/mobile/snapshot',
      expect.objectContaining({
        headers: {
          accept: 'application/json',
        },
      }),
    );
  });

  it('maps 401 and 500 responses to Hub API errors', async () => {
    const unauthorizedClient = createHubClient({
      baseUrl: 'https://hub.tokendance.test',
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'TokenDance session expired' } }), {
          status: 401,
          statusText: 'Unauthorized',
        }),
    });
    const serverErrorClient = createHubClient({
      baseUrl: 'https://hub.tokendance.test',
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: { code: 'hub_unavailable', message: 'Hub unavailable' } }), {
          status: 500,
          statusText: 'Internal Server Error',
        }),
    });

    await expect(unauthorizedClient.getMobileSnapshot()).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
      message: 'TokenDance session expired',
    });
    await expect(serverErrorClient.getMobileSnapshot()).rejects.toMatchObject({
      code: 'hub_unavailable',
      status: 500,
      message: 'Hub unavailable',
    });
    await expect(unauthorizedClient.getMobileSnapshot()).rejects.toBeInstanceOf(HubApiError);
  });

  it('redacts sensitive values from Hub API error messages and codes', async () => {
    const accessTokenKey = ['access', 'token'].join('_');
    const refreshTokenKey = ['refresh', 'token'].join('_');
    const clientSecretKey = ['client', 'secret'].join('_');
    const bearerValue = ['secret', 'token'].join('-');
    const accessValue = ['secret', 'access'].join('-');
    const refreshValue = ['secret', 'refresh'].join('-');
    const clientSecretValue = ['secret', 'client'].join('-');
    const client = createHubClient({
      baseUrl: 'https://hub.tokendance.test',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: {
              code: `upstream_${accessTokenKey}=secret-code`,
              message:
                `Authorization: Bearer ${bearerValue} ${accessTokenKey}=${accessValue} ${refreshTokenKey}=${refreshValue} ${clientSecretKey}=${clientSecretValue}`,
            },
          }),
          { status: 502, statusText: 'Bad Gateway' },
        ),
    });

    await expect(client.getMobileSnapshot()).rejects.toMatchObject({
      code: `upstream_${accessTokenKey}=[redacted]`,
      message:
        `Authorization: Bearer [redacted] ${accessTokenKey}=[redacted] ${refreshTokenKey}=[redacted] ${clientSecretKey}=[redacted]`,
    });
    await expect(client.getMobileSnapshot()).rejects.not.toMatchObject({
      message: expect.stringContaining(bearerValue),
    });
  });

  it('wraps transport failures as network errors', async () => {
    const client = createHubClient({
      baseUrl: 'https://hub.tokendance.test',
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });

    await expect(client.getMobileSnapshot()).rejects.toMatchObject({
      code: 'network_error',
      message: 'Network request to AgentHub failed',
    });
    await expect(client.getMobileSnapshot()).rejects.toBeInstanceOf(HubNetworkError);
  });
});
