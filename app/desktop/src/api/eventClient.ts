// WebSocket event stream client.
// Manages connection lifecycle, cursor-based replay, exponential backoff,
// and application-level ping/pong heartbeat with latency tracking.

import { WS_URL } from '@/config';
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

export function createEventStream(cursorOrUrl?: string, opts?: { baseUrl?: string }): StreamHandle {
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
  let ws: WebSocket | null = null;
  const handlers: EventHandler[] = [];
  const statusHandlers: StatusHandler[] = [];
  let reconnectDelay = 1000;
  const MAX_RECONNECT_DELAY = 30000;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let lastCursor: string | undefined = cursor;

  // Heartbeat state
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let pongTimer: ReturnType<typeof setTimeout> | null = null;
  let latestLatencyMs: number | null = null;
  let pingSendTime = 0;
  let lastMessageAt: number = Date.now();

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
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      pingSendTime = Date.now();
      ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
      pongTimer = setTimeout(() => {
        console.warn('WebSocket pong timeout, closing connection');
        if (ws) ws.close();
      }, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
  }

  function connect() {
    if (closed) return;
    const url = lastCursor ? `${baseUrl}?cursor=${encodeURIComponent(lastCursor)}` : baseUrl;

    ws = new WebSocket(url);

    ws.onopen = () => {
      reconnectDelay = 1000;
      startHeartbeat();
      notifyStatus(true);
    };

    ws.onmessage = (event) => {
      lastMessageAt = Date.now();

      // Any message proves the connection is alive — clear pong timeout
      if (pongTimer) {
        clearTimeout(pongTimer);
        pongTimer = null;
      }

      try {
        const data = JSON.parse(event.data as string);

        // Application-level pong response — compute round-trip latency
        if (data.type === 'pong') {
          if (pingSendTime > 0) {
            latestLatencyMs = Math.round(Date.now() - pingSendTime);
            pingSendTime = 0;
          }
          return;
        }

        const envelope = data as EventEnvelope;
        lastCursor = String(envelope.seq);
        for (const handler of handlers) handler(envelope);
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
      connect();
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    }, reconnectDelay);
  }

  connect();

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
      if (ws) {
        ws.close();
        ws = null;
      }
      handlers.length = 0;
      statusHandlers.length = 0;
    },

    send(data: Record<string, unknown>): void {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
      }
    },
  };
}
