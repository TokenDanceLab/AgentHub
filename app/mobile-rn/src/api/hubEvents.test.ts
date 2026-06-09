import { describe, expect, it, vi } from 'vitest';

import { createHubEventStream, type HubWebSocketLike } from './hubEvents';

class FakeSocket implements HubWebSocketLike {
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  close = vi.fn();

  emitOpen() {
    this.onopen?.({ kind: 'open' });
  }

  emitMessage(data: unknown) {
    this.onmessage?.({ data });
  }

  emitError(error: unknown) {
    this.onerror?.(error);
  }

  emitClose() {
    this.onclose?.({ code: 1000, reason: 'TokenDance test close' });
  }
}

describe('Mobile Hub event stream', () => {
  it('builds the Hub event URL with a since cursor and emits open status', () => {
    const sockets: FakeSocket[] = [];
    const statuses: string[] = [];
    const createWebSocket = vi.fn((url: string) => {
      const socket = new FakeSocket();
      sockets.push(socket);
      expect(url).toBe('wss://hub.tokendance.test/v1/events?since=evt-Delicious233');
      return socket;
    });

    createHubEventStream({
      baseUrl: 'https://hub.tokendance.test/mobile/',
      since: 'evt-Delicious233',
      createWebSocket,
      onStatusChange: (status) => statuses.push(status),
    });

    expect(statuses).toEqual(['connecting']);
    sockets[0]?.emitOpen();

    expect(statuses).toEqual(['connecting', 'open']);
  });

  it('parses known JSON events and discards unknown event types', () => {
    const socket = new FakeSocket();
    const events: unknown[] = [];
    const errors: unknown[] = [];

    createHubEventStream({
      baseUrl: 'http://127.0.0.1:8080',
      createWebSocket: () => socket,
      onEvent: (event) => events.push(event),
      onError: (error) => errors.push(error),
    });

    socket.emitMessage(
      JSON.stringify({
        id: 'evt-TokenDance',
        type: 'thread.updated',
        createdAt: '2026-06-08T08:00:00.000Z',
        payload: { title: 'Delicious233 TokenDance thread' },
      }),
    );
    socket.emitMessage(
      JSON.stringify({
        id: 'evt-ignored',
        type: 'workspace.unknown',
        createdAt: '2026-06-08T08:01:00.000Z',
        payload: { title: 'ignored' },
      }),
    );

    expect(events).toEqual([
      {
        id: 'evt-TokenDance',
        type: 'thread.updated',
        createdAt: '2026-06-08T08:00:00.000Z',
        payload: { title: 'Delicious233 TokenDance thread' },
      },
    ]);
    expect(errors).toEqual([]);
  });

  it('reports parse and socket errors without needing a browser WebSocket', () => {
    const socket = new FakeSocket();
    const statuses: string[] = [];
    const errors: Array<{ kind: string; message: string }> = [];

    createHubEventStream({
      baseUrl: 'http://127.0.0.1:8080',
      createWebSocket: () => socket,
      onStatusChange: (status) => statuses.push(status),
      onError: (error) => errors.push(error),
    });

    socket.emitMessage('{not-json');
    socket.emitMessage(JSON.stringify({ id: 'evt-incomplete', type: 'run.updated' }));
    socket.emitError(new Error('TokenDance fake socket failed'));

    expect(errors).toEqual([
      expect.objectContaining({
        kind: 'parse_error',
        message: 'Unable to parse Hub WebSocket event JSON',
      }),
      expect.objectContaining({
        kind: 'invalid_event',
        message: 'Hub WebSocket event is missing required fields',
      }),
      expect.objectContaining({
        kind: 'socket_error',
        message: 'Hub WebSocket transport error',
      }),
    ]);
    expect(statuses).toEqual(['connecting', 'error']);
  });

  it('emits close status and clears socket handlers during cleanup', () => {
    const socket = new FakeSocket();
    const statuses: string[] = [];
    const events: unknown[] = [];
    const stream = createHubEventStream({
      baseUrl: 'http://127.0.0.1:8080',
      createWebSocket: () => socket,
      onStatusChange: (status) => statuses.push(status),
      onEvent: (event) => events.push(event),
    });

    stream.close();
    stream.close();
    socket.emitMessage(
      JSON.stringify({
        id: 'evt-after-close',
        type: 'run.updated',
        createdAt: '2026-06-08T08:02:00.000Z',
        payload: { title: 'TokenDance closed stream' },
      }),
    );

    expect(statuses).toEqual(['connecting', 'closed']);
    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(socket.onopen).toBeNull();
    expect(socket.onmessage).toBeNull();
    expect(socket.onerror).toBeNull();
    expect(socket.onclose).toBeNull();
    expect(events).toEqual([]);
  });

  it('emits close status when the runtime socket closes remotely', () => {
    const socket = new FakeSocket();
    const statuses: string[] = [];

    createHubEventStream({
      baseUrl: 'http://127.0.0.1:8080',
      createWebSocket: () => socket,
      onStatusChange: (status) => statuses.push(status),
    });

    socket.emitClose();
    socket.emitClose();

    expect(statuses).toEqual(['connecting', 'closed']);
    expect(socket.close).not.toHaveBeenCalled();
  });
});
