import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { HubApiError, createHubClient } from './hubClient';

import type { MobileAppFixture } from '@/types';

const snapshotBody: MobileAppFixture = {
  threads: [
    {
      id: 'delicious233-thread',
      title: 'Delicious233 mobile review',
      subtitle: 'TokenDance local Hub contract',
      initials: 'D2',
      unread: 1,
      participantKind: 'agent',
      status: 'online',
      lastActivity: '2026-06-08T08:00:00.000Z',
    },
  ],
  runs: [
    {
      id: 'tokendance-run',
      threadId: 'delicious233-thread',
      title: 'TokenDance snapshot sync',
      status: 'approval_required',
      target: 'TokenDance local Hub',
      updatedAt: '2026-06-08T08:01:00.000Z',
      summary: 'Delicious233 is reviewing the mobile Hub contract.',
      changedFiles: ['app/mobile-rn/src/api/hubContract.test.ts'],
    },
  ],
  transcript: {},
  account: {
    tokenDanceId: 'signed_in',
    hubSession: 'active',
    notification: 'granted',
    hubSync: 'active',
    deviceLabel: 'Delicious233 TokenDance device',
  },
};

const contractToken = 'TokenDance-local-contract-token';
const requestHeaders: Array<string | undefined> = [];
let server: Awaited<ReturnType<typeof startLocalHubServer>> | undefined;

afterEach(async () => {
  requestHeaders.length = 0;
  await server?.close();
  server = undefined;
});

describe('Mobile Hub REST contract', () => {
  it('uses real local HTTP fetch for bearer auth, snapshot JSON, and API error JSON', async () => {
    server = await startLocalHubServer((request, response) => {
      requestHeaders.push(request.headers.authorization);

      if (request.url !== '/v1/mobile/snapshot') {
        writeJson(response, 404, { error: { code: 'not_found', message: 'TokenDance route not found' } });
        return;
      }

      if (request.headers.authorization !== `Bearer ${contractToken}`) {
        writeJson(response, 401, {
          error: {
            code: 'unauthorized',
            message: 'TokenDance session expired',
          },
        });
        return;
      }

      writeJson(response, 200, snapshotBody);
    });
    const client = createHubClient({
      baseUrl: server.baseUrl,
      getAccessToken: async () => contractToken,
    });

    await expect(client.getMobileSnapshot()).resolves.toEqual(snapshotBody);
    expect(requestHeaders).toContain(`Bearer ${contractToken}`);

    const unauthorizedClient = createHubClient({
      baseUrl: server.baseUrl,
      getAccessToken: async () => 'TokenDance-expired-contract-token',
    });

    await expect(unauthorizedClient.getMobileSnapshot()).rejects.toMatchObject({
      code: 'unauthorized',
      message: 'TokenDance session expired',
      retryable: false,
      status: 401,
    });
    await expect(unauthorizedClient.getMobileSnapshot()).rejects.toBeInstanceOf(HubApiError);
  });
});

async function startLocalHubServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const localServer = createServer(handler);

  await new Promise<void>((resolve, reject) => {
    localServer.once('error', reject);
    localServer.listen(0, '127.0.0.1', () => {
      localServer.off('error', reject);
      resolve();
    });
  });

  const address = localServer.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
  };
}

function writeJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}
