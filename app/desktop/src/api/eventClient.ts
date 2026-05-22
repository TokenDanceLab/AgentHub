// WebSocket event stream client
const WS_URL = 'ws://127.0.0.1:3210/v1/events';

export interface EventEnvelope {
  version: string;
  id: string;
  seq: number;
  type: string;
  scope: Record<string, string>;
  traceId?: string;
  sentAt: string;
  payload: any;
}

export type EventHandler = (event: EventEnvelope) => void;

export function createEventStream(cursor?: string) {
  let ws: WebSocket | null = null;
  let handlers: EventHandler[] = [];
  let reconnectDelay = 1000;
  const MAX_RECONNECT_DELAY = 30000;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let lastCursor: string | undefined = cursor;

  function connect() {
    if (closed) return;

    const url = lastCursor
      ? `${WS_URL}?cursor=${encodeURIComponent(lastCursor)}`
      : WS_URL;

    ws = new WebSocket(url);

    ws.onopen = () => {
      reconnectDelay = 1000;
    };

    ws.onmessage = (event) => {
      try {
        const envelope: EventEnvelope = JSON.parse(event.data as string);
        lastCursor = envelope.id;
        for (const handler of handlers) {
          handler(envelope);
        }
      } catch (e) {
        console.error('Failed to parse event:', e);
      }
    };

    ws.onclose = () => {
      if (!closed) {
        scheduleReconnect();
      }
    };

    ws.onerror = () => {
      ws?.close();
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
    },
  };
}
