import { createHubWsUrl, type HubWsEvent, type HubWsEventType } from './hubClient';
import { HUB_EVENTS } from '@agenthub/shared/hubEvents';

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
  token?: string;
  since?: string;
  createWebSocket: HubWebSocketFactory;
  onEvent?: (event: HubWsEvent) => void;
  onError?: (error: HubEventStreamError) => void;
  onStatusChange?: (status: HubEventStreamStatus) => void;
}

export interface HubEventStream {
  close: () => void;
}

// Event types matching hub-server/internal/ws/frame.go and shared/src/hubEvents.ts.
// Derived from HUB_EVENTS constants to guarantee alignment with the 27 server events.
// Plus legacy mobile-only types for backward compatibility.
const knownEventTypes = new Set<HubWsEventType>([
  // Real Hub server events (from HUB_EVENTS)
  HUB_EVENTS.AUTH,
  HUB_EVENTS.AUTH_OK,
  HUB_EVENTS.AUTH_FAIL,
  HUB_EVENTS.MESSAGE_NEW,
  HUB_EVENTS.MESSAGE_RECALL,
  HUB_EVENTS.MESSAGE_PIN,
  HUB_EVENTS.MESSAGE_UNPIN,
  HUB_EVENTS.MESSAGE_READ,
  HUB_EVENTS.SESSION_CREATED,
  HUB_EVENTS.SESSION_DISSOLVED,
  HUB_EVENTS.SESSION_MEMBER_JOINED,
  HUB_EVENTS.SESSION_MEMBER_LEFT,
  HUB_EVENTS.SESSION_INFO_UPDATED,
  HUB_EVENTS.DEVICE_ONLINE,
  HUB_EVENTS.DEVICE_OFFLINE,
  HUB_EVENTS.DEVICE_KICKED,
  HUB_EVENTS.AGENT_DISPATCH,
  HUB_EVENTS.AGENT_STREAM,
  HUB_EVENTS.AGENT_DONE,
  HUB_EVENTS.AGENT_FAILED,
  HUB_EVENTS.AGENT_CANCEL,
  HUB_EVENTS.AGENT_CONTROL,
  HUB_EVENTS.NOTIFICATION_NEW,
  HUB_EVENTS.FRIEND_REQUEST,
  HUB_EVENTS.FRIEND_ACCEPTED,
  HUB_EVENTS.SYNC_REQUEST,
  HUB_EVENTS.SYNC_EVENTS,
  // Server error frame
  'error',
  // Legacy mobile-only event types
  'snapshot.updated',
  'thread.updated',
  'run.updated',
  'approval.updated',
  'presence.updated',
]);

export function createHubEventStream(options: CreateHubEventStreamOptions): HubEventStream {
  let closed = false;
  const wsUrlOptions: { since?: string; token?: string } = {};

  if (options.since) {
    wsUrlOptions.since = options.since;
  }
  if (options.token) {
    wsUrlOptions.token = options.token;
  }

  const socket = options.createWebSocket(createHubWsUrl(options.baseUrl, wsUrlOptions));

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

  // Server frames: { type: string, payload?: unknown, seq_id?: number }
  if (!Object.hasOwn(body.value, 'payload') && !Object.hasOwn(body.value, 'type')) {
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
      type: type as HubWsEventType,
      ...(typeof body.value.seq_id === 'number' ? { seq_id: body.value.seq_id } : {}),
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
