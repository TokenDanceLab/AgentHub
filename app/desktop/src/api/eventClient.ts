// WebSocket event stream client.
// Manages connection lifecycle, cursor-based replay, exponential backoff,
// and application-level ping/pong heartbeat with latency tracking.
//
// Supports an optional Transport instance for connection management.
// When no transport is provided, creates its own WebSocket internally
// (backward compatible with existing callers).

import { WS_URL } from '@/config';
import { withEdgeAuthQuery } from './edgeAuth';
import type { Transport, TransportStatus } from './transport';
import type { EventEnvelope } from '@shared/events';

export type { EventEnvelope };
export type EventHandler = (event: EventEnvelope) => void;
export type StatusHandler = (connected: boolean) => void;

const PING_INTERVAL_MS = 10_000;
const PONG_TIMEOUT_MS = 5_000;

export interface StreamHandle {
  subscribe(handler: EventHandler): () => void;
  onStatusChange(handler: StatusHandler): () => void;
  /** Send a JSON message through the WebSocket to the Edge server. */
  send(data: Record<string, unknown>): void;
  /** Returns the latest measured round-trip latency in milliseconds, or null if not yet measured. */
  getLatency(): number | null;
  close(): void;
}

export interface EventStreamOptions {
  baseUrl?: string;
  /** Optional Transport instance. When provided, the stream uses it
   *  for connection management instead of creating its own WebSocket. */
  transport?: Transport;
}

export function createEventStream(cursorOrUrl?: string, opts?: EventStreamOptions): StreamHandle {
  let baseUrl = WS_URL;
  let cursor: string | undefined;

  // If first arg looks like a URL, use it as base; otherwise treat as cursor
  if (cursorOrUrl && (cursorOrUrl.startsWith('ws://') || cursorOrUrl.startsWith('wss://'))) {
    baseUrl = cursorOrUrl;
  } else {
    cursor = cursorOrUrl;
  }
  if (opts?.baseUrl) {
    baseUrl = opts.baseUrl;
  }

  const providedTransport = opts?.transport ?? null;

  // Internal WebSocket (only used when no transport is provided)
  let ws: WebSocket | null = null;
  let reconnectDelay = 1000;
  const MAX_RECONNECT_DELAY = 30000;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const handlers: EventHandler[] = [];
  const statusHandlers: StatusHandler[] = [];
  let closed = false;
  let lastCursor: string | undefined = cursor;

  // Transport subscriptions (only used when transport is provided)
  let unsubMessage: (() => void) | null = null;
  let unsubStatus: (() => void) | null = null;

  // Heartbeat state
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let pongTimer: ReturnType<typeof setTimeout> | null = null;
  let latestLatencyMs: number | null = null;
  let pingSendTime = 0;

  function notifyStatus(connected: boolean) {
    for (const h of statusHandlers) h(connected);
  }

  function clearHeartbeat() {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    if (pongTimer) {
      clearTimeout(pongTimer);
      pongTimer = null;
    }
  }

  function startHeartbeat() {
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
        console.warn('WebSocket pong timeout, closing connection');
        if (providedTransport) {
          providedTransport.close();
        } else if (ws) {
          ws.close();
        }
      }, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
  }

  function handleMessage(data: Record<string, unknown>) {
    // Any message proves the connection is alive — clear pong timeout
    if (pongTimer) {
      clearTimeout(pongTimer);
      pongTimer = null;
    }

    // Application-level pong response — compute round-trip latency
    if (data.type === 'pong') {
      if (pingSendTime > 0) {
        latestLatencyMs = Math.round(Date.now() - pingSendTime);
        pingSendTime = 0;
      }
      return;
    }

    const envelope = data as unknown as EventEnvelope;
    lastCursor = String(envelope.seq);
    for (const handler of handlers) handler(envelope);
  }

  // ── Transport mode ──────────────────────────────────

  function connectViaTransport(): void {
    if (closed) return;
    const t = providedTransport!;

    // Clean up previous subscriptions
    if (unsubMessage) { unsubMessage(); unsubMessage = null; }
    if (unsubStatus) { unsubStatus(); unsubStatus = null; }

    unsubStatus = t.on('status', (status: TransportStatus) => {
      const connected = status === 'connected';
      if (connected) {
        startHeartbeat();
      } else {
        clearHeartbeat();
      }
      notifyStatus(connected);
    });

    unsubMessage = t.on('message', (data: unknown) => {
      if (typeof data === 'string') return; // raw string — ignore at event level
      const record = data as Record<string, unknown>;
      if (!record || typeof record !== 'object') return;
      handleMessage(record);
    });

    t.connect();
  }

  // ── Direct WebSocket mode (no transport) ────────────

  function connectDirect() {
    if (closed) return;
    const url = withEdgeAuthQuery(lastCursor ? `${baseUrl}?cursor=${encodeURIComponent(lastCursor)}` : baseUrl);

    ws = new WebSocket(url);

    ws.onopen = () => {
      reconnectDelay = 1000;
      startHeartbeat();
      notifyStatus(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);
        handleMessage(data);
      } catch (e) {
        console.error('Failed to parse event:', e);
      }
    };

    ws.onclose = () => {
      clearHeartbeat();
      notifyStatus(false);
      if (!closed) scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will fire after this, triggering reconnect
    };
  }

  function scheduleReconnect() {
    if (closed) return;
    reconnectTimer = setTimeout(() => {
      connectDirect();
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    }, reconnectDelay);
  }

  // ── Initiate connection ─────────────────────────────

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
      clearHeartbeat();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (unsubMessage) { unsubMessage(); unsubMessage = null; }
      if (unsubStatus) { unsubStatus(); unsubStatus = null; }
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
