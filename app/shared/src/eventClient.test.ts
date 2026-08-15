import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transport, TransportStatus } from './transport';
import { createEventStream } from './eventClient';
import type { EventEnvelope } from './events';

const OPEN = 1;
const CONNECTING = 0;
const CLOSED = 3;

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static CONNECTING = CONNECTING;
  static OPEN = OPEN;
  static CLOSING = 2;
  static CLOSED = CLOSED;

  readonly url: string;
  readonly protocols: string | string[] | undefined;
  readyState = CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    MockWebSocket.instances.push(this);
  }

  open() {
    this.readyState = OPEN;
    this.onopen?.();
  }

  receive(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }

  receiveRaw(data: string) {
    this.onmessage?.({ data } as MessageEvent<string>);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = CLOSED;
    this.onclose?.();
  }
}

function envelope(
  seq: number | undefined,
  type: string,
  payload: Record<string, unknown> = {},
): EventEnvelope {
  return {
    version: 'v1',
    id: `evt_${type}_${seq ?? 'noseq'}`,
    seq: seq as number,
    type,
    scope: {},
    sentAt: '2026-05-24T10:00:00.000Z',
    payload,
  };
}

const DEFAULT_BASE_URL = 'ws://localhost:3210/v1/events';

interface FakeTransportState {
  status: TransportStatus;
  sent: unknown[];
  connectCalls: number;
  closeCalls: number;
  messageHandlers: Set<(data: unknown) => void>;
  statusHandlers: Set<(status: TransportStatus) => void>;
}

function createFakeTransport(): {
  transport: Transport;
  state: FakeTransportState;
  emitMessage: (data: unknown) => void;
  emitStatus: (status: TransportStatus) => void;
} {
  const state: FakeTransportState = {
    status: 'disconnected',
    sent: [],
    connectCalls: 0,
    closeCalls: 0,
    messageHandlers: new Set(),
    statusHandlers: new Set(),
  };
  const transport: Transport = {
    connect: () => {
      state.connectCalls += 1;
    },
    send: (data: unknown) => {
      state.sent.push(data);
    },
    close: () => {
      state.closeCalls += 1;
    },
    on: (event, handler) => {
      if (event === 'message') {
        const messageHandler = handler as (data: unknown) => void;
        state.messageHandlers.add(messageHandler);
        return () => state.messageHandlers.delete(messageHandler);
      }
      const statusHandler = handler as (status: TransportStatus) => void;
      state.statusHandlers.add(statusHandler);
      return () => state.statusHandlers.delete(statusHandler);
    },
    getStatus: () => state.status,
  };
  return {
    transport,
    state,
    emitMessage: (data: unknown) => {
      for (const handler of state.messageHandlers) handler(data);
    },
    emitStatus: (status: TransportStatus) => {
      state.status = status;
      for (const handler of state.statusHandlers) handler(status);
    },
  };
}

describe('createEventStream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('connects to the default Edge event endpoint when no URL is given', () => {
    const stream = createEventStream();
    expect(MockWebSocket.instances[0]?.url).toBe(
      'ws://127.0.0.1:3210/v1/events',
    );
    stream.close();
  });

  it('encodes an initial cursor into the WebSocket URL', () => {
    const stream = createEventStream('seq 1/2', { baseUrl: DEFAULT_BASE_URL });

    expect(MockWebSocket.instances[0]?.url).toBe(
      `${DEFAULT_BASE_URL}?cursor=seq%201%2F2`,
    );
    stream.close();
  });

  it('treats a ws(s):// positional argument as the base URL', () => {
    const stream = createEventStream('wss://example.test/stream?cursor=7');

    expect(MockWebSocket.instances[0]?.url).toBe(
      'wss://example.test/stream?cursor=7',
    );
    stream.close();
  });

  it('advances and reuses the replay cursor across reconnects', async () => {
    const stream = createEventStream(undefined, {
      baseUrl: DEFAULT_BASE_URL,
      baseDelayMs: 5,
      maxDelayMs: 5,
    });

    MockWebSocket.instances[0]?.receive(envelope(42, 'run.output'));

    MockWebSocket.instances[0]?.close();
    await vi.advanceTimersByTimeAsync(10);

    expect(MockWebSocket.instances[1]?.url).toBe(
      `${DEFAULT_BASE_URL}?cursor=42`,
    );
    stream.close();
  });

  it('keeps the initial cursor when events lack a numeric seq', async () => {
    const stream = createEventStream('7', {
      baseUrl: DEFAULT_BASE_URL,
      baseDelayMs: 5,
      maxDelayMs: 5,
    });

    MockWebSocket.instances[0]?.receive(envelope(undefined, 'error'));

    MockWebSocket.instances[0]?.close();
    await vi.advanceTimersByTimeAsync(10);

    expect(MockWebSocket.instances[1]?.url).toBe(
      `${DEFAULT_BASE_URL}?cursor=7`,
    );
    stream.close();
  });

  it('dispatches system.gap events without polluting the replay cursor', async () => {
    const stream = createEventStream(undefined, {
      baseUrl: DEFAULT_BASE_URL,
      baseDelayMs: 5,
      maxDelayMs: 5,
    });
    const handler = vi.fn();
    stream.subscribe(handler);

    MockWebSocket.instances[0]?.receive(
      envelope(0, 'system.gap', {
        firstDroppedSeq: 43,
        lastDroppedSeq: 45,
        droppedCount: 3,
      }),
    );
    expect(handler).toHaveBeenCalledTimes(1);

    MockWebSocket.instances[0]?.close();
    await vi.advanceTimersByTimeAsync(10);

    expect(MockWebSocket.instances[1]?.url).toBe(DEFAULT_BASE_URL);
    stream.close();
  });

  it('drops replayed events with seq <= lastSeq (idempotent dedup)', () => {
    const stream = createEventStream(undefined, { baseUrl: DEFAULT_BASE_URL });
    const dispatched: Array<{ type: string; seq: number | undefined }> = [];
    stream.subscribe((event) => {
      dispatched.push({ type: event.type, seq: event.seq });
    });

    const ws = MockWebSocket.instances[0];
    ws?.receive(envelope(10, 'run.output'));
    ws?.receive(envelope(10, 'run.output'));
    ws?.receive(envelope(11, 'run.finished'));

    expect(dispatched).toEqual([
      { type: 'run.output', seq: 10 },
      { type: 'run.finished', seq: 11 },
    ]);
    stream.close();
  });

  it('gives up reconnecting after maxRetries', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stream = createEventStream(undefined, {
      baseUrl: DEFAULT_BASE_URL,
      baseDelayMs: 5,
      maxDelayMs: 5,
      maxRetries: 2,
    });

    MockWebSocket.instances[0]?.close();
    await vi.advanceTimersByTimeAsync(10);
    MockWebSocket.instances[1]?.close();
    await vi.advanceTimersByTimeAsync(10);
    MockWebSocket.instances[2]?.close();
    await vi.advanceTimersByTimeAsync(20);

    expect(MockWebSocket.instances).toHaveLength(3);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Max retries (2) reached'),
    );
    stream.close();
    consoleSpy.mockRestore();
  });

  it('sends heartbeat pings and measures pong latency', () => {
    const stream = createEventStream(undefined, {
      baseUrl: DEFAULT_BASE_URL,
      pingIntervalMs: 100,
      pongTimeoutMs: 50,
    });
    const ws = MockWebSocket.instances[0];
    ws?.open();

    vi.advanceTimersByTime(100);
    expect(ws?.sent.length).toBe(1);
    expect(JSON.parse(ws?.sent[0] ?? '{}')).toMatchObject({ type: 'ping' });

    ws?.receive({ type: 'pong', ts: 0 });
    expect(stream.getLatency()).not.toBeNull();
    stream.close();
  });

  it('closes the connection when the pong timeout expires', () => {
    const stream = createEventStream(undefined, {
      baseUrl: DEFAULT_BASE_URL,
      pingIntervalMs: 100,
      pongTimeoutMs: 50,
      baseDelayMs: 5,
      maxDelayMs: 5,
    });
    const ws = MockWebSocket.instances[0];
    ws?.open();

    vi.advanceTimersByTime(100);
    vi.advanceTimersByTime(60);

    expect(ws?.readyState).toBe(CLOSED);
    stream.close();
  });

  it('applies the query-token mutator to the connection URL', () => {
    const stream = createEventStream(undefined, {
      baseUrl: DEFAULT_BASE_URL,
      applyQueryToken: (url) => `${url}&token=test`,
    });

    expect(MockWebSocket.instances[0]?.url).toBe(
      `${DEFAULT_BASE_URL}&token=test`,
    );
    stream.close();
  });

  it('passes static and getter subprotocols to the WebSocket constructor', () => {
    const staticStream = createEventStream(undefined, {
      baseUrl: DEFAULT_BASE_URL,
      protocols: ['proto-a', 'proto-b'],
    });
    expect(MockWebSocket.instances[0]?.protocols).toEqual([
      'proto-a',
      'proto-b',
    ]);
    staticStream.close();

    const getterStream = createEventStream(undefined, {
      baseUrl: DEFAULT_BASE_URL,
      protocols: () => ['proto-c'],
    });
    expect(MockWebSocket.instances[1]?.protocols).toEqual(['proto-c']);
    getterStream.close();

    const emptyGetterStream = createEventStream(undefined, {
      baseUrl: DEFAULT_BASE_URL,
      protocols: () => undefined,
    });
    expect(MockWebSocket.instances[2]?.protocols).toBeUndefined();
    emptyGetterStream.close();
  });

  it('forwards transport messages and statuses', () => {
    const fake = createFakeTransport();
    const stream = createEventStream(undefined, { transport: fake.transport });
    const eventHandler = vi.fn();
    const statusHandler = vi.fn();
    stream.subscribe(eventHandler);
    stream.onStatusChange(statusHandler);

    expect(fake.state.connectCalls).toBe(1);

    fake.emitStatus('connected');
    expect(statusHandler).toHaveBeenCalledWith('connected');

    fake.emitMessage(envelope(5, 'run.started'));
    expect(eventHandler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'run.started' }),
    );

    // Raw string frames are ignored at the event level.
    fake.emitMessage('raw frame');
    expect(eventHandler).toHaveBeenCalledTimes(1);

    stream.close();
    expect(fake.state.closeCalls).toBe(1);
  });

  it('runs the heartbeat over a connected transport', () => {
    const fake = createFakeTransport();
    const stream = createEventStream(undefined, {
      transport: fake.transport,
      pingIntervalMs: 100,
      pongTimeoutMs: 50,
    });

    fake.emitStatus('connected');
    vi.advanceTimersByTime(100);
    expect(fake.state.sent).toEqual([{ type: 'ping', ts: expect.any(Number) }]);

    fake.emitMessage({ type: 'pong', ts: 0 });
    expect(stream.getLatency()).not.toBeNull();
    stream.close();
  });

  it('sends JSON through a direct WebSocket', () => {
    const stream = createEventStream(undefined, { baseUrl: DEFAULT_BASE_URL });
    MockWebSocket.instances[0]?.open();

    stream.send({ hello: 1 });

    expect(MockWebSocket.instances[0]?.sent).toEqual(['{"hello":1}']);
    stream.close();
  });

  it('ignores malformed JSON frames gracefully', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stream = createEventStream(undefined, { baseUrl: DEFAULT_BASE_URL });
    const handler = vi.fn();
    stream.subscribe(handler);

    MockWebSocket.instances[0]?.receiveRaw('not json{');

    expect(handler).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
    stream.close();
    consoleSpy.mockRestore();
  });

  it('unsubscribes handlers', () => {
    const stream = createEventStream(undefined, { baseUrl: DEFAULT_BASE_URL });
    const handler = vi.fn();
    const unsubscribe = stream.subscribe(handler);
    unsubscribe();

    MockWebSocket.instances[0]?.receive(envelope(2, 'run.finished'));

    expect(handler).not.toHaveBeenCalled();
    stream.close();
  });

  it('close() tears down the socket and prevents reconnection', () => {
    const stream = createEventStream(undefined, { baseUrl: DEFAULT_BASE_URL });
    expect(MockWebSocket.instances).toHaveLength(1);

    stream.close();
    vi.advanceTimersByTime(1000);

    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
