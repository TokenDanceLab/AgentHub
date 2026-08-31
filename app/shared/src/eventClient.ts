// Shared WebSocket event-stream client — the single core implementation
// (#1682 P1). Platform renderers consume this through their own thin
// wrappers (e.g. app/desktop/src/api/eventClient.ts) that inject
// platform-specific defaults: resolved base URL, auth subprotocols, and any
// legacy query-token fallback. Do not duplicate this implementation in
// platform code.
//
// Responsibilities:
//   - connection lifecycle (direct WebSocket, or injected Transport)
//   - cursor-based replay with idempotent seq dedup — system.gap events
//     never pollute the replay cursor
//   - application-level ping/pong heartbeat with latency tracking
//   - exponential backoff with jitter on reconnect

/**
 * ⚠️ seq 字段契约警戒（#2101 G5）：
 * 本文件处理的 `envelope.seq` 是 **Edge EventEnvelope.seq** —— per-bus 持久单调序号，
 * 由 `edge-server/internal/events/bus.go:159` 在 `Bus.Publish` 内 stamp，跨连接稳定，
 * 用作 replay cursor 与去重水位（详见 api/events.md「seq 字段对照表」）。
 *
 * 这 **不是** Hub Frame 的 `seq_id`（per-connection 投递序，重连重置，仅用于同连丢帧检测；
 * 定义于 `hub-server/internal/ws/frame.go:7-14`，由 `fanout.go:91` stamp）。
 * 把这里的 `seq` 当作 per-conn 计数器、或把 Hub `seq_id` 当 cursor 续读，都会导致
 * 静默丢事件或重复 apply。改本文件前请先确认你操作的是哪一侧的序号。
 */

import type { EventEnvelope } from './events';
import { reportApiError } from './errors';
import type { Transport, TransportStatus } from './transport';

export type EventHandler = (event: EventEnvelope) => void;
export type StatusHandler = (status: TransportStatus) => void;

export interface StreamHandle {
  /** Subscribe to incoming events. Returns an unsubscribe function. */
  subscribe(handler: EventHandler): () => void;
  /** Subscribe to connection status changes. Returns an unsubscribe function. */
  onStatusChange(handler: StatusHandler): () => void;
  /** Send a JSON message through the WebSocket (heartbeat pings are handled internally). */
  send(data: Record<string, unknown>): void;
  /** Latest measured round-trip latency in milliseconds, or null if not yet measured. */
  getLatency(): number | null;
  close(): void;
}

export interface EventStreamOptions {
  /** Base WebSocket URL (ws:// or wss://). Defaults to the local Edge endpoint. */
  baseUrl?: string;
  /**
   * Optional Transport instance for connection management. When provided the
   * stream delegates connecting/reconnecting instead of owning a WebSocket.
   */
  transport?: Transport;
  /**
   * Optional WebSocket subprotocols, or a getter evaluated on each connect.
   * Used to carry auth tokens via Sec-WebSocket-Protocol.
   */
  protocols?: string[] | (() => string[] | undefined);
  /** Optional URL mutator applied just before connecting (legacy query-token auth). */
  applyQueryToken?: (url: string) => string;
  /** Give up reconnecting after this many consecutive failed attempts. Default 10. */
  maxRetries?: number;
  /** Initial reconnect delay in milliseconds. Default 1000. */
  baseDelayMs?: number;
  /** Cap for the exponential reconnect delay in milliseconds. Default 30000. */
  maxDelayMs?: number;
  /** Heartbeat ping interval in milliseconds. Default 10000. */
  pingIntervalMs?: number;
  /** Heartbeat pong timeout in milliseconds — the connection closes when exceeded. Default 5000. */
  pongTimeoutMs?: number;
}

export const DEFAULT_EVENT_STREAM_URL = 'ws://127.0.0.1:3210/v1/events';
const DEFAULT_MAX_RETRIES = 10;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_PING_INTERVAL_MS = 10_000;
const DEFAULT_PONG_TIMEOUT_MS = 5_000;

function isWebSocketUrl(value: string): boolean {
  return value.startsWith('ws://') || value.startsWith('wss://');
}

function resolveProtocols(
  protocols: EventStreamOptions['protocols'],
): string[] | undefined {
  if (!protocols) return undefined;
  const value = typeof protocols === 'function' ? protocols() : protocols;
  return value && value.length > 0 ? value : undefined;
}

export function createEventStream(
  cursorOrUrl?: string,
  opts: EventStreamOptions = {},
): StreamHandle {
  // The positional argument is either a full ws(s):// URL (used as the base
  // URL) or a replay cursor. Explicit options win over the positional value.
  const baseUrl =
    opts.baseUrl ??
    (cursorOrUrl && isWebSocketUrl(cursorOrUrl)
      ? cursorOrUrl
      : DEFAULT_EVENT_STREAM_URL);
  const initialCursor =
    cursorOrUrl && !isWebSocketUrl(cursorOrUrl) ? cursorOrUrl : undefined;

  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const pingIntervalMs = opts.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
  const pongTimeoutMs = opts.pongTimeoutMs ?? DEFAULT_PONG_TIMEOUT_MS;

  const providedTransport = opts.transport ?? null;
  const applyQueryToken = opts.applyQueryToken;

  let ws: WebSocket | null = null;
  let reconnectDelayMs = baseDelayMs;
  let retryCount = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const handlers: EventHandler[] = [];
  const statusHandlers: StatusHandler[] = [];
  let closed = false;
  let lastCursor: string | undefined = initialCursor;
  let lastSeq = 0;

  // Heartbeat state
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let pongTimer: ReturnType<typeof setTimeout> | null = null;
  let latestLatencyMs: number | null = null;
  let pingSendTime = 0;

  // Transport-mode subscriptions
  let unsubMessage: (() => void) | null = null;
  let unsubStatus: (() => void) | null = null;

  function notifyStatus(status: TransportStatus): void {
    for (const handler of statusHandlers) handler(status);
  }

  function clearHeartbeat(): void {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    if (pongTimer) {
      clearTimeout(pongTimer);
      pongTimer = null;
    }
  }

  function startHeartbeat(): void {
    clearHeartbeat();
    pingTimer = setInterval(() => {
      if (providedTransport) {
        if (providedTransport.getStatus() !== 'connected') return;
        pingSendTime = Date.now();
        providedTransport.send({ type: 'ping', ts: Date.now() });
      } else {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        pingSendTime = Date.now();
        ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
      }
      pongTimer = setTimeout(() => {
        console.warn('[EventStream] WebSocket pong timeout — closing connection');
        if (providedTransport) {
          providedTransport.close();
        } else if (ws) {
          ws.close();
        }
      }, pongTimeoutMs);
    }, pingIntervalMs);
  }

  function handleMessage(data: Record<string, unknown>): void {
    // Any message proves the connection is alive — clear the pong timeout.
    if (pongTimer) {
      clearTimeout(pongTimer);
      pongTimer = null;
    }

    // Application-level pong response — compute round-trip latency.
    if (data.type === 'pong') {
      if (pingSendTime > 0) {
        latestLatencyMs = Math.round(Date.now() - pingSendTime);
        pingSendTime = 0;
      }
      return;
    }

    const envelope = data as unknown as EventEnvelope;
    // ⚠️ Edge EventEnvelope.seq 处理（#2101 G5；对照表见 api/events.md）：
    // 此 `envelope.seq` 是 Edge Bus 的持久单调序号（bus.go:159），**不是** Hub Frame
    // 的 per-connection `seq_id`（frame.go:14 / fanout.go:91）。两者作用域与重连语义
    // 完全不同，切勿互换使用。
    //
    // system.gap events carry a synthetic seq that must NOT pollute the
    // replay cursor — doing so resets replay to seq 0 and triggers a full
    // backfill storm on the next reconnect. Non-gap events with a numeric
    // seq advance the cursor; replayed events (seq <= lastSeq) are dropped
    // so reconnecting never double-applies state changes.
    if (typeof envelope.seq === 'number' && envelope.type !== 'system.gap') {
      if (envelope.seq <= lastSeq) return;
      lastSeq = envelope.seq;
      lastCursor = String(envelope.seq);
    }
    for (const handler of handlers) handler(envelope);
  }

  // ── Transport mode ──────────────────────────────────

  function connectViaTransport(): void {
    if (closed) return;
    const transport = providedTransport;
    if (!transport) return;

    // Clean up previous subscriptions.
    if (unsubMessage) {
      unsubMessage();
      unsubMessage = null;
    }
    if (unsubStatus) {
      unsubStatus();
      unsubStatus = null;
    }

    unsubStatus = transport.on('status', (status: TransportStatus) => {
      if (status === 'connected') {
        startHeartbeat();
      } else {
        clearHeartbeat();
      }
      notifyStatus(status);
    });

    unsubMessage = transport.on('message', (data: unknown) => {
      if (typeof data === 'string') return; // raw string — ignore at event level
      const record = data as Record<string, unknown>;
      if (!record || typeof record !== 'object') return;
      handleMessage(record);
    });

    transport.connect();
  }

  // ── Direct WebSocket mode ──────────────────────────

  function connectDirect(): void {
    if (closed) return;
    const plainUrl = lastCursor
      ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(lastCursor)}`
      : baseUrl;
    // Query-token auth stays off by default; only the wrapper-provided
    // mutator (legacy fallback) is applied here.
    const url = applyQueryToken ? applyQueryToken(plainUrl) : plainUrl;
    const protocols = resolveProtocols(opts.protocols);

    ws = protocols ? new WebSocket(url, protocols) : new WebSocket(url);

    ws.onopen = () => {
      retryCount = 0;
      reconnectDelayMs = baseDelayMs;
      startHeartbeat();
      notifyStatus('connected');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as Record<string, unknown>;
        handleMessage(data);
      } catch (error) {
        console.error('[EventStream] Dropping malformed WebSocket frame', error);
        reportApiError(
          error instanceof Error
            ? error
            : new Error('Malformed WebSocket frame'),
          { context: 'event_stream_parse' },
        );
      }
    };

    ws.onclose = () => {
      clearHeartbeat();
      notifyStatus('disconnected');
      if (!closed) scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose fires after this, which triggers the reconnect.
      console.error('[EventStream] WebSocket error — will reconnect via onclose');
    };
  }

  function scheduleReconnect(): void {
    if (closed) return;
    if (retryCount >= maxRetries) {
      const msg = `Max retries (${maxRetries}) reached, giving up`;
      console.error(`[EventStream] ${msg}`);
      reportApiError(new Error(msg), {
        context: 'event_stream_reconnect',
        retryCount,
        baseUrl,
      });
      notifyStatus('disconnected');
      return;
    }
    retryCount += 1;

    // Exponential backoff with ±20% jitter to avoid a thundering herd.
    const rawDelay = Math.min(reconnectDelayMs * 2, maxDelayMs);
    const jitter = rawDelay * 0.2 * (Math.random() * 2 - 1);
    const delay = Math.round(Math.max(0, rawDelay + jitter));

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectDirect();
      reconnectDelayMs = rawDelay;
    }, delay);
  }

  // ── Connect immediately (matches historical desktop semantics) ──

  if (providedTransport) {
    connectViaTransport();
  } else {
    connectDirect();
  }

  // ── Return StreamHandle ─────────────────────────────

  return {
    subscribe(handler: EventHandler): () => void {
      handlers.push(handler);
      return () => {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      };
    },

    onStatusChange(handler: StatusHandler): () => void {
      statusHandlers.push(handler);
      return () => {
        const idx = statusHandlers.indexOf(handler);
        if (idx >= 0) statusHandlers.splice(idx, 1);
      };
    },

    getLatency(): number | null {
      return latestLatencyMs;
    },

    close(): void {
      closed = true;
      retryCount = 0;
      clearHeartbeat();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (unsubMessage) {
        unsubMessage();
        unsubMessage = null;
      }
      if (unsubStatus) {
        unsubStatus();
        unsubStatus = null;
      }
      if (providedTransport) {
        providedTransport.close();
      }
      if (ws) {
        ws.close();
        ws = null;
      }
      handlers.length = 0;
      statusHandlers.length = 0;
    },

    send(data: Record<string, unknown>): void {
      if (providedTransport) {
        providedTransport.send(data);
      } else if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
      }
    },
  };
}
