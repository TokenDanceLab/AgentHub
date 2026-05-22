// WebSocket event stream client.
// Manages connection lifecycle, cursor-based replay, and exponential backoff.

import { WS_URL } from '@/config';

// ── Types ──────────────────────────────────────────

export interface EventEnvelope {
  version: string;
  id: string;
  seq: number;
  type: string;
  scope: Record<string, unknown>;
  traceId?: string;
  sentAt: string;
  payload: Record<string, unknown>;
}

export type EventHandler = (event: EventEnvelope) => void;
export type StatusHandler = (connected: boolean) => void;

interface StreamHandle {
  subscribe(handler: EventHandler): () => void;
  onStatusChange(handler: StatusHandler): () => void;
  close(): void;
}

// ── Implementation ─────────────────────────────────

export function createEventStream(cursor?: string): StreamHandle {
  let ws: WebSocket | null = null;
  let handlers: EventHandler[] = [];
  let statusHandlers: StatusHandler[] = [];
  let reconnectDelay = 1000;
  const MAX_RECONNECT_DELAY = 30000;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let lastCursor: string | undefined = cursor;

  function notifyStatus(connected: boolean) {
    for (const h of statusHandlers) h(connected);
  }

  function connect() {
    if (closed) return;

    const url = lastCursor
      ? `${WS_URL}?cursor=${encodeURIComponent(lastCursor)}`
      : WS_URL;

    ws = new WebSocket(url);

    ws.onopen = () => {
      reconnectDelay = 1000;
      notifyStatus(true);
    };

    ws.onmessage = (event) => {
      try {
        const envelope: EventEnvelope = JSON.parse(event.data as string);
        lastCursor = String(envelope.seq);
        for (const handler of handlers) handler(envelope);
      } catch (e) {
        console.error('Failed to parse event:', e);
      }
    };

    ws.onclose = () => {
      notifyStatus(false);
      if (!closed) scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will fire after this, which triggers reconnect
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
        handlers = handlers.filter((h) => h !== handler);
      };
    },

    onStatusChange(handler: StatusHandler): () => void {
      statusHandlers.push(handler);
      return () => {
        statusHandlers = statusHandlers.filter((h) => h !== handler);
      };
    },

    close(): void {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        ws.close();
        ws = null;
      }
      handlers = [];
      statusHandlers = [];
    },
  };
}
