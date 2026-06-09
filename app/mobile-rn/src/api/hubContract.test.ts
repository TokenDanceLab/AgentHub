import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { createHubClient } from './hubClient';

const contractToken = 'test-contract-token';
let server: Awaited<ReturnType<typeof startLocalHubServer>> | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('Mobile Hub REST contract', () => {
  it('calls real Hub API endpoints (/client/sessions, /client/contacts) with bearer auth', async () => {
    const sessionsData = [
      {
        session_id: 's-contract-1',
        type: 'private',
        name: 'Contract Test Session',
        unread_count: 2,
        last_message_at: '2026-06-10T10:00:00.000Z',
      },
    ];
    const contactsData: unknown[] = [];

    server = await startLocalHubServer((request, response) => {
      // Verify auth
      if (request.headers.authorization !== `Bearer ${contractToken}`) {
        writeJson(response, 401, {
          error: { code: 'AUTH_INVALID_TOKEN', message: 'token is invalid or expired' },
        });
        return;
      }

      // Route to Hub endpoints
      if (request.url === '/client/sessions') {
        writeJson(response, 200, { code: 'OK', data: sessionsData });
        return;
      }
      if (request.url === '/client/contacts') {
        writeJson(response, 200, { code: 'OK', data: contactsData });
        return;
      }

      writeJson(response, 404, { error: { code: 'NOT_FOUND', message: 'route not found' } });
    });

    const client = createHubClient({
      baseUrl: server.baseUrl,
      getAccessToken: async () => contractToken,
    });

    const snapshot = await client.getMobileSnapshot();

    expect(snapshot.threads).toHaveLength(1);
    expect(snapshot.threads[0]?.id).toBe('s-contract-1');
    expect(snapshot.threads[0]?.title).toBe('Contract Test Session');
    expect(snapshot.threads[0]?.unread).toBe(2);
  });

  it('rejects requests with invalid tokens', async () => {
    server = await startLocalHubServer((request, response) => {
      writeJson(response, 401, {
        error: { code: 'AUTH_INVALID_TOKEN', message: 'token is invalid or expired' },
      });
    });

    const client = createHubClient({
      baseUrl: server.baseUrl,
      getAccessToken: async () => 'expired-token',
    });

    // getMobileSnapshot catches errors and returns empty data
    const snapshot = await client.getMobileSnapshot();
    expect(snapshot.threads).toHaveLength(0);
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
