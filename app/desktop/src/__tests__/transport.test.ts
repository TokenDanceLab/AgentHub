import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketTransport, type Transport, type TransportStatus } from '../api/transport';

// Track WebSocket instances
const instances: MockWebSocket[] = [];

class MockWebSocket {
  url: string;
  onopen: (() => void) | null = null;
  onclose: ((ev?: CloseEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url: string) {
    this.url = url;
    instances.push(this);
    this.readyState = MockWebSocket.CONNECTING;
  }

  send(_data: string) {
    // no-op by default; spy on this in tests
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close'));
  }
}

function lastWs(): MockWebSocket {
  return instances[instances.length - 1];
}

/** Simulate a successful WebSocket connection opening. */
function simulateOpen(ws: MockWebSocket): void {
  ws.readyState = MockWebSocket.OPEN;
  ws.onopen?.();
}

describe('WebSocketTransport', () => {
  beforeEach(() => {
    instances.length = 0;
    (globalThis as any).WebSocket = MockWebSocket;
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function createTransport(opts?: Partial<{ url: string; maxRetries: number; baseDelay: number; maxDelay: number; offlineQueue: boolean }>) {
    return new WebSocketTransport({
      url: 'ws://127.0.0.1:3210/v1/events',
      ...opts,
    });
  }

  // ── Connection lifecycle ────────────────────────────

  describe('connection lifecycle', () => {
    it('starts in disconnected status', () => {
      const t = createTransport();
      expect(t.getStatus()).toBe('disconnected');
    });

    it('transitions connecting -> connected on successful open', () => {
      const t = createTransport();
      const statuses: string[] = [];
      t.on('status', (s: TransportStatus) => statuses.push(s));

      t.connect();
      expect(t.getStatus()).toBe('connecting');
      expect(statuses).toEqual(['connecting']);

      simulateOpen(lastWs());
      expect(t.getStatus()).toBe('connected');
      expect(statuses).toEqual(['connecting', 'connected']);
    });

    it('delivers parsed JSON messages to message handlers', () => {
      const t = createTransport();
      t.connect();
      simulateOpen(lastWs());

      const handler = vi.fn();
      t.on('message', handler);

      lastWs().onmessage?.(
        new MessageEvent('msg', {
          data: JSON.stringify({ type: 'ping', ts: 123 }),
        }),
      );

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ type: 'ping', ts: 123 });
    });

    it('delivers non-JSON messages as raw string', () => {
      const t = createTransport();
      t.connect();
      simulateOpen(lastWs());

      const handler = vi.fn();
      t.on('message', handler);

      lastWs().onmessage?.(new MessageEvent('msg', { data: 'raw text' }));

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith('raw text');
    });

    it('transitions to reconnecting after unplanned disconnect', () => {
      const t = createTransport();
      const statuses: string[] = [];
      t.on('status', (s: TransportStatus) => statuses.push(s));

      t.connect();
      simulateOpen(lastWs());
      expect(statuses).toEqual(['connecting', 'connected']);

      lastWs().close(); // triggers onclose → disconnected → reconnecting
      expect(t.getStatus()).toBe('reconnecting');
      expect(statuses).toEqual(['connecting', 'connected', 'disconnected', 'reconnecting']);
    });

    it('does not double-connect if already open', () => {
      const t = createTransport();
      t.connect();
      simulateOpen(lastWs());
      expect(instances).toHaveLength(1);

      t.connect(); // second call
      expect(instances).toHaveLength(1); // no new instance
    });
  });

  // ── Send ───────────────────────────────────────────

  describe('send', () => {
    it('sends JSON-serialized data when connected', () => {
      const t = createTransport();
      t.connect();
      simulateOpen(lastWs());

      const sendSpy = vi.spyOn(lastWs(), 'send');
      t.send({ type: 'hello', payload: { x: 1 } });

      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith(JSON.stringify({ type: 'hello', payload: { x: 1 } }));
    });

    it('queues messages when disconnected', () => {
      const t = createTransport({ offlineQueue: true });
      t.send({ type: 'msg1' });
      t.send({ type: 'msg2' });

      // Connect — queue should drain
      t.connect();
      const ws = lastWs();
      const sendSpy = vi.spyOn(ws, 'send');
      simulateOpen(ws);

      // Both queued messages should be sent
      expect(sendSpy).toHaveBeenCalledTimes(2);
      expect(sendSpy).toHaveBeenNthCalledWith(1, JSON.stringify({ type: 'msg1' }));
      expect(sendSpy).toHaveBeenNthCalledWith(2, JSON.stringify({ type: 'msg2' }));
    });

    it('does not queue when offlineQueue is disabled', () => {
      const t = createTransport({ offlineQueue: false });
      t.connect();
      simulateOpen(lastWs());

      const sendSpy = vi.spyOn(lastWs(), 'send');
      t.send({ type: 'hello' });

      expect(sendSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ── Reconnection / backoff ──────────────────────────

  describe('reconnection with exponential backoff', () => {
    it('schedules reconnect on unplanned disconnect', () => {
      const t = createTransport({ maxRetries: 3, baseDelay: 1000, maxDelay: 30000 });
      const statuses: string[] = [];
      t.on('status', (s: TransportStatus) => statuses.push(s));

      t.connect();
      simulateOpen(lastWs());

      // Simulate network drop
      lastWs().close();

      expect(statuses).toEqual(['connecting', 'connected', 'disconnected', 'reconnecting']);

      // First reconnect attempt: delay = 1000 * 2^0 = 1000ms (±20% jitter)
      vi.advanceTimersByTime(1500);
      // The reconnect should have triggered connect()
      expect(instances.length).toBeGreaterThanOrEqual(2);
    });

    it('doubles delay on each retry', () => {
      const t = createTransport({ maxRetries: 5, baseDelay: 1000, maxDelay: 30000 });
      t.connect();
      simulateOpen(lastWs());

      const statuses: string[] = [];
      t.on('status', (s: TransportStatus) => statuses.push(s));

      // Retry 1: close → reconnect scheduled
      lastWs().close();
      expect(t.getStatus()).toBe('reconnecting');

      // Let retry 1 timer fire and fail
      vi.advanceTimersByTime(2000);
      expect(instances.length).toBe(2);
      // Fail again
      instances[instances.length - 1].close();
      expect(t.getStatus()).toBe('reconnecting');

      // Retry 2: baseDelay * 2^1 = 2000ms. Should NOT fire at +1000ms
      const countBefore = instances.length;
      vi.advanceTimersByTime(1500);
      expect(instances.length).toBe(countBefore); // still the same

      vi.advanceTimersByTime(1500);
      expect(instances.length).toBeGreaterThan(countBefore);
    });

    it('resets retry count on successful connection', () => {
      const t = createTransport({ maxRetries: 5, baseDelay: 1000 });
      t.connect();
      simulateOpen(lastWs());

      // Fail once
      lastWs().close();
      vi.advanceTimersByTime(2000);
      expect(instances.length).toBe(2);

      // Reconnect succeeds
      simulateOpen(instances[instances.length - 1]);
      expect(t.getStatus()).toBe('connected');

      // Fail again — should start from base delay again
      instances[instances.length - 1].close();
      expect(t.getStatus()).toBe('reconnecting');
      // retryCount was reset to 0, so next delay = 1000 * 2^0 = 1000ms
      vi.advanceTimersByTime(2000);
      expect(instances.length).toBe(3);
    });

    it('stays in disconnected after max retries exceeded', () => {
      const t = createTransport({ maxRetries: 2, baseDelay: 1000 });
      t.connect();
      simulateOpen(lastWs());

      // Subscribe after connect to only track disconnect/reconnect cycle
      const statuses: string[] = [];
      t.on('status', (s: TransportStatus) => statuses.push(s));

      // Fail → retry 1
      lastWs().close();
      expect(t.getStatus()).toBe('reconnecting');

      vi.advanceTimersByTime(2000);
      expect(instances.length).toBe(2);
      // retry 1 fires (status stays reconnecting during connect)
      expect(t.getStatus()).toBe('reconnecting');

      // Fail → retry 2
      instances[instances.length - 1].close();
      expect(t.getStatus()).toBe('reconnecting');

      vi.advanceTimersByTime(5000);
      expect(instances.length).toBe(3);
      // retry 2 fires
      instances[instances.length - 1].close();

      // Now retries exhausted (retryCount=2, maxRetries=2) — should stay disconnected
      vi.advanceTimersByTime(50000);
      expect(t.getStatus()).toBe('disconnected');
    });
  });

  // ── Manual close ───────────────────────────────────

  describe('close', () => {
    it('prevents reconnection after manual close', () => {
      const t = createTransport({ maxRetries: 5 });
      t.connect();
      simulateOpen(lastWs());

      t.close();

      expect(t.getStatus()).toBe('disconnected');

      // Try to connect again
      t.connect();
      expect(instances).toHaveLength(1); // no new connection
    });

    it('cancels pending reconnect timer on close', () => {
      const t = createTransport({ maxRetries: 5, baseDelay: 1000 });
      t.connect();
      simulateOpen(lastWs());

      // Trigger reconnect scheduling
      lastWs().close();
      expect(t.getStatus()).toBe('reconnecting');

      // Close before timer fires
      t.close();
      expect(t.getStatus()).toBe('disconnected');

      // Advance past the timer — should not reconnect
      vi.advanceTimersByTime(10000);
      expect(instances).toHaveLength(1);
    });
  });

  // ── Offline queue persistence ──────────────────────

  describe('localStorage queue persistence', () => {
    it('persists queued messages to localStorage', () => {
      const t = createTransport({ offlineQueue: true });
      t.send({ type: 'msg1' });
      t.send({ type: 'msg2' });

      const stored = JSON.parse(localStorage.getItem('agenthub:offline_queue')!);
      expect(stored).toEqual([{ type: 'msg1' }, { type: 'msg2' }]);
    });

    it('restores queue from localStorage on init', () => {
      localStorage.setItem('agenthub:offline_queue', JSON.stringify([{ type: 'old1' }, { type: 'old2' }]));

      const t = createTransport({ offlineQueue: true });

      // Connect and verify old messages are drained
      t.connect();
      const ws = lastWs();
      const sendSpy = vi.spyOn(ws, 'send');
      simulateOpen(ws);

      expect(sendSpy).toHaveBeenCalledTimes(2);
      expect(sendSpy).toHaveBeenNthCalledWith(1, JSON.stringify({ type: 'old1' }));
      expect(sendSpy).toHaveBeenNthCalledWith(2, JSON.stringify({ type: 'old2' }));

      // localStorage should be cleared after restore
      expect(localStorage.getItem('agenthub:offline_queue')).toBeNull();
    });

    it('clears localStorage on manual close', () => {
      localStorage.setItem('agenthub:offline_queue', JSON.stringify([{ type: 'test' }]));

      const t = createTransport({ offlineQueue: true });
      t.close();

      expect(localStorage.getItem('agenthub:offline_queue')).toBeNull();
    });
  });

  // ── Edge cases ─────────────────────────────────────

  describe('edge cases', () => {
    it('handler errors do not break other handlers', () => {
      const t = createTransport();
      t.connect();
      simulateOpen(lastWs());

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const goodHandler = vi.fn();

      t.on('message', () => {
        throw new Error('boom');
      });
      t.on('message', goodHandler);

      lastWs().onmessage?.(new MessageEvent('msg', { data: JSON.stringify({ x: 1 }) }));

      expect(goodHandler).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('unsubscribe removes handler', () => {
      const t = createTransport();
      t.connect();
      simulateOpen(lastWs());

      const handler = vi.fn();
      const unsub = t.on('message', handler);
      unsub();

      lastWs().onmessage?.(new MessageEvent('msg', { data: JSON.stringify({ x: 1 }) }));

      expect(handler).not.toHaveBeenCalled();
    });

    it('getStatus returns current status', () => {
      const t = createTransport();
      expect(t.getStatus()).toBe('disconnected');

      t.connect();
      expect(t.getStatus()).toBe('connecting');

      simulateOpen(lastWs());
      expect(t.getStatus()).toBe('connected');
    });

    it('does not connect after construction', () => {
      createTransport();
      // WebSocket should NOT be created until connect() is called
      expect(instances).toHaveLength(0);
    });
  });
});
