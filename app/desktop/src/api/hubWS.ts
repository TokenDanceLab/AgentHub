// Hub WebSocket client for AgentHub Desktop.
// Manages auth-frame handshake, typed event routing, and reconnection
// via the Transport abstraction.
//
// Protocol (matching hub-server/internal/handler/ws.go + ws/frame.go):
//   1. WebSocket connects to ws://host/client/ws
//   2. Client sends: {"type":"auth","payload":{"access_token":"<jwt>"}}
//   3. Server responds: {"type":"auth.ok","payload":null}
//      or:  {"type":"auth.fail","payload":{"reason":"..."}}
//   4. After auth, bidirectional events flow with {type, payload} framing.
//
// Reconnection: The underlying Transport handles exponential-backoff
// reconnection (max 10 retries). On every reconnect, the auth handshake
// is re-executed automatically. Typed event subscriptions survive
// across reconnects.

import { HUB_WS_URL } from '@/config';
import { WebSocketTransport, type Transport, type TransportStatus } from './transport';
import type { HubEventType } from '@shared/hubEvents';
import { HUB_EVENTS } from '@shared/hubEvents';

// ── Types ─────────────────────────────────────────

export interface HubWSOptions {
  /** Hub WebSocket endpoint (e.g. ws://localhost:8080/client/ws). */
  url?: string;
  /** Returns the current JWT access token, or null if unauthenticated. */
  getToken: () => string | null;
  /** Optional Transport instance (injected for testing). */
  transport?: Transport;
  /** Called after the auth handshake succeeds. */
  onAuthSuccess?: () => void;
  /** Called when the server rejects the auth frame. */
  onAuthFail?: (reason: string) => void;
}

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
}

// ── Implementation ───────────────────────────────

export function createHubWS(opts: HubWSOptions): HubWSHandle {
  const transport: Transport =
    opts.transport ??
    new WebSocketTransport({
      url: opts.url ?? HUB_WS_URL,
      maxRetries: 10,
    });

  const typedHandlers = new Map<string, Set<(payload: unknown) => void>>();
  const anyHandlers = new Set<(type: string, payload: unknown) => void>();

  let authenticated = false;

  // ── Auth on every (re)connect ────────────────────

  transport.on('status', (status: TransportStatus) => {
    if (status === 'connected') {
      authenticated = false;
      const token = opts.getToken();
      if (token) {
        transport.send({ type: HUB_EVENTS.AUTH, payload: { access_token: token } });
      }
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

    // ── Auth responses ──────────────────────────
    if (frameType === HUB_EVENTS.AUTH_OK) {
      authenticated = true;
      opts.onAuthSuccess?.();
      return;
    }
    if (frameType === HUB_EVENTS.AUTH_FAIL) {
      authenticated = false;
      const reason =
        typeof payload === 'object' && payload !== null
          ? String((payload as Record<string, unknown>).reason ?? 'Unknown')
          : 'Unknown';
      opts.onAuthFail?.(reason);
      return;
    }

    // Drop application events before auth
    if (!authenticated) return;

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
      transport.connect();
    },

    send(type: string, payload: unknown): void {
      transport.send({ type, payload });
    },

    sendTyping(sessionId: string): void {
      transport.send({ type: 'typing', payload: { session_id: sessionId } });
    },

    on(type: HubEventType, handler: (payload: unknown) => void): () => void {
      if (!typedHandlers.has(type)) {
        typedHandlers.set(type, new Set());
      }
      typedHandlers.get(type)!.add(handler);
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

    onStatus(handler: (status: TransportStatus) => void): () => void {
      return transport.on('status', handler);
    },

    close(): void {
      authenticated = false;
      transport.close();
      typedHandlers.clear();
      anyHandlers.clear();
    },

    reconnect(): void {
      authenticated = false;
      if (transport.getStatus() !== 'disconnected') {
        transport.close();
      }
      transport.connect();
    },

    getStatus(): TransportStatus {
      return transport.getStatus();
    },

    isAuthenticated(): boolean {
      return authenticated;
    },
  };
}
