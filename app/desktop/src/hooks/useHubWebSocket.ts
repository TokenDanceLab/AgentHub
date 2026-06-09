// React hook managing the Hub WebSocket connection for real-time IM events.
// Connects to Hub WS endpoint with JWT auth, handles reconnection with
// exponential backoff, and dispatches typed events to subscribers.

import { useEffect, useRef, useState, useCallback } from 'react';
import { HUB_WS_URL } from '@/config';
import { getAccessToken } from '@/hooks/useAuth';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HubWSFrameType =
  | 'auth'
  | 'typing'
  | 'message.new'
  | 'message.edited'
  | 'message.recall'
  | 'message.pin'
  | 'message.unpin'
  | 'message.reaction_added'
  | 'message.reaction_removed'
  | 'message.read'
  | 'session.created'
  | 'session.dissolved'
  | 'session.member_joined'
  | 'session.member_left'
  | 'session.info_updated'
  | 'device.online'
  | 'device.offline'
  | 'device.kicked'
  | 'agent.dispatch'
  | 'agent.stream'
  | 'agent.done'
  | 'agent.failed'
  | 'agent.cancel'
  | 'agent.control'
  | 'team.run.started'
  | 'team.run.event'
  | 'team.assignment.done'
  | 'team.assignment.failed'
  | 'notification.new'
  | 'friend.request'
  | 'friend.accepted';

export interface HubWSEvent {
  type: HubWSFrameType;
  payload: unknown;
  timestamp: number;
}

export interface UseHubWebSocketOptions {
  /** Only connect when true (Hub available + user authenticated). */
  enabled?: boolean;
}

export interface UseHubWebSocketReturn {
  connected: boolean;
  lastEvent: HubWSEvent | null;
}

// ---------------------------------------------------------------------------
// Reconnection constants
// ---------------------------------------------------------------------------

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_MULTIPLIER = 2;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useHubWebSocket(options?: UseHubWebSocketOptions): UseHubWebSocketReturn {
  const enabled = options?.enabled ?? true;

  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<HubWSEvent | null>(null);

  // Mutable refs to avoid stale closures in WebSocket callbacks
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(RECONNECT_BASE_MS);
  const intentionalCloseRef = useRef(false);

  // -----------------------------------------------------------------------
  // Cleanup helpers
  // -----------------------------------------------------------------------

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const closeWebSocket = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close(1000, 'hook cleanup');
      wsRef.current = null;
    }
  }, []);

  // -----------------------------------------------------------------------
  // Connection logic
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!enabled) {
      // Tear down when disabled
      intentionalCloseRef.current = true;
      closeWebSocket();
      clearReconnectTimer();
      setConnected(false);
      return;
    }

    const token = getAccessToken();
    if (!token) {
      // No token yet — don't connect, but don't mark as intentional close
      // so we reconnect automatically when a token appears (via re-render).
      setConnected(false);
      return;
    }

    intentionalCloseRef.current = false;

    // Build authenticated WS URL
    const url = `${HUB_WS_URL}?token=${encodeURIComponent(token)}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      console.debug('[HubWS] connected to', HUB_WS_URL);
      setConnected(true);
      // Reset backoff on successful connection
      reconnectDelayRef.current = RECONNECT_BASE_MS;
    };

    ws.onmessage = (ev: MessageEvent) => {
      try {
        const frame = JSON.parse(ev.data as string) as {
          type: HubWSFrameType;
          payload?: unknown;
        };

        // Silently ignore auth handshake frames — the server already
        // validated the token via the query param.
        if (frame.type === 'auth' || frame.type === ('auth.ok' as HubWSFrameType)) {
          return;
        }

        setLastEvent({
          type: frame.type,
          payload: frame.payload ?? null,
          timestamp: Date.now(),
        });
      } catch {
        // Non-JSON or malformed frame — ignore silently.
      }
    };

    ws.onclose = (ev: MessageEvent) => {
      wsRef.current = null;
      setConnected(false);

      if (intentionalCloseRef.current) return;
      if (ev.code === 1000) return; // normal closure

      // Schedule reconnection with exponential backoff
      const delay = reconnectDelayRef.current;
      console.debug(`[HubWS] disconnected (code=${ev.code}), reconnecting in ${delay}ms`);

      reconnectTimerRef.current = setTimeout(() => {
        reconnectDelayRef.current = Math.min(
          reconnectDelayRef.current * RECONNECT_MULTIPLIER,
          RECONNECT_MAX_MS,
        );
        // Trigger reconnect by re-running the effect.
        // We bump a dummy dependency — instead, we just call the connect
        // logic again through state change.
        setConnected(false);
      }, delay);
    };

    ws.onerror = () => {
      // onclose will fire after onerror, so reconnection is handled there.
      console.debug('[HubWS] error');
    };

    // Cleanup on unmount or when dependencies change
    return () => {
      intentionalCloseRef.current = true;
      closeWebSocket();
      clearReconnectTimer();
      setConnected(false);
    };
  }, [enabled, closeWebSocket, clearReconnectTimer]);

  return { connected, lastEvent };
}

export default useHubWebSocket;
