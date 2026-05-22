import type { EventEnvelope } from '@shared/events';
import { edgeWebSocketUrl } from '@/config';

export type EventHandler = (event: EventEnvelope) => void;
export type StatusHandler = (connected: boolean) => void;

export interface EventStream {
  subscribe(handler: EventHandler): () => void;
  onStatusChange(handler: StatusHandler): () => void;
  close(): void;
}

export interface EventStreamOptions {
  baseUrl?: string;
  cursor?: number;
  WebSocketImpl?: typeof WebSocket;
}

export function createEventStream(options: EventStreamOptions = {}): EventStream {
  const WebSocketImpl = options.WebSocketImpl ?? WebSocket;
  const handlers: EventHandler[] = [];
  const statusHandlers: StatusHandler[] = [];
  let ws: WebSocket | null = null;
  let closed = false;
  let lastCursor = options.cursor;
  let reconnectDelay = 1000;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const maxReconnectDelay = 30000;

  function notifyStatus(connected: boolean) {
    for (const handler of statusHandlers) handler(connected);
  }

  function connect() {
    if (closed) return;

    const url = new URL(edgeWebSocketUrl(options.baseUrl));
    if (typeof lastCursor === 'number') {
      url.searchParams.set('cursor', String(lastCursor));
    }

    ws = new WebSocketImpl(url.toString());

    ws.onopen = () => {
      reconnectDelay = 1000;
      notifyStatus(true);
    };

    ws.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data as string) as EventEnvelope;
        lastCursor = event.seq;
        for (const handler of handlers) handler(event);
      } catch (error) {
        console.error('Failed to parse event:', error);
      }
    };

    ws.onclose = () => {
      notifyStatus(false);
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    if (closed || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
      reconnectDelay = Math.min(reconnectDelay * 2, maxReconnectDelay);
    }, reconnectDelay);
  }

  connect();

  return {
    subscribe(handler: EventHandler): () => void {
      handlers.push(handler);
      return () => {
        const index = handlers.indexOf(handler);
        if (index >= 0) handlers.splice(index, 1);
      };
    },
    onStatusChange(handler: StatusHandler): () => void {
      statusHandlers.push(handler);
      return () => {
        const index = statusHandlers.indexOf(handler);
        if (index >= 0) statusHandlers.splice(index, 1);
      };
    },
    close(): void {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      ws?.close();
      ws = null;
      handlers.length = 0;
      statusHandlers.length = 0;
    },
  };
}
