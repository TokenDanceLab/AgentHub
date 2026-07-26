import { describe, expect, it, vi } from 'vitest';

import { WS_BEARER_SUBPROTOCOL } from './hubClient';
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
    this.onclose?.({ code: 1000, reason: 'test close' });
  }
}

describe('Mobile Hub event stream', () => {
  it('builds the Hub WS URL with /client/ws path and since cursor', () => {
    const sockets: FakeSocket[] = [];
    const statuses: string[] = [];
    const createWebSocket = vi.fn((url: string) => {
      const socket = new FakeSocket();
      sockets.push(socket);
      expect(url).toBe('wss://hub.example.test/client/ws?since=123');
      return socket;
    });

    createHubEventStream({
      baseUrl: 'https://hub.example.test/mobile/',
      since: '123',
      createWebSocket,
      onStatusChange: (status) => statuses.push(status),
    });

    expect(statuses).toEqual(['connecting']);
    sockets[0]?.emitOpen();

    expect(statuses).toEqual(['connecting', 'open']);
  });

  it('passes JWT via Sec-WebSocket-Protocol and keeps access_token out of URL', () => {
    const createWebSocket = vi.fn((_url: string, _protocols?: string[]) => new FakeSocket());

    createHubEventStream({
      baseUrl: 'https://hub.example.test',
      token: 'test-jwt',
      createWebSocket,
    });

    const url = createWebSocket.mock.calls[0]?.[0] as string;
    const protocols = createWebSocket.mock.calls[0]?.[1] as string[] | undefined;
    expect(new URL(url).searchParams.has('access_token')).toBe(false);
    expect(url).toBe('wss://hub.example.test/client/ws');
    expect(protocols).toEqual([WS_BEARER_SUBPROTOCOL, 'test-jwt']);
  });

  it('supports legacy access_token query fallback when opted in', () => {
    const createWebSocket = vi.fn((_url: string, _protocols?: string[]) => new FakeSocket());

    createHubEventStream({
      baseUrl: 'https://hub.example.test',
      token: 'test-jwt',
      useQueryTokenFallback: true,
      createWebSocket,
    });

    const url = createWebSocket.mock.calls[0]?.[0] as string;
    const protocols = createWebSocket.mock.calls[0]?.[1] as string[] | undefined;
    expect(new URL(url).searchParams.get('access_token')).toBe('test-jwt');
    // Protocol auth still preferred alongside legacy query fallback.
    expect(protocols).toEqual([WS_BEARER_SUBPROTOCOL, 'test-jwt']);
  });

  it('parses known Hub server event types (message.new, session.created, etc.)', () => {
    const socket = new FakeSocket();
    const events: unknown[] = [];
    const errors: unknown[] = [];

    createHubEventStream({
      baseUrl: 'http://127.0.0.1:8080',
      createWebSocket: () => socket,
      onEvent: (event) => events.push(event),
      onError: (error) => errors.push(error),
    });

    // Server frame format: { type, payload, seq_id }
    socket.emitMessage(
      JSON.stringify({
        type: 'message.new',
        payload: { session_id: 's1', content: 'hello' },
        seq_id: 42,
      }),
    );
    socket.emitMessage(
      JSON.stringify({
        type: 'session.created',
        payload: { session_id: 's2', name: 'New Chat' },
        seq_id: 43,
      }),
    );
    // Unknown type should be discarded
    socket.emitMessage(
      JSON.stringify({
        type: 'workspace.unknown',
        payload: { title: 'ignored' },
      }),
    );

    expect(events).toEqual([
      {
        type: 'message.new',
        payload: { session_id: 's1', content: 'hello' },
        seq_id: 42,
      },
      {
        type: 'session.created',
        payload: { session_id: 's2', name: 'New Chat' },
        seq_id: 43,
      },
    ]);
    expect(errors).toEqual([]);
  });

  it('discards removed Hub WS event names', () => {
    const socket = new FakeSocket();
    const events: unknown[] = [];

    createHubEventStream({
      baseUrl: 'http://127.0.0.1:8080',
      createWebSocket: () => socket,
      onEvent: (event) => events.push(event),
    });

    for (const type of [
      'auth',
      'auth.fail',
      'error',
      'sync.request',
      'sync.events',
      'agent.regenerate',
      'message.edited',
      'agent.timeout',
      'run.agent.plan_proposed',
      'run.agent.plan_approved',
      'run.agent.plan_rejected',
      'run.agent.plan_expired',
    ]) {
      socket.emitMessage(JSON.stringify({ type, payload: { should_not_arrive: true } }));
    }

    expect(events).toEqual([]);
  });

  it('reports parse and socket errors', () => {
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
    socket.emitError(new Error('fake socket failed'));

    expect(errors).toEqual([
      expect.objectContaining({
        kind: 'parse_error',
        message: 'Unable to parse Hub WebSocket event JSON',
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
        type: 'message.new',
        payload: { content: 'after close' },
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
