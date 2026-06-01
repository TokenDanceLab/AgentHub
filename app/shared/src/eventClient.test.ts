import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventClient } from './eventClient';

const OPEN = 1;
const CONNECTING = 0;

type MessageHandler = ((msg: MessageEvent<string>) => void) | null;
type CloseHandler = (() => void) | null;
type OpenHandler = (() => void) | null;
type ErrorHandler = (() => void) | null;

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static CONNECTING = CONNECTING;
  static OPEN = OPEN;
  static CLOSING = 2;
  static CLOSED = 3;

  readonly url: string;
  readyState = CONNECTING;
  onopen: OpenHandler = null;
  onmessage: MessageHandler = null;
  onclose: CloseHandler = null;
  onerror: ErrorHandler = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  open() {
    this.readyState = OPEN;
    this.onopen?.();
  }

  receive(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

describe('EventClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('encodes the initial cursor into the websocket URL', () => {
    const client = new EventClient({
      baseUrl: 'http://127.0.0.1:3210/',
      cursor: 'seq 1/2',
    });

    client.connect();

    expect(MockWebSocket.instances[0]?.url).toBe(
      'ws://127.0.0.1:3210/v1/events?cursor=seq%201%2F2',
    );
    client.disconnect();
  });

  it('stores seq as the replay cursor and reuses it on reconnect', async () => {
    const client = new EventClient({
      baseUrl: 'http://127.0.0.1:3210',
      reconnectDelayMs: 5,
      maxReconnectDelayMs: 5,
    });

    client.connect();
    const first = MockWebSocket.instances[0];
    expect(first?.url).toBe('ws://127.0.0.1:3210/v1/events');

    first?.receive({
      version: 'v1',
      id: 'evt_not_the_cursor',
      seq: 42,
      type: 'run.output',
      scope: {},
      sentAt: '2026-05-24T10:00:00.000Z',
      payload: {},
    });

    expect(client.currentCursor).toBe('42');

    first?.close();
    await vi.advanceTimersByTimeAsync(5);

    expect(MockWebSocket.instances[1]?.url).toBe(
      'ws://127.0.0.1:3210/v1/events?cursor=42',
    );
    client.disconnect();
  });

  it('does not replace the cursor with an event id when seq is missing', () => {
    const client = new EventClient({
      baseUrl: 'http://127.0.0.1:3210',
      cursor: '7',
    });

    client.connect();
    MockWebSocket.instances[0]?.receive({
      version: 'v1',
      id: 'evt_without_seq',
      type: 'error',
      scope: {},
      sentAt: '2026-05-24T10:00:00.000Z',
      payload: {},
    });

    expect(client.currentCursor).toBe('7');
    client.disconnect();
  });
});
