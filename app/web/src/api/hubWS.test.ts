import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildWSAuthProtocols,
  createHubWS,
  withAccessToken,
  WS_BEARER_SUBPROTOCOL,
  type HubWSHandle,
} from './hubWS';
import type { Transport, TransportStatus } from './transport';
import { HUB_EVENTS } from '@shared/hubEvents';

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
    get _closed() {
      return closed;
    },
    set _closed(v) {
      closed = v;
    },

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

    send(data: unknown) {
      sent.push(data);
    },

    close() {
      closed = true;
      status = 'disconnected';
      for (const h of statusListeners) h('disconnected');
    },

    getStatus() {
      return status;
    },

    on(evt: string, handler: (d: unknown) => void): () => void {
      if (evt === 'status') {
        const wrapped = handler as (s: TransportStatus) => void;
        statusListeners.add(wrapped);
        return () => {
          statusListeners.delete(wrapped);
        };
      }
      msgListeners.add(handler);
      return () => {
        msgListeners.delete(handler);
      };
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
  });

  it('can still append query access_token when fallback is enabled', () => {
    init(true, true);
    expect(String(t._urls[0])).toContain('access_token=test-token');
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
      onAuthSuccess: () => {
        ok = true;
      },
    });
    h.connect();
    t._deliverMessage({ type: HUB_EVENTS.AUTH_OK });
    expect(ok).toBe(true);
  });

  it('routes typed events to on() handlers', () => {
    init();
    t._deliverMessage({ type: HUB_EVENTS.AUTH_OK });
    let payload: unknown = null;
    h.on(HUB_EVENTS.MESSAGE_NEW, (p) => {
      payload = p;
    });
    t._deliverMessage({ type: HUB_EVENTS.MESSAGE_NEW, payload: { content: 'hi' } });
    expect(payload).toEqual({ content: 'hi' });
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
    h.on(HUB_EVENTS.MESSAGE_NEW, () => {
      called = true;
    });
    t._deliverMessage({ type: HUB_EVENTS.MESSAGE_NEW, payload: {} });
    expect(called).toBe(false);
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

    const { WebSocketTransport } = await import('./transport');
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
