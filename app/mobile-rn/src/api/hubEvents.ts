import { createHubWsUrl, type HubWsEvent, type HubWsEventType } from './hubClient';

export type HubEventStreamStatus = 'connecting' | 'open' | 'error' | 'closed';

export interface HubWebSocketLike {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  close: () => void;
}

export type HubWebSocketFactory = (url: string) => HubWebSocketLike;

export type HubEventStreamErrorKind = 'parse_error' | 'invalid_event' | 'socket_error';

export interface HubEventStreamError {
  kind: HubEventStreamErrorKind;
  message: string;
  cause?: unknown;
}

export interface CreateHubEventStreamOptions {
  baseUrl: string;
  since?: string;
  createWebSocket: HubWebSocketFactory;
  onEvent?: (event: HubWsEvent) => void;
  onError?: (error: HubEventStreamError) => void;
  onStatusChange?: (status: HubEventStreamStatus) => void;
}

export interface HubEventStream {
  close: () => void;
}

const knownEventTypes = new Set<HubWsEventType>([
  'snapshot.updated',
  'thread.updated',
  'run.updated',
  'approval.updated',
  'presence.updated',
  'error',
]);

export function createHubEventStream(options: CreateHubEventStreamOptions): HubEventStream {
  let closed = false;
  const urlOptions: { since?: string; token?: string } = {};

  if (options.since) {
    urlOptions.since = options.since;
  }

  const socket = options.createWebSocket(createHubWsUrl(options.baseUrl, urlOptions));

  options.onStatusChange?.('connecting');

  socket.onopen = () => {
    if (!closed) {
      options.onStatusChange?.('open');
    }
  };

  socket.onmessage = (message) => {
    if (closed) {
      return;
    }

    const result = parseHubWsEvent(message.data);

    if (result.kind === 'discard') {
      return;
    }

    if (result.kind === 'error') {
      options.onError?.(result.error);
      return;
    }

    options.onEvent?.(result.event);
  };

  socket.onerror = (event) => {
    if (closed) {
      return;
    }

    options.onStatusChange?.('error');
    options.onError?.({
      kind: 'socket_error',
      message: 'Hub WebSocket transport error',
      cause: event,
    });
  };

  socket.onclose = () => closeStream(false);

  return {
    close() {
      if (closed) {
        return;
      }

      closeStream(true);
    },
  };

  function closeStream(closeSocket: boolean) {
    if (closed) {
      return;
    }

    closed = true;
    clearSocketHandlers(socket);
    options.onStatusChange?.('closed');

    if (closeSocket) {
      socket.close();
    }
  }
}

type ParsedHubEvent =
  | { kind: 'event'; event: HubWsEvent }
  | { kind: 'discard' }
  | { kind: 'error'; error: HubEventStreamError };

function parseHubWsEvent(data: unknown): ParsedHubEvent {
  const body = parseMessageData(data);

  if (body.kind === 'error') {
    return body;
  }

  if (!isRecord(body.value)) {
    return {
      kind: 'error',
      error: {
        kind: 'invalid_event',
        message: 'Hub WebSocket event is missing required fields',
      },
    };
  }

  const type = body.value.type;

  if (typeof type !== 'string' || !knownEventTypes.has(type as HubWsEventType)) {
    return { kind: 'discard' };
  }

  if (
    typeof body.value.id !== 'string' ||
    typeof body.value.createdAt !== 'string' ||
    !Object.hasOwn(body.value, 'payload')
  ) {
    return {
      kind: 'error',
      error: {
        kind: 'invalid_event',
        message: 'Hub WebSocket event is missing required fields',
      },
    };
  }

  return {
    kind: 'event',
    event: {
      id: body.value.id,
      type: type as HubWsEventType,
      createdAt: body.value.createdAt,
      payload: body.value.payload,
    },
  };
}

function parseMessageData(data: unknown): { kind: 'value'; value: unknown } | { kind: 'error'; error: HubEventStreamError } {
  if (typeof data !== 'string') {
    return { kind: 'value', value: data };
  }

  try {
    return { kind: 'value', value: JSON.parse(data) };
  } catch (error) {
    return {
      kind: 'error',
      error: {
        kind: 'parse_error',
        message: 'Unable to parse Hub WebSocket event JSON',
        cause: error,
      },
    };
  }
}

function clearSocketHandlers(socket: HubWebSocketLike) {
  socket.onopen = null;
  socket.onmessage = null;
  socket.onerror = null;
  socket.onclose = null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
