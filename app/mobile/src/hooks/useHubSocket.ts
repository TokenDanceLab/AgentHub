import { useRef, useState, useCallback, useEffect } from "react";
import type { EventEnvelope, AnyEvent } from "@agenthub/shared";
import { HUB_WS_URL } from "../config";

type HubEventCallback = (event: AnyEvent) => void;

interface UseHubSocketOptions {
  token?: string | null;
  onEvent?: HubEventCallback;
  autoConnect?: boolean;
}

interface HubSocketState {
  connected: boolean;
  reconnecting: boolean;
  error: string | null;
}

/**
 * WebSocket connection to Hub Server with exponential backoff reconnection.
 *
 * Uses the proven generation-counter pattern: every reconnect increments a
 * generation counter; stale async handlers from previous connections are
 * silently dropped.
 */
export function useHubSocket(options: UseHubSocketOptions = {}) {
  const { token, onEvent, autoConnect = true } = options;

  const [state, setState] = useState<HubSocketState>({
    connected: false,
    reconnecting: false,
    error: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const generationRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const clearReconnect = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    clearReconnect();

    const gen = ++generationRef.current;
    const url = token ? `${HUB_WS_URL}?token=${encodeURIComponent(token)}` : HUB_WS_URL;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (gen !== generationRef.current) return;
      reconnectAttemptRef.current = 0;
      setState({ connected: true, reconnecting: false, error: null });
    };

    ws.onmessage = (event) => {
      if (gen !== generationRef.current) return;
      try {
        const envelope = JSON.parse(event.data) as EventEnvelope;
        onEventRef.current?.(envelope as unknown as AnyEvent);
      } catch {
        // Ignore unparseable messages
      }
    };

    ws.onclose = (event) => {
      if (gen !== generationRef.current) return;
      wsRef.current = null;
      setState((s) => ({ ...s, connected: false }));

      // Don't reconnect on normal closure
      if (event.code === 1000) return;

      scheduleReconnect(gen);
    };

    ws.onerror = () => {
      if (gen !== generationRef.current) return;
      // onclose will fire after onerror, triggering reconnect
    };
  }, [token, clearReconnect]);

  const scheduleReconnect = useCallback(
    (gen: number) => {
      const attempt = reconnectAttemptRef.current;
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s cap + jitter
      const delay = Math.min(1000 * Math.pow(2, attempt), 16000);
      const jitter = Math.random() * 1000;

      setState((s) => ({ ...s, reconnecting: true }));

      reconnectTimerRef.current = setTimeout(() => {
        if (gen !== generationRef.current) return;
        reconnectAttemptRef.current = attempt + 1;
        connect();
      }, delay + jitter);
    },
    [connect],
  );

  const disconnect = useCallback(() => {
    clearReconnect();
    generationRef.current++;
    wsRef.current?.close(1000, "client disconnect");
    wsRef.current = null;
    reconnectAttemptRef.current = 0;
    setState({ connected: false, reconnecting: false, error: null });
  }, [clearReconnect]);

  useEffect(() => {
    if (autoConnect) {
      connect();
    }
    return () => {
      clearReconnect();
      generationRef.current++;
      wsRef.current?.close(1000, "unmount");
      wsRef.current = null;
    };
  }, [autoConnect, connect, clearReconnect]);

  return { ...state, connect, disconnect };
}
