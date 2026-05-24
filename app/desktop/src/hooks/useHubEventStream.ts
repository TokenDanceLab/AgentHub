// React hook wrapping hubWS.ts for component-level consumption.
// Manages HubWS lifecycle tied to component mount/unmount and provides
// typed convenience helpers for common Hub event categories.

import { useEffect, useRef, useState, useCallback } from 'react';
import { createHubWS, type HubWSHandle } from '@/api/hubWS';
import type { TransportStatus } from '@/api/transport';
import { HUB_EVENTS } from '@shared/hubEvents';
import type { HubEventType } from '@shared/hubEvents';
import type {
  HubMessage,
  HubNotification,
  HubDevicePresence,
  HubAgentTask,
  HubFrame,
} from '@/api/hubEvents';

// ── Public types ─────────────────────────────────

export interface HubEventStreamState {
  status: TransportStatus;
  lastFrame: HubFrame | null;
  lastMessage: HubMessage | null;
  lastNotification: HubNotification | null;
  lastAgentTask: HubAgentTask | null;
  onlineUsers: string[];
}

export interface HubEventStreamHandle extends HubEventStreamState {
  /** Send a typing indicator for a session. */
  sendTyping: (sessionId: string) => void;
  /** Subscribe to raw Hub frames (after auth). Returns unsubscribe fn. */
  onFrame: (handler: (frame: HubFrame) => void) => () => void;
  /** Subscribe to a specific event type. Returns unsubscribe fn. */
  on: (type: HubEventType, handler: (payload: unknown) => void) => () => void;
  /** Manually trigger reconnection. */
  reconnect: () => void;
}

// ── Hook ────────────────────────────────────────

export function useHubEventStream(
  getToken: () => string | null,
  url?: string,
): HubEventStreamHandle {
  const handleRef = useRef<HubWSHandle | null>(null);

  const [status, setStatus] = useState<TransportStatus>('disconnected');
  const [lastFrame, setLastFrame] = useState<HubFrame | null>(null);
  const [lastMessage, setLastMessage] = useState<HubMessage | null>(null);
  const [lastNotification, setLastNotification] = useState<HubNotification | null>(null);
  const [lastAgentTask, setLastAgentTask] = useState<HubAgentTask | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);

  useEffect(() => {
    const handle = createHubWS({ getToken, url });
    handleRef.current = handle;

    const unsubStatus = handle.onStatus(setStatus);

    const unsubAny = handle.onAny((type: string, payload: unknown) => {
      const frame: HubFrame = { type, payload };
      setLastFrame(frame);

      switch (type) {
        case HUB_EVENTS.MESSAGE_NEW:
          if (payload) setLastMessage(payload as HubMessage);
          break;
        case HUB_EVENTS.NOTIFICATION_NEW:
          if (payload) setLastNotification(payload as HubNotification);
          break;
        case HUB_EVENTS.AGENT_DISPATCH:
        case HUB_EVENTS.AGENT_DONE:
        case HUB_EVENTS.AGENT_FAILED:
          if (payload) setLastAgentTask(payload as HubAgentTask);
          break;
        case HUB_EVENTS.DEVICE_ONLINE:
          if (payload) {
            const p = payload as HubDevicePresence;
            setOnlineUsers((prev) =>
              prev.includes(p.user_id) ? prev : [...prev, p.user_id],
            );
          }
          break;
        case HUB_EVENTS.DEVICE_OFFLINE:
          if (payload) {
            const p = payload as HubDevicePresence;
            setOnlineUsers((prev) => prev.filter((id) => id !== p.user_id));
          }
          break;
      }
    });

    handle.connect();

    return () => {
      unsubStatus();
      unsubAny();
      handle.close();
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getToken, url]);

  const sendTyping = useCallback((sessionId: string) => {
    handleRef.current?.sendTyping(sessionId);
  }, []);

  const onFrame = useCallback((handler: (frame: HubFrame) => void): (() => void) => {
    if (!handleRef.current) {
      return () => {};
    }
    return handleRef.current.onAny((type: string, payload: unknown) => {
      handler({ type, payload });
    });
  }, []);

  const on = useCallback(
    (type: HubEventType, handler: (payload: unknown) => void): (() => void) => {
      if (!handleRef.current) {
        return () => {};
      }
      return handleRef.current.on(type, handler);
    },
    [],
  );

  const reconnect = useCallback(() => {
    handleRef.current?.reconnect();
  }, []);

  return {
    status,
    lastFrame,
    lastMessage,
    lastNotification,
    lastAgentTask,
    onlineUsers,
    sendTyping,
    onFrame,
    on,
    reconnect,
  };
}
