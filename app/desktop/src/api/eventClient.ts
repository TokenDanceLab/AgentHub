// WebSocket event stream client.
// Manages connection lifecycle, cursor-based replay, and exponential backoff.

import { WS_URL } from '@/config';
import type { EventEnvelope } from '@shared/events';

export type { EventEnvelope };
export type EventHandler = (event: EventEnvelope) => void;
export type StatusHandler = (connected: boolean) => void;

interface StreamHandle {
  subscribe(handler: EventHandler): () => void;
  onStatusChange(handler: StatusHandler): () => void;
  close(): void;
}

export function createEventStream(cursor?: string): StreamHandle {
  let ws: WebSocket | null = null;
  const handlers: EventHandler[] = [];
  const statusHandlers: StatusHandler[] = [];
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
        const envelope = JSON.parse(event.data as string) as EventEnvelope;
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
      handlers.length = 0;
      statusHandlers.length = 0;
    },
  };
}
