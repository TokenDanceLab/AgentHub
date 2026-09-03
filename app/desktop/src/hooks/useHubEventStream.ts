// React hook wrapping hubWS.ts for component-level consumption.
// Manages HubWS lifecycle tied to component mount/unmount and provides
// typed convenience helpers for common Hub event categories.

import { useEffect, useRef, useState, useCallback } from 'react';
import { createHubWS, type HubWSHandle } from '@shared/hub/hubWS';
import { HUB_WS_URL } from '@/config';
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
import { useNotificationStore } from '@/stores/notificationStore';
import { handleIncomingTyping } from '@shared/chatview/typingPresence';
import {
  createDesktopHubEventBridge,
  type DesktopHubEventBridgeHandle,
} from '@/stores/hubEventBridge';
import { queryClient } from '@/api/queryClient';
import { createHubClient } from '@/api/hubClient';
import { getAccessToken } from '@/hooks/useAuth';
import { hubQueryKeys } from '@shared/stores/queryKeys';

// ── Public types ─────────────────────────────────

interface HubEventStreamState {
  status: TransportStatus;
  lastFrame: HubFrame | null;
  lastMessage: HubMessage | null;
  lastNotification: HubNotification | null;
  lastAgentTask: HubAgentTask | null;
  onlineUsers: string[];
}

interface HubEventStreamHandle extends HubEventStreamState {
  /** The underlying Hub WS handle for lower-level consumers. */
  hubWS: HubWSHandle | null;
  /** Send a typing indicator for a session. */
  sendTyping: (sessionId: string) => void;
  /** Subscribe to raw Hub frames (after auth). Returns unsubscribe fn. */
  onFrame: (handler: (frame: HubFrame) => void) => () => void;
  /** Subscribe to a specific event type. Returns unsubscribe fn. */
  on: (type: HubEventType, handler: (payload: unknown) => void) => () => void;
  /** Manually trigger reconnection. */
  reconnect: () => void;
}

// ── Payload helpers ──────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown, ...keys: string[]): string | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function readSessionId(payload: unknown): string | undefined {
  const rec = asRecord(payload);
  if (!rec) return undefined;
  return readString(rec.session_id) ?? readString(rec.sessionId);
}

// ── Debounce (high-frequency events) ──────────────

const DEBOUNCE_MS = 50;

/** Hub WS event types that fire at high frequency and should be debounced. */
const DEBOUNCED_EVENT_TYPES = new Set<string>([
  HUB_EVENTS.AGENT_STREAM,
  HUB_EVENTS.TEAM_EVENT,
]);

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
  const [hubWS, setHubWS] = useState<HubWSHandle | null>(null);

  const bridgeHandleRef = useRef<DesktopHubEventBridgeHandle | null>(null);

  // Setter-only state: event fan-out for consumers that only need triggers.
  const [, setLastSessionEvent] = useState<{
    type: string;
    payload: unknown;
  } | null>(null);

  useEffect(() => {
    const handle = createHubWS({
      getToken,
      url: url ?? HUB_WS_URL,
    });
    handleRef.current = handle;
    queueMicrotask(() => setHubWS(handle));

    const unsubStatus = handle.onStatus((wsStatus: TransportStatus) => {
      setStatus(wsStatus);
      // Wire Hub WS events to React Query cache + store updates on connect
      if (wsStatus === 'connected') {
        // Backfill data missed while the socket was down: invalidate the
        // message/thread/team caches so React Query refetches the current
        // state from the Hub. Individual event handlers keep caches fresh
        // thereafter, but a reconnect gap is closed by this bulk invalidate.
        void queryClient
          .invalidateQueries({ queryKey: hubQueryKeys.threads.root })
          .catch(() => {
            /* non-fatal */
          });
        void queryClient
          .invalidateQueries({ queryKey: hubQueryKeys.agentTeams.root })
          .catch(() => {
            /* non-fatal */
          });
        if (!bridgeHandleRef.current) {
          // #2101 G4-②: pass hubClient so the bridge can do incremental
          // message resync on reconnect/gap instead of full invalidation.
          const hubClientForResync = createHubClient({ getToken: getAccessToken });
          bridgeHandleRef.current = createDesktopHubEventBridge(handle, queryClient, {
            hubClient: hubClientForResync,
          });
        }
      } else if (wsStatus === 'disconnected') {
        bridgeHandleRef.current?.destroy();
        bridgeHandleRef.current = null;
      }
    });

    // ── High-frequency event debounce ─────────────────
    const pendingByType = new Map<string, unknown>();
    const timersByType = new Map<string, ReturnType<typeof setTimeout>>();

    function flushDebounced(type: string) {
      timersByType.delete(type);
      const payload = pendingByType.get(type);
      pendingByType.delete(type);

      switch (type) {
        case HUB_EVENTS.AGENT_STREAM:
          if (payload) {
            const taskId = readString(payload, 'task_id', 'taskId');
            if (taskId) {
              setLastAgentTask({
                task_id: taskId,
                session_id: readString(payload, 'session_id', 'sessionId') ?? '',
                agent_instance_id: readString(payload, 'agent_instance_id', 'agentInstanceId') ?? '',
                status: 'running',
                content: readString(payload, 'content'),
              } as HubAgentTask);
            }
          }
          break;
        case HUB_EVENTS.TEAM_EVENT:
          if (payload) {
            setLastSessionEvent({ type, payload });
          }
          break;
      }
    }

    function enqueueHighFreq(type: string, payload: unknown) {
      pendingByType.set(type, payload);
      if (!timersByType.has(type)) {
        timersByType.set(type, setTimeout(() => flushDebounced(type), DEBOUNCE_MS));
      }
    }

    // ── Any-event handler ────────────────────────────
    const unsubAny = handle.onAny((type: string, payload: unknown) => {
      const frame: HubFrame = { type, payload };
      setLastFrame(frame);

      // High-frequency events are debounced; skip immediate processing.
      if (DEBOUNCED_EVENT_TYPES.has(type)) {
        enqueueHighFreq(type, payload);
        return;
      }

      switch (type) {
        // ── Message events ──────────────────────
        case HUB_EVENTS.MESSAGE_NEW:
          if (payload) setLastMessage(payload as HubMessage);
          break;

        case HUB_EVENTS.MESSAGE_RECALL:
          if (payload) {
            // Update the last recalled message to mark it recalled
            setLastMessage((prev) => {
              const rec = asRecord(payload);
              if (!rec || !prev) return null;
              const msgId = readString(rec, 'message_id', 'id');
              if (msgId && prev.id === msgId) {
                return { ...prev, recalled: true };
              }
              return prev;
            });
          }
          break;

        case HUB_EVENTS.MESSAGE_PIN:
        case HUB_EVENTS.MESSAGE_UNPIN:
        case HUB_EVENTS.MESSAGE_READ:
        case HUB_EVENTS.MESSAGE_REACTION_ADDED:
        case HUB_EVENTS.MESSAGE_REACTION_REMOVED:
          // Message metadata events — update the last message reference
          // to trigger any dependent UI to refresh (non-rendering side effect)
          if (payload) {
            setLastMessage((prev) => {
              const rec = asRecord(payload);
              if (!rec || !prev) return prev;
              // If it affects the current last message, mark a timestamp bump
              const msgId = readString(rec, 'message_id', 'id');
              if (msgId && prev.id === msgId) {
                return { ...prev };
              }
              return prev;
            });
          }
          break;

        // ── Session events ─────────────────────
        case HUB_EVENTS.SESSION_CREATED:
        case HUB_EVENTS.SESSION_DISSOLVED:
        case HUB_EVENTS.SESSION_MEMBER_JOINED:
        case HUB_EVENTS.SESSION_MEMBER_LEFT:
        case HUB_EVENTS.SESSION_INFO_UPDATED:
          setLastSessionEvent({ type, payload });
          break;

        // ── Notification events ────────────────
        case HUB_EVENTS.NOTIFICATION_NEW:
          if (payload) {
            const n = payload as HubNotification;
            setLastNotification(n);
            useNotificationStore.getState().addNotification({
              id: n.id ?? '',
              type: (n.type as 'friend_request' | 'agent_task' | 'message' | 'system') ?? 'system',
              title: n.title ?? '',
              body: n.body ?? '',
              read: false,
              createdAt: n.created_at ?? new Date().toISOString(),
            });
          }
          break;

        // ── Agent events ───────────────────────
        case HUB_EVENTS.AGENT_DISPATCH:
        case HUB_EVENTS.AGENT_DONE:
        case HUB_EVENTS.AGENT_FAILED:
        case HUB_EVENTS.AGENT_CANCEL:
          if (payload) setLastAgentTask(payload as HubAgentTask);
          break;

        // ── Typing indicator — inbound ──────────
        case HUB_EVENTS.TYPING:
          if (payload) {
            const sessionId = readSessionId(payload);
            const userId = readString(payload, 'user_id');
            if (sessionId && userId) {
              handleIncomingTyping(sessionId, userId);
            }
          }
          break;

        case HUB_EVENTS.AGENT_CONTROL:
          // Agent control events (e.g. permission decisions from Hub relay)
          // Processed by useHubIntegration — no state update needed here
          break;

        // ── Device events ──────────────────────
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

        case HUB_EVENTS.DEVICE_KICKED:
          if (payload) {
            const p = payload as HubDevicePresence;
            setOnlineUsers((prev) => prev.filter((id) => id !== p.user_id));
          }
          break;

        // ── Friend / contact events ────────────
        case HUB_EVENTS.FRIEND_REQUEST:
          if (payload) {
            const rec = asRecord(payload);
            useNotificationStore.getState().addNotification({
              id: `friend-${readString(rec, 'user_id') ?? 'unknown'}-${Date.now()}`,
              type: 'friend_request',
              title: 'New Friend Request',
              body: `${readString(rec, 'nickname') ?? readString(rec, 'username') ?? 'Someone'} wants to be your friend`,
              read: false,
              createdAt: readString(rec, 'created_at') ?? new Date().toISOString(),
            });
          }
          break;

        case HUB_EVENTS.FRIEND_ACCEPTED:
          if (payload) {
            const rec = asRecord(payload);
            useNotificationStore.getState().addNotification({
              id: `friend-accepted-${readString(rec, 'user_id') ?? 'unknown'}-${Date.now()}`,
              type: 'friend_request',
              title: 'Friend Request Accepted',
              body: `${readString(rec, 'nickname') ?? readString(rec, 'username') ?? 'Someone'} accepted your friend request`,
              read: false,
              createdAt: readString(rec, 'created_at') ?? new Date().toISOString(),
            });
          }
          break;

        // ── Team run events ────────────────────
        case HUB_EVENTS.TEAM_RUN_STARTED:
        case HUB_EVENTS.TEAM_ASSIGNMENT_DONE:
        case HUB_EVENTS.TEAM_ASSIGNMENT_FAILED:
          // Team run lifecycle — update the task bridge for team consumers
          if (payload) {
            setLastSessionEvent({ type, payload });
          }
          break;

        // ── Auth events ────────────────────────
        case HUB_EVENTS.AUTH_OK:
          // Auth lifecycle already handled by hubWS internals
          break;
      }
    });

    handle.connect();

    return () => {
      for (const timer of timersByType.values()) clearTimeout(timer);
      timersByType.clear();
      pendingByType.clear();
      unsubStatus();
      unsubAny();
      bridgeHandleRef.current?.destroy();
      bridgeHandleRef.current = null;
      handle.close();
      handleRef.current = null;
      queueMicrotask(() => setHubWS(null));
    };
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
    hubWS,
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
