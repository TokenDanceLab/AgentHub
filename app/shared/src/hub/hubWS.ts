// Shared Hub WebSocket client for AgentHub renderers (web + desktop).
// Manages auth-frame handshake, typed event routing, per-connection seq_id
// gap detection (#2101 G1), and reconnection via the shared Transport
// abstraction. Platforms inject their configured WS endpoint via
// HubWSOptions.url — there is no platform config import here.
//
// Protocol (matching hub-server/internal/router/router.go + ws/frame.go):
//   1. WebSocket connects to ws://host/client/ws
//      Auth is carried via Sec-WebSocket-Protocol (preferred path):
//        protocols: ["agenthub.bearer.v1", "<hub-jwt>"]
//      Query ?access_token= is a legacy fallback only (mobile / older clients).
//   2. Hub validates the Hub-issued token during HTTP upgrade (WSAuthMiddleware).
//   3. Server responds after upgrade: {"type":"auth.ok","payload":null}
//      or rejects the upgrade before a WebSocket is established.
//   4. After auth, bidirectional events flow with {type, payload, seq_id?} framing.
//      seq_id is a per-connection monotonic counter (omitempty on wire). Clients
//      detect lost frames as gaps when seq_id jumps; duplicates (seq_id <= last)
//      are dropped silently. See #2101 G1.
//
// Reconnection: The underlying Transport handles exponential-backoff
// reconnection (max 10 retries). On every reconnect, the auth handshake
// is re-executed automatically and lastSeq resets (server-side seq is
// per-connection). Typed event subscriptions survive across reconnects.

import { WebSocketTransport, type Transport, type TransportStatus } from '../transport';
import type { HubEventType } from '../hubEvents';
import { HUB_EVENTS } from '../hubEvents';

// ── Types ─────────────────────────────────────────

export interface HubWSOptions {
  /** Hub WebSocket endpoint (e.g. ws://localhost:8080/client/ws). */
  url: string;
  /** Returns the current JWT access token, or null if unauthenticated. */
  getToken: () => string | null;
  /** Optional Transport instance (injected for testing). */
  transport?: Transport;
  /** Called after the auth handshake succeeds. */
  onAuthSuccess?: () => void;
  /**
   * When true, also append access_token to the WS URL (legacy fallback).
   * Default false — preferred path carries the token via
   * Sec-WebSocket-Protocol only.
   */
  useQueryTokenFallback?: boolean;
}

/** Payload emitted on HUB_WS_GAP_EVENT when a seq_id discontinuity is observed. */
export interface HubWSGapPayload {
  /** Last successfully processed seq_id on this connection. */
  lastSeq: number;
  /** The seq_id that arrived and revealed the gap. */
  receivedSeq: number;
  /** Number of missing frames (receivedSeq - lastSeq - 1). Always >= 1. */
  gapSize: number;
}

/**
 * Internal-only event name for seq_id gap detection. Not part of HUB_EVENTS
 * because it has no server-side producer; it is synthesized client-side by
 * hubWS when per-connection seq_id is discontinuous. Subscribe via
 * HubWSHandle.onGap(). See #2101 G1.
 */
export const HUB_WS_GAP_EVENT = 'hub.ws.gap';

export interface HubWSHandle {
  /** Open the WebSocket connection and initiate auth handshake. */
  connect: () => void;
  /** Send a typed frame to the Hub (wrapped as {type, payload}). */
  send: (type: string, payload: unknown) => void;
  /** Send a typing indicator for a session. */
  sendTyping: (sessionId: string) => void;
  /** Subscribe to events of a specific Hub type. Returns unsubscribe fn. */
  on: (type: HubEventType, handler: (payload: unknown) => void) => () => void;
  /** Subscribe to ALL events (after auth). Returns unsubscribe fn. */
  onAny: (handler: (type: string, payload: unknown) => void) => () => void;
  /**
   * Subscribe to per-connection seq_id gap events (#2101 G1). Fires when an
   * authenticated frame arrives with seq_id > lastSeq + 1. Duplicates
   * (seq_id <= lastSeq) are dropped silently and do NOT trigger this.
   */
  onGap: (handler: (payload: HubWSGapPayload) => void) => () => void;
  /** Subscribe to transport-level connection status changes. */
  onStatus: (handler: (status: TransportStatus) => void) => () => void;
  /** Close the connection permanently (no reconnect). */
  close: () => void;
  /** Manually trigger reconnection. */
  reconnect: () => void;
  /** Current transport status. */
  getStatus: () => TransportStatus;
  /** Whether the connection is currently authenticated. */
  isAuthenticated: () => boolean;
  /** Test-only: current per-connection lastSeq (-1 when no seq seen yet). */
  getLastSeq: () => number;
}

// ── Auth carriage helpers ─────────────────────────

/**
 * Fixed Sec-WebSocket-Protocol marker negotiated with Hub WS upgrades.
 * Paired with the raw Hub JWT as a second subprotocol value.
 * Must match hub-server middleware.WSBearerSubprotocol.
 */
export const WS_BEARER_SUBPROTOCOL = 'agenthub.bearer.v1';

/**
 * Build WebSocket subprotocols that carry a Hub JWT without putting it in the URL.
 * Returns undefined when token is missing so the socket opens without auth protocols.
 */
export function buildWSAuthProtocols(token: string | null | undefined): string[] | undefined {
  if (!token) return undefined;
  return [WS_BEARER_SUBPROTOCOL, token];
}

/** Legacy query-token helper kept for tests and optional fallback callers. */
export function withAccessToken(url: string, token: string | null): string {
  if (!token) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('access_token', token);
    return parsed.toString();
  } catch {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}access_token=${encodeURIComponent(token)}`;
  }
}

// ── Implementation ───────────────────────────────

export function createHubWS(opts: HubWSOptions): HubWSHandle {
  const baseUrl = opts.url;
  const useQueryFallback = opts.useQueryTokenFallback === true;

  const connectURL = (): string => {
    if (!useQueryFallback) return baseUrl;
    return withAccessToken(baseUrl, opts.getToken());
  };

  const authProtocols = (): string[] | undefined => buildWSAuthProtocols(opts.getToken());

  const transport: Transport =
    opts.transport ??
    new WebSocketTransport({
      url: baseUrl,
      protocols: authProtocols,
      maxRetries: 10,
    });

  const typedHandlers = new Map<string, Set<(payload: unknown) => void>>();
  const anyHandlers = new Set<(type: string, payload: unknown) => void>();
  const gapHandlers = new Set<(payload: HubWSGapPayload) => void>();

  let authenticated = false;
  // Per-connection last observed seq_id. -1 means no seq-bearing frame yet on
  // this connection. Reset on every transport 'connected' transition because
  // the server-side seq counter is per-connection (conn.go:41-45).
  let lastSeq = -1;

  // ── Auth + seq reset on every (re)connect ───────

  transport.on('status', (status: TransportStatus) => {
    if (status === 'connected') {
      authenticated = false;
      lastSeq = -1;
    }
    if (status === 'disconnected') {
      authenticated = false;
    }
  });

  // ── Message routing ─────────────────────────────

  transport.on('message', (raw: unknown) => {
    // Transport delivers parsed JSON objects, or raw strings on parse failure.
    let msg: Record<string, unknown>;
    if (typeof raw === 'string') {
      try {
        msg = JSON.parse(raw);
      } catch {
        return; // skip unparseable
      }
    } else if (typeof raw === 'object' && raw !== null) {
      msg = raw as Record<string, unknown>;
    } else {
      return;
    }

    const frameType = typeof msg.type === 'string' ? msg.type : '';
    const payload = 'payload' in msg ? msg.payload : undefined;

    // seq_id is omitempty on the wire; only frames stamped by Manager.PushToConn
    // carry it. Frames without seq_id do not participate in gap detection.
    const seqRaw = msg.seq_id;
    const hasSeq = typeof seqRaw === 'number' && Number.isFinite(seqRaw);
    const seq = hasSeq ? (seqRaw as number) : null;

    // ── Auth responses ──────────────────────────
    if (frameType === HUB_EVENTS.AUTH_OK) {
      authenticated = true;
      // auth.ok may itself carry seq_id (first frame); seed lastSeq if so.
      if (seq !== null) {
        lastSeq = seq;
      }
      opts.onAuthSuccess?.();
      return;
    }
    // Drop application events before auth
    if (!authenticated) return;

    // device.kicked: the Hub invalidated this device session (e.g. replaced).
    // Stop auto-reconnect so we don't hammer the server with a dead token;
    // the auth middleware clears the session and the UI prompts re-login.
    if (frameType === HUB_EVENTS.DEVICE_KICKED) {
      authenticated = false;
      transport.close();
      return;
    }

    // ── Seq gap / duplicate detection (#2101 G1) ──
    // Only applies to seq-bearing frames after auth. Duplicate frames
    // (seq <= lastSeq) are dropped silently. A gap (seq > lastSeq + 1)
    // fires the internal gap event and updates lastSeq to the received
    // value so subsequent frames continue from the new baseline.
    if (seq !== null) {
      if (lastSeq !== -1 && seq <= lastSeq) {
        // Duplicate / out-of-order replay — drop without dispatch.
        return;
      }
      if (lastSeq !== -1 && seq > lastSeq + 1) {
        const gapPayload: HubWSGapPayload = {
          lastSeq,
          receivedSeq: seq,
          gapSize: seq - lastSeq - 1,
        };
        console.warn(
          `[HubWS] seq gap detected: lastSeq=${lastSeq} received=${seq} missing=${gapPayload.gapSize}`,
        );
        for (const fn of gapHandlers) {
          try {
            fn(gapPayload);
          } catch (e) {
            console.error('[HubWS] gap handler error:', e);
          }
        }
      }
      lastSeq = seq;
    }

    // Route to typed handlers
    const handlers = typedHandlers.get(frameType);
    if (handlers) {
      for (const fn of handlers) {
        try {
          fn(payload);
        } catch (e) {
          console.error(`HubWS handler error for "${frameType}":`, e);
        }
      }
    }

    // Route to catch-all handlers
    for (const fn of anyHandlers) {
      try {
        fn(frameType, payload);
      } catch (e) {
        console.error(`HubWS any handler error for "${frameType}":`, e);
      }
    }
  });

  // ── Public API ──────────────────────────────────

  return {
    connect(): void {
      transport.connect(connectURL());
    },

    send(type: string, payload: unknown): void {
      transport.send({ type, payload });
    },

    sendTyping(sessionId: string): void {
      transport.send({ type: HUB_EVENTS.TYPING, payload: { session_id: sessionId } });
    },

    on(type: HubEventType, handler: (payload: unknown) => void): () => void {
      let handlers = typedHandlers.get(type);
      if (!handlers) {
        handlers = new Set();
        typedHandlers.set(type, handlers);
      }
      handlers.add(handler);
      return () => {
        typedHandlers.get(type)?.delete(handler);
      };
    },

    onAny(handler: (type: string, payload: unknown) => void): () => void {
      anyHandlers.add(handler);
      return () => {
        anyHandlers.delete(handler);
      };
    },

    onGap(handler: (payload: HubWSGapPayload) => void): () => void {
      gapHandlers.add(handler);
      return () => {
        gapHandlers.delete(handler);
      };
    },

    onStatus(handler: (status: TransportStatus) => void): () => void {
      return transport.on('status', handler);
    },

    close(): void {
      authenticated = false;
      lastSeq = -1;
      transport.close();
      typedHandlers.clear();
      anyHandlers.clear();
      gapHandlers.clear();
    },

    reconnect(): void {
      authenticated = false;
      lastSeq = -1;
      if (transport.reconnect) {
        transport.reconnect(connectURL());
        return;
      }
      transport.connect(connectURL());
    },

    getStatus(): TransportStatus {
      return transport.getStatus();
    },

    isAuthenticated(): boolean {
      return authenticated;
    },

    getLastSeq(): number {
      return lastSeq;
    },
  };
}
