// Thin shell over the shared event-stream client (#1682 P1 — shared is the
// single core implementation; desktop only injects platform defaults).
//
// Injected defaults:
//   - base URL: the resolved Edge WS URL (query param / storage / env aware)
//   - auth: Edge token carried via Sec-WebSocket-Protocol subprotocols
//   - legacy fallback: optional access_token query injection (default off —
//     Edge rejects query access_token, prefer Sec-WebSocket-Protocol)

import {
  createEventStream as createSharedEventStream,
  type EventStreamOptions,
  type StreamHandle,
} from '@agenthub/shared';
import { getEdgeWsUrl } from '@/config';
import { buildEdgeWSAuthProtocols, withEdgeAuthQuery } from './edgeAuth';

export type {
  EventHandler,
  EventStreamOptions,
  StatusHandler,
  StreamHandle,
} from '@agenthub/shared';
export type { EventEnvelope } from '@shared/events';

interface EventStreamLegacyOptions extends EventStreamOptions {
  /**
   * When true, also append access_token to the WS URL (legacy fallback).
   * Default false — Edge rejects query access_token; prefer
   * Sec-WebSocket-Protocol via buildEdgeWSAuthProtocols.
   */
  useQueryTokenFallback?: boolean;
}

export function createEventStream(
  cursorOrUrl?: string,
  opts?: EventStreamLegacyOptions,
): StreamHandle {
  const { useQueryTokenFallback = false, ...sharedOpts } = opts ?? {};

  // Historical desktop priority: opts.baseUrl > ws(s):// positional > resolved Edge WS URL.
  const positionalIsUrl =
    cursorOrUrl?.startsWith('ws://') === true ||
    cursorOrUrl?.startsWith('wss://') === true;
  const injectedBaseUrl =
    sharedOpts.baseUrl ?? (positionalIsUrl ? undefined : getEdgeWsUrl());

  return createSharedEventStream(cursorOrUrl, {
    ...sharedOpts,
    ...(injectedBaseUrl !== undefined ? { baseUrl: injectedBaseUrl } : {}),
    protocols: () => buildEdgeWSAuthProtocols(),
    ...(useQueryTokenFallback ? { applyQueryToken: withEdgeAuthQuery } : {}),
  });
}
