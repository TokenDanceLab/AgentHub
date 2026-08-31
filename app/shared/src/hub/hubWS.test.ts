import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  buildWSAuthProtocols,
  createHubWS,
  withAccessToken,
  WS_BEARER_SUBPROTOCOL,
  type HubWSHandle,
} from './hubWS';
import type { Transport, TransportStatus } from '../transport';
import { HUB_EVENTS } from '../hubEvents';

interface MockTransport extends Transport {
  _setStatus(s: TransportStatus): void;
  _deliverMessage(data: unknown): void;
  _sent: unknown[];
  _urls: Array<string | undefined>;
  _closed: boolean;
}

function mockTransport(): MockTransport {
  const statusListeners = new Set<(s: TransportStatus) => void>();
  const msgListeners = new Set<(data: unknown) => void>();
  const sent: unknown[] = [];
  const urls: Array<string | undefined> = [];
  let closed = false;
  let status: TransportStatus = 'disconnected';

  const t: MockTransport = {
    _sent: sent,
    _urls: urls,
    get _closed() { return closed; },
    set _closed(v) { closed = v; },

    connect(url?: string) {
      urls.push(url);
      sent.length = 0;
      closed = false;
      status = 'connecting';
      for (const h of statusListeners) h('connecting');
      status = 'connected';
      for (const h of statusListeners) h('connected');
    },

    reconnect(url?: string) {
      closed = false;
      this.connect(url);
    },

    send(data: unknown) { sent.push(data); },

    close() {
      closed = true;
      status = 'disconnected';
      for (const h of statusListeners) h('disconnected');
    },

    getStatus() { return status; },

    on(evt: string, handler: (d: unknown) => void): () => void {
      if (evt === 'status') {
        const wrapped = handler as (s: TransportStatus) => void;
        statusListeners.add(wrapped);
        return () => { statusListeners.delete(wrapped); };
      }
      msgListeners.add(handler);
      return () => { msgListeners.delete(handler); };
    },

    _setStatus(s: TransportStatus) {
      status = s;
      for (const h of statusListeners) h(s);
    },

    _deliverMessage(data: unknown) {
      for (const h of msgListeners) h(data);
    },
  };
  return t;
}

function token(valid = true): () => string | null {
  return valid ? () => 'test-token' : () => null;
}

describe('WS auth protocol helpers', () => {
  it('buildWSAuthProtocols returns marker + jwt', () => {
    expect(buildWSAuthProtocols('jwt.token.here')).toEqual([
      WS_BEARER_SUBPROTOCOL,
      'jwt.token.here',
    ]);
  });

  it('buildWSAuthProtocols returns undefined without token', () => {
    expect(buildWSAuthProtocols(null)).toBeUndefined();
    expect(buildWSAuthProtocols(undefined)).toBeUndefined();
    expect(buildWSAuthProtocols('')).toBeUndefined();
  });

  it('withAccessToken remains available as legacy fallback', () => {
    expect(withAccessToken('ws://hub.example/client/ws', 'tok')).toContain(
      'access_token=tok',
    );
    expect(withAccessToken('ws://hub.example/client/ws', null)).toBe(
      'ws://hub.example/client/ws',
    );
  });
});

describe('createHubWS', () => {
  let t: MockTransport;
  let h: HubWSHandle;

  function init(validToken = true, useQueryTokenFallback = false) {
    t = mockTransport();
    h = createHubWS({
      transport: t as unknown as Transport,
      getToken: token(validToken),
      url: 'ws://hub.example/client/ws',
      useQueryTokenFallback,
    });
    h.connect();
  }

  it('connects without access_token in URL by default (protocol path)', () => {
    init();
    expect(String(t._urls[0])).toBe('ws://hub.example/client/ws');
    expect(String(t._urls[0])).not.toContain('access_token=');
    expect(t._sent).toEqual([]);
  });

  it('can still append query access_token when fallback is enabled', () => {
    init(true, true);
    expect(String(t._urls[0])).toContain('access_token=test-token');
  });

  it('connects without an access_token query param when token is null', () => {
    init(false);
    expect(String(t._urls[0])).not.toContain('access_token=');
  });

  it('connects without query token when token is null even with fallback', () => {
    init(false, true);
    expect(String(t._urls[0])).not.toContain('access_token=');
  });

  it('calls onAuthSuccess on auth.ok', () => {
    let ok = false;
    t = mockTransport();
    h = createHubWS({
      transport: t as unknown as Transport,
      getToken: token(),
      url: 'ws://hub.example/client/ws',
      onAuthSuccess: () => { ok = true; },
    });
    h.connect();
    t._deliverMessage({ type: HUB_EVENTS.AUTH_OK });
    expect(ok).toBe(true);
  });

  it('routes typed events to on() handlers', () => {
    init();
    t._deliverMessage({ type: HUB_EVENTS.AUTH_OK });
    let payload: unknown = null;
    h.on(HUB_EVENTS.MESSAGE_NEW, (p) => { payload = p; });
    t._deliverMessage({ type: HUB_EVENTS.MESSAGE_NEW, payload: { content: 'hi' } });
    expect(payload).toEqual({ content: 'hi' });
  });

  it('routes events to onAny()', () => {
    init();
    t._deliverMessage({ type: HUB_EVENTS.AUTH_OK });
    const events: string[] = [];
    h.onAny((type) => { events.push(type); });
    t._deliverMessage({ type: HUB_EVENTS.MESSAGE_NEW, payload: {} });
    expect(events).toEqual([HUB_EVENTS.MESSAGE_NEW]);
  });

  it('sends typing through the only implemented client frame', () => {
    init();

    h.sendTyping('session-1');

    expect(t._sent).toEqual([
      { type: HUB_EVENTS.TYPING, payload: { session_id: 'session-1' } },
    ]);
  });

  it('drops app events before auth.ok', () => {
    init();
    let called = false;
    h.on(HUB_EVENTS.MESSAGE_NEW, () => { called = true; });
    t._deliverMessage({ type: HUB_EVENTS.MESSAGE_NEW, payload: {} });
    expect(called).toBe(false);
  });

  it('delivers after auth.ok', () => {
    init();
    t._deliverMessage({ type: HUB_EVENTS.AUTH_OK });
    let called = false;
    h.on(HUB_EVENTS.MESSAGE_NEW, () => { called = true; });
    t._deliverMessage({ type: HUB_EVENTS.MESSAGE_NEW, payload: {} });
    expect(called).toBe(true);
  });

  it('skips non-object and null messages', () => {
    init();
    let called = false;
    h.onAny(() => { called = true; });
    t._deliverMessage('string');
    t._deliverMessage(null);
    t._deliverMessage(42);
    expect(called).toBe(false);
  });

  it('send wraps in {type, payload}', () => {
    init();
    h.send('typing', { session_id: 'x' });
    const last = t._sent[t._sent.length - 1];
    expect(last).toEqual({ type: 'typing', payload: { session_id: 'x' } });
  });

  it('sendTyping dispatches typing frame', () => {
    init();
    h.sendTyping('s1');
    const last = t._sent[t._sent.length - 1];
    expect(last).toEqual({ type: 'typing', payload: { session_id: 's1' } });
  });

  it('close shuts down transport', () => {
    init();
    h.close();
    expect(t._closed).toBe(true);
  });

  it('reconnect keeps protocol path URL (no query token by default)', () => {
    let currentToken = 'first-token';
    t = mockTransport();
    h = createHubWS({
      transport: t as unknown as Transport,
      getToken: () => currentToken,
      url: 'ws://hub.example/client/ws',
    });
    h.connect();
    t._deliverMessage({ type: HUB_EVENTS.AUTH_OK });
    currentToken = 'second-token';
    h.reconnect();
    expect(String(t._urls[t._urls.length - 1])).toBe('ws://hub.example/client/ws');
    expect(String(t._urls[t._urls.length - 1])).not.toContain('access_token=');
  });

  it('reconnect refreshes query token when fallback is enabled', () => {
    let currentToken = 'first-token';
    t = mockTransport();
    h = createHubWS({
      transport: t as unknown as Transport,
      getToken: () => currentToken,
      url: 'ws://hub.example/client/ws',
      useQueryTokenFallback: true,
    });
    h.connect();
    t._deliverMessage({ type: HUB_EVENTS.AUTH_OK });
    currentToken = 'second-token';
    h.reconnect();
    expect(String(t._urls[t._urls.length - 1])).toContain('access_token=second-token');
  });

  it('on() unsub stops delivery', () => {
    init();
    t._deliverMessage({ type: HUB_EVENTS.AUTH_OK });
    let n = 0;
    const unsub = h.on(HUB_EVENTS.MESSAGE_NEW, () => { n++; });
    t._deliverMessage({ type: HUB_EVENTS.MESSAGE_NEW, payload: {} });
    expect(n).toBe(1);
    unsub();
    t._deliverMessage({ type: HUB_EVENTS.MESSAGE_NEW, payload: {} });
    expect(n).toBe(1);
  });

  it('onAny() unsub stops delivery', () => {
    init();
    t._deliverMessage({ type: HUB_EVENTS.AUTH_OK });
    let n = 0;
    const unsub = h.onAny(() => { n++; });
    t._deliverMessage({ type: HUB_EVENTS.MESSAGE_NEW, payload: {} });
    expect(n).toBe(1);
    unsub();
    t._deliverMessage({ type: HUB_EVENTS.MESSAGE_NEW, payload: {} });
    expect(n).toBe(1);
  });

  it('drops events after transport disconnect', () => {
    init();
    t._deliverMessage({ type: HUB_EVENTS.AUTH_OK });
    t._setStatus('disconnected');
    let called = false;
    h.on(HUB_EVENTS.MESSAGE_NEW, () => { called = true; });
    t._deliverMessage({ type: HUB_EVENTS.MESSAGE_NEW, payload: {} });
    expect(called).toBe(false);
  });

  it('device.kicked de-auths and stops auto-reconnect', () => {
    init();
    t._deliverMessage({ type: HUB_EVENTS.AUTH_OK });
    let called = false;
    h.on(HUB_EVENTS.DEVICE_KICKED, () => { called = true; });
    t._deliverMessage({ type: HUB_EVENTS.DEVICE_KICKED, payload: {} });
    expect(t._closed).toBe(true);
    expect(h.isAuthenticated()).toBe(false);
    expect(called).toBe(false);
  });

  it('connect URL still has no query token on transport reconnect', () => {
    init();
    t._deliverMessage({ type: HUB_EVENTS.AUTH_OK });
    t._setStatus('disconnected');
    t._setStatus('connected');
    expect(String(t._urls[0])).not.toContain('access_token=');
  });

  it('onStatus forwards transport status', () => {
    init();
    const statuses: TransportStatus[] = [];
    h.onStatus((s) => statuses.push(s));
    t._setStatus('reconnecting');
    expect(statuses).toContain('reconnecting');
  });

  it('onStatus unsub stops notifications', () => {
    init();
    let n = 0;
    const unsub = h.onStatus(() => { n++; });
    t._setStatus('reconnecting');
    expect(n).toBe(1);
    unsub();
    t._setStatus('connected');
    expect(n).toBe(1);
  });

  it('getStatus reflects transport', () => {
    init();
    t._setStatus('connecting');
    expect(h.getStatus()).toBe('connecting');
  });
});

describe('WebSocketTransport protocol carriage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('passes Sec-WebSocket-Protocol subprotocols to WebSocket constructor', async () => {
    const constructed: Array<{ url: string; protocols?: string | string[] }> = [];

    class FakeWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = FakeWebSocket.CONNECTING;
      onopen: ((ev: Event) => void) | null = null;
      onmessage: ((ev: MessageEvent) => void) | null = null;
      onclose: ((ev: CloseEvent) => void) | null = null;
      onerror: ((ev: Event) => void) | null = null;
      constructor(url: string, protocols?: string | string[]) {
        constructed.push({ url, protocols });
        queueMicrotask(() => {
          this.readyState = FakeWebSocket.OPEN;
          this.onopen?.(new Event('open'));
        });
      }
      send(): void {}
      close(): void {
        this.readyState = FakeWebSocket.CLOSED;
        this.onclose?.(new CloseEvent('close'));
      }
    }

    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);

    const { WebSocketTransport } = await import('../transport');
    const transport = new WebSocketTransport({
      url: 'ws://hub.example/client/ws',
      protocols: () => buildWSAuthProtocols('hub-jwt-token'),
      offlineQueue: false,
      maxRetries: 0,
    });
    transport.connect();

    expect(constructed).toHaveLength(1);
    expect(constructed[0]?.url).toBe('ws://hub.example/client/ws');
    expect(constructed[0]?.protocols).toEqual([
      WS_BEARER_SUBPROTOCOL,
      'hub-jwt-token',
    ]);
    transport.close();
  });
});

// ── #2101 G1: seq_id gap detection + duplicate drop ───────────────

describe('hubWS seq_id gap detection (#2101 G1)', () => {
  let t: MockTransport;
  let h: HubWSHandle;

  function init() {
    t = mockTransport();
    h = createHubWS({ url: 'ws://h', getToken: token(), transport: t });
    t.connect();
    // Complete auth handshake so subsequent frames are dispatched.
    t._deliverMessage({ type: HUB_EVENTS.AUTH_OK, payload: null, seq_id: 0 });
  }

  it('does not fire gap event for consecutive seq_ids', () => {
    init();
    const gaps: unknown[] = [];
    h.onGap((p) => gaps.push(p));
    t._deliverMessage({ type: 'message.new', payload: {}, seq_id: 1 });
    t._deliverMessage({ type: 'message.new', payload: {}, seq_id: 2 });
    t._deliverMessage({ type: 'message.new', payload: {}, seq_id: 3 });
    expect(gaps).toHaveLength(0);
    expect(h.getLastSeq()).toBe(3);
  });

  it('fires gap event when seq_id jumps and updates lastSeq', () => {
    init();
    const gaps: Array<{ lastSeq: number; receivedSeq: number; gapSize: number }> = [];
    h.onGap((p) => gaps.push(p));
    t._deliverMessage({ type: 'message.new', payload: {}, seq_id: 1 });
    // Gap: 2..4 missing, next is 5
    t._deliverMessage({ type: 'message.new', payload: {}, seq_id: 5 });
    expect(gaps).toEqual([{ lastSeq: 1, receivedSeq: 5, gapSize: 3 }]);
    expect(h.getLastSeq()).toBe(5);
    // Subsequent consecutive frame should NOT re-fire gap
    t._deliverMessage({ type: 'message.new', payload: {}, seq_id: 6 });
    expect(gaps).toHaveLength(1);
    expect(h.getLastSeq()).toBe(6);
  });

  it('drops duplicate frames (seq_id <= lastSeq) without dispatch', () => {
    init();
    const received: string[] = [];
    h.on('message.new' as never, () => received.push('x'));
    t._deliverMessage({ type: 'message.new', payload: {}, seq_id: 1 });
    t._deliverMessage({ type: 'message.new', payload: {}, seq_id: 1 }); // dup
    t._deliverMessage({ type: 'message.new', payload: {}, seq_id: 0 }); // old dup
    expect(received).toHaveLength(1);
    expect(h.getLastSeq()).toBe(1);
  });

  it('resets lastSeq on reconnect (new connection)', () => {
    init();
    t._deliverMessage({ type: 'message.new', payload: {}, seq_id: 5 });
    expect(h.getLastSeq()).toBe(5);
    // Simulate reconnect: transport status cycles through connected again
    t._setStatus('disconnected');
    t._setStatus('connecting');
    t._setStatus('connected');
    expect(h.getLastSeq()).toBe(-1);
    // Re-auth with new seq baseline
    t._deliverMessage({ type: HUB_EVENTS.AUTH_OK, payload: null, seq_id: 0 });
    expect(h.getLastSeq()).toBe(0);
    // Frame seq=1 is consecutive from new baseline — no gap
    const gaps: unknown[] = [];
    h.onGap((p) => gaps.push(p));
    t._deliverMessage({ type: 'message.new', payload: {}, seq_id: 1 });
    expect(gaps).toHaveLength(0);
  });

  it('ignores frames without seq_id for gap tracking', () => {
    init();
    const gaps: unknown[] = [];
    h.onGap((p) => gaps.push(p));
    // No seq_id — should not move lastSeq or trigger gap
    t._deliverMessage({ type: 'message.new', payload: {} });
    expect(h.getLastSeq()).toBe(0); // still at auth.ok's seq
    expect(gaps).toHaveLength(0);
    // Next seq-bearing frame at 1 is consecutive from 0
    t._deliverMessage({ type: 'message.new', payload: {}, seq_id: 1 });
    expect(gaps).toHaveLength(0);
    expect(h.getLastSeq()).toBe(1);
  });

  it('onGap unsub stops notifications', () => {
    init();
    let count = 0;
    const unsub = h.onGap(() => { count++; });
    t._deliverMessage({ type: 'message.new', payload: {}, seq_id: 5 });
    expect(count).toBe(1);
    unsub();
    t._deliverMessage({ type: 'message.new', payload: {}, seq_id: 10 });
    expect(count).toBe(1);
  });
});
