import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEventStream } from '../api/eventClient';
import {
  EDGE_WS_BEARER_SUBPROTOCOL,
  buildEdgeWSAuthProtocols,
  setEdgeAuthToken,
} from '../api/edgeAuth';

// Track WebSocket instances created by the stream
const instances: MockWebSocket[] = [];

class MockWebSocket {
  url: string;
  protocols: string | string[] | undefined;
  onopen: (() => void) | null = null;
  onclose: ((ev?: CloseEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  CLOSED = 3;

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    instances.push(this);
  }

  close() {
    this.readyState = this.CLOSED;
    this.onclose?.(new CloseEvent('close'));
  }
}

describe('eventClient', () => {
  beforeEach(() => {
    instances.length = 0;
    (globalThis as any).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setEdgeAuthToken('');
    localStorage.clear();
    sessionStorage.clear();
  });

  function lastWs(): MockWebSocket {
    return instances[instances.length - 1];
  }

  it('subscribes and receives events', () => {
    const stream = createEventStream();
    const handler = vi.fn();
    stream.subscribe(handler);

    const ws = lastWs();
    ws.onopen?.();
    ws.onmessage?.(
      new MessageEvent('msg', {
        data: JSON.stringify({
          version: 'v1',
          id: 'evt_1',
          seq: 1,
          type: 'run.started',
          scope: {},
          sentAt: new Date().toISOString(),
          payload: { runId: 'run_1' },
        }),
      }),
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'run.started' }));
    stream.close();
  });

  it('reports connection status', () => {
    const stream = createEventStream();
    const statusFn = vi.fn();
    stream.onStatusChange(statusFn);

    lastWs().onopen?.();
    expect(statusFn).toHaveBeenCalledWith('connected');

    lastWs().close(); // triggers onclose → notifyStatus('disconnected')
    expect(statusFn).toHaveBeenCalledWith('disconnected');

    stream.close();
  });

  it('handles malformed JSON gracefully', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stream = createEventStream();
    const handler = vi.fn();
    stream.subscribe(handler);

    lastWs().onmessage?.(new MessageEvent('msg', { data: 'not json{' }));

    expect(handler).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
    stream.close();
    consoleSpy.mockRestore();
  });

  it('unsubscribes correctly', () => {
    const stream = createEventStream();
    const handler = vi.fn();
    const unsub = stream.subscribe(handler);
    unsub();

    lastWs().onmessage?.(
      new MessageEvent('msg', {
        data: JSON.stringify({
          version: 'v1',
          id: 'evt_2',
          seq: 2,
          type: 'run.finished',
          scope: {},
          sentAt: new Date().toISOString(),
          payload: {},
        }),
      }),
    );

    expect(handler).not.toHaveBeenCalled();
    stream.close();
  });

  it('close prevents reconnection', () => {
    const stream = createEventStream();
    stream.close();
    // After close, creating another connection should be no-op
    expect(instances).toHaveLength(1); // only the original
  });

  it('passes Edge auth token via Sec-WebSocket-Protocol, not query', () => {
    localStorage.setItem('agenthub:edge_auth_token', 'local-edge-token');

    const stream = createEventStream('ws://127.0.0.1:3210/v1/events?cursor=7');

    const ws = lastWs();
    expect(ws.url).toContain('cursor=7');
    expect(ws.url).not.toContain('access_token=');
    expect(ws.protocols).toEqual([EDGE_WS_BEARER_SUBPROTOCOL, 'local-edge-token']);
    stream.close();
  });

  it('passes runtime Edge auth token via Sec-WebSocket-Protocol', () => {
    setEdgeAuthToken('runtime-edge-token');

    const stream = createEventStream('ws://127.0.0.1:3210/v1/events?cursor=8');

    const ws = lastWs();
    expect(ws.url).toContain('cursor=8');
    expect(ws.url).not.toContain('access_token=');
    expect(ws.protocols).toEqual([EDGE_WS_BEARER_SUBPROTOCOL, 'runtime-edge-token']);
    stream.close();
  });

  it('optionally injects query token only when useQueryTokenFallback is true', () => {
    setEdgeAuthToken('legacy-edge-token');

    const stream = createEventStream('ws://127.0.0.1:3210/v1/events?cursor=9', {
      useQueryTokenFallback: true,
    });

    const ws = lastWs();
    expect(ws.url).toContain('cursor=9');
    expect(ws.url).toContain('access_token=legacy-edge-token');
    expect(ws.protocols).toEqual([EDGE_WS_BEARER_SUBPROTOCOL, 'legacy-edge-token']);
    stream.close();
  });

  it('buildEdgeWSAuthProtocols returns marker + token', () => {
    expect(buildEdgeWSAuthProtocols('edge-tok')).toEqual([
      EDGE_WS_BEARER_SUBPROTOCOL,
      'edge-tok',
    ]);
    expect(buildEdgeWSAuthProtocols('')).toBeUndefined();
    expect(buildEdgeWSAuthProtocols(null)).toBeUndefined();
  });
});
