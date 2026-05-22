import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEventStream, EventHandler } from '../api/eventClient';

// Track WebSocket instances created by the stream
const instances: MockWebSocket[] = [];

class MockWebSocket {
  url: string;
  onopen: (() => void) | null = null;
  onclose: ((ev?: CloseEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  CLOSED = 3;

  constructor(url: string) {
    this.url = url;
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
    ws.onmessage?.(new MessageEvent('msg', {
      data: JSON.stringify({
        version: 'v1', id: 'evt_1', seq: 1, type: 'run.started',
        scope: {}, sentAt: new Date().toISOString(), payload: { runId: 'run_1' },
      }),
    }));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'run.started' }));
    stream.close();
  });

  it('reports connection status', () => {
    const stream = createEventStream();
    const statusFn = vi.fn();
    stream.onStatusChange(statusFn);

    lastWs().onopen?.();
    expect(statusFn).toHaveBeenCalledWith(true);

    lastWs().close(); // triggers onclose → notifyStatus(false)
    expect(statusFn).toHaveBeenCalledWith(false);

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

    lastWs().onmessage?.(new MessageEvent('msg', {
      data: JSON.stringify({
        version: 'v1', id: 'evt_2', seq: 2, type: 'run.finished',
        scope: {}, sentAt: new Date().toISOString(), payload: {},
      }),
    }));

    expect(handler).not.toHaveBeenCalled();
    stream.close();
  });

  it('close prevents reconnection', () => {
    const stream = createEventStream();
    stream.close();
    // After close, creating another connection should be no-op
    expect(instances).toHaveLength(1); // only the original
  });
});
