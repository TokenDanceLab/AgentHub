// Hub WebSocket event → React Query cache + Zustand store bridge (Desktop).
// Subscribes to Hub WS events and dispatches cache invalidations and store
// updates. Desktop uses this for Hub-connected team run tracking and
// real-time state sync.
//
// The Desktop has two WS connections:
// 1. Edge local event stream (edgeEventBridge.ts) — runtime events
// 2. Hub WS (this bridge) — team/agent/IM dispatch events from the Hub

import type { QueryClient } from '@tanstack/react-query';
import { HUB_EVENTS, type HubEventType } from '@shared/hubEvents';
import { hubQueryKeys } from '@shared/stores/queryKeys';
import { getPinMapStore } from '@shared/transcript';
import { useToastStore } from '@shared/ui/toast';
import { getI18n } from 'react-i18next';
import type { HubWSGapPayload } from '@shared/hub/hubWS';
import { resyncMessagesAfterReconnect, type MessagesResyncHubClient } from '@shared/hub/hubMessagesResync';
import type {
  HubAgentDispatchPayload,
  HubAgentDonePayload,
  HubAgentFailedPayload,
  HubAgentCancelPayload,
  HubMessage,
  HubNotification,
  HubSession,
  HubFriendEventPayload,
} from '@shared/hub/hubClient';
import { useTaskBridgeStore, type AgentTask } from '@/stores/taskBridgeStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useNotificationStore } from '@/stores/notificationStore';

// ── Helpers ──────────────────────────────────────────────────────

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function invalidateQuery(qc: QueryClient, key: readonly unknown[]) {
  void qc.invalidateQueries({ queryKey: key }).catch(() => {
    /* non-fatal */
  });
}

function invalidateAllWithPrefix(qc: QueryClient, prefix: readonly unknown[]) {
  void qc.invalidateQueries({ queryKey: prefix }).catch(() => {
    /* non-fatal */
  });
}

// ── Store refs (lazy — only accessed in callbacks) ────────────

function getTaskBridge() {
  return useTaskBridgeStore.getState();
}

function getConnection() {
  return useConnectionStore.getState();
}

function getNotifications() {
  return useNotificationStore.getState();
}

// ── Event handlers ──────────────────────────────────────────────

// ── Message events ────────────────────────────────────────────

function onMessageNew(qc: QueryClient, payload: unknown) {
  const msg = payload as HubMessage;
  const sessionId = str(msg?.session_id || msg?.id);
  if (sessionId) {
    invalidateQuery(qc, hubQueryKeys.threads.messages(sessionId));
    invalidateQuery(qc, hubQueryKeys.threads.detail(sessionId));
  }
}

function onMessageRecall(qc: QueryClient, payload: unknown) {
  const data = payload as { session_id?: string; id?: string; message_id?: string };
  const sessionId = str(data?.session_id);
  if (sessionId) {
    invalidateQuery(qc, hubQueryKeys.threads.messages(sessionId));
  }
}

function onMessagePin(qc: QueryClient, payload: unknown) {
  const data = payload as { session_id?: string; message_id?: string };
  const sessionId = str(data?.session_id);
  if (sessionId) {
    invalidateQuery(qc, hubQueryKeys.threads.pins(sessionId));
    invalidateQuery(qc, hubQueryKeys.threads.detail(sessionId));
    // Feed the pinMap store (session-scoped): the active session bucket is
    // set by loadPinnedForSession in useDesktopWorkbenchModel; frames landing
    // before any seed are dropped by the store (no active session yet).
    getPinMapStore().handleFrame(HUB_EVENTS.MESSAGE_PIN, payload);
  }
}

function onMessageUnpin(qc: QueryClient, payload: unknown) {
  const data = payload as { session_id?: string; message_id?: string };
  const sessionId = str(data?.session_id);
  if (sessionId) {
    invalidateQuery(qc, hubQueryKeys.threads.pins(sessionId));
    invalidateQuery(qc, hubQueryKeys.threads.detail(sessionId));
    getPinMapStore().handleFrame(HUB_EVENTS.MESSAGE_UNPIN, payload);
  }
}

function onMessageReactionAdded(qc: QueryClient, payload: unknown) {
  // Reactions are metadata on messages — invalidate messages for that session
  const data = payload as { session_id?: string; message_id?: string };
  const sessionId = str(data?.session_id);
  if (sessionId) {
    invalidateQuery(qc, hubQueryKeys.threads.messages(sessionId));
  }
}

function onMessageReactionRemoved(qc: QueryClient, payload: unknown) {
  const data = payload as { session_id?: string; message_id?: string };
  const sessionId = str(data?.session_id);
  if (sessionId) {
    invalidateQuery(qc, hubQueryKeys.threads.messages(sessionId));
  }
}

function onMessageRead(qc: QueryClient, payload: unknown) {
  // read receipts affect thread-level unread_count → invalidate thread detail
  const data = payload as { session_id?: string; user_id?: string; last_read_seq?: number };
  const sessionId = str(data?.session_id);
  if (sessionId) {
    invalidateQuery(qc, hubQueryKeys.threads.detail(sessionId));
  }
}

// ── Session events ─────────────────────────────────────────────

function onSessionCreated(qc: QueryClient, _payload: unknown) {
  invalidateAllWithPrefix(qc, hubQueryKeys.threads.root);
  invalidateQuery(qc, hubQueryKeys.contacts.list);
}

function onSessionDissolved(qc: QueryClient, payload: unknown) {
  const data = payload as { session_id?: string };
  const sessionId = str(data?.session_id);
  if (sessionId) {
    invalidateQuery(qc, hubQueryKeys.threads.detail(sessionId));
    invalidateQuery(qc, hubQueryKeys.threads.messages(sessionId));
  }
  invalidateAllWithPrefix(qc, hubQueryKeys.threads.root);

  // Surface a user-visible toast so "session dissolved" is not silently
  // swallowed as a cache invalidation (#2072 P2-⑰).
  try {
    const i18n = getI18n();
    const message = i18n?.isInitialized
      ? i18n.t('hub.toast.sessionDissolved', 'This session has been dissolved')
      : 'This session has been dissolved';
    useToastStore.getState().addToast({ type: 'info', message });
  } catch {
    // i18n or toast store unavailable — non-fatal
  }
}

function onSessionMemberJoined(qc: QueryClient, payload: unknown) {
  const data = payload as { session_id?: string; member_id?: string; member_type?: string };
  const sessionId = str(data?.session_id);
  if (sessionId) {
    invalidateQuery(qc, hubQueryKeys.threads.detail(sessionId));
  }
}

function onSessionMemberLeft(qc: QueryClient, payload: unknown) {
  const data = payload as { session_id?: string; member_id?: string; member_type?: string };
  const sessionId = str(data?.session_id);
  if (sessionId) {
    invalidateQuery(qc, hubQueryKeys.threads.detail(sessionId));
  }
}

function onSessionInfoUpdated(qc: QueryClient, payload: unknown) {
  const data = payload as Partial<HubSession> & { session_id: string };
  const sessionId = str(data?.session_id);
  if (sessionId) {
    invalidateQuery(qc, hubQueryKeys.threads.detail(sessionId));
  }
}

// ── Agent events ───────────────────────────────────────────────

function onAgentDispatch(qc: QueryClient, payload: unknown) {
  const data = payload as HubAgentDispatchPayload;

  const task: AgentTask = {
    taskId: str(data?.task_id),
    agentId: str(data?.agent_instance_id || data?.custom_agent_id),
    prompt: str(data?.system_prompt || ''),
    threadId: str(data?.session_id),
    status: 'queued',
    dispatchPayload: (isObj(data) ? data : {}) as Record<string, unknown>,
    createdAt: new Date().toISOString(),
  };

  if (task.taskId) {
    getTaskBridge().addTask(task);
  }

  invalidateAllWithPrefix(qc, hubQueryKeys.agentTeams.root);
  const agentId = str(data?.agent_instance_id);
  if (agentId) {
    invalidateQuery(qc, hubQueryKeys.agents.detail(agentId));
  }
  invalidateQuery(qc, hubQueryKeys.agents.list());
}

function onAgentStream(_qc: QueryClient, _payload: unknown) {
  // Streaming events are handled by the real-time layer
}

function onAgentDone(qc: QueryClient, payload: unknown) {
  const data = payload as HubAgentDonePayload;
  const taskId = str(data?.task_id);

  if (taskId) {
    getTaskBridge().updateTask(taskId, { status: 'done' });
  }

  // Find the thread affected by the completed agent task
  const task = taskId
    ? getTaskBridge().tasks.find((t) => t.taskId === taskId)
    : undefined;
  const threadId = task?.threadId;
  if (threadId) {
    invalidateQuery(qc, hubQueryKeys.threads.detail(threadId));
    invalidateQuery(qc, hubQueryKeys.threads.messages(threadId));
  }

  invalidateAllWithPrefix(qc, hubQueryKeys.agentTeams.root);
}

function onAgentFailed(qc: QueryClient, payload: unknown) {
  const data = payload as HubAgentFailedPayload;
  const taskId = str(data?.task_id);
  const error = str(data?.error || data?.error_message);

  if (taskId) {
    getTaskBridge().updateTask(taskId, { status: 'failed', ...(error ? { error } : {}) });
  }

  invalidateAllWithPrefix(qc, hubQueryKeys.agentTeams.root);
}

function onAgentCancel(qc: QueryClient, payload: unknown) {
  const data = payload as HubAgentCancelPayload;
  const taskId = str(data?.task_id);

  if (taskId) {
    getTaskBridge().updateTask(taskId, { status: 'failed' });
    getTaskBridge().removeTask(taskId);
  }

  invalidateAllWithPrefix(qc, hubQueryKeys.agentTeams.root);
}

function onAgentControl(_qc: QueryClient, _payload: unknown) {
  // Agent control events (e.g., permission decisions from Hub relay)
  // are processed by useHubIntegration — no cache invalidation needed
}

// ── Notification & social events ───────────────────────────────

function onNotificationNew(qc: QueryClient, payload: unknown) {
  const n = payload as HubNotification;
  if (n?.id) {
    getNotifications().addNotification({
      id: n.id,
      type: (n.type as 'friend_request' | 'agent_task' | 'message' | 'system') ?? 'system',
      title: str(n.title),
      body: str(n.body ?? n.payload),
      read: false,
      createdAt: n.created_at ?? new Date().toISOString(),
    });
  }
  invalidateAllWithPrefix(qc, hubQueryKeys.notifications.root);
}

function onFriendRequest(qc: QueryClient, payload: unknown) {
  const rec = payload as HubFriendEventPayload;
  if (rec) {
    getNotifications().addNotification({
      id: `friend-${str(rec.user_id) ?? 'unknown'}-${Date.now()}`,
      type: 'friend_request',
      title: 'New Friend Request',
      body: `${rec.nickname ?? rec.username ?? 'Someone'} wants to be your friend`,
      read: false,
      createdAt: new Date().toISOString(),
    });
  }
  invalidateQuery(qc, hubQueryKeys.contacts.friendRequests);
}

function onFriendAccepted(qc: QueryClient, payload: unknown) {
  const rec = payload as HubFriendEventPayload;
  if (rec) {
    getNotifications().addNotification({
      id: `friend-accepted-${str(rec.user_id) ?? 'unknown'}-${Date.now()}`,
      type: 'friend_request',
      title: 'Friend Request Accepted',
      body: `${rec.nickname ?? rec.username ?? 'Someone'} accepted your friend request`,
      read: false,
      createdAt: new Date().toISOString(),
    });
  }
  invalidateQuery(qc, hubQueryKeys.contacts.list);
  invalidateQuery(qc, hubQueryKeys.contacts.friendRequests);
}

// ── Device events ──────────────────────────────────────────────

function onDeviceOnline(qc: QueryClient, _payload: unknown) {
  getConnection().setOnline(true, null);
  invalidateAllWithPrefix(qc, hubQueryKeys.executionTargets.root);
}

function onDeviceOffline(qc: QueryClient, _payload: unknown) {
  invalidateAllWithPrefix(qc, hubQueryKeys.executionTargets.root);
}

function onDeviceKicked(qc: QueryClient, payload: unknown) {
  // Hub pushes device.kicked only to the connection being replaced
  // (events.go onRouteSet → oldConnID), so receiving it here always means
  // THIS session lost to a login elsewhere: surface feedback and hand the
  // shell back to the login entry via the connection store.
  const data = payload as { reason?: unknown };
  const reason = str(data?.reason) || 'logged_in_elsewhere';
  getConnection().markKicked(reason);

  const fallbackMessage = 'Signed out: this device session was replaced by a new login.';
  const translate = getI18n()?.t?.bind(getI18n());
  const translated = translate?.('auth.deviceKickedToast', { defaultValue: fallbackMessage });
  const message = typeof translated === 'string' && translated.trim() ? translated : fallbackMessage;
  useToastStore.getState().showToast('warning', message);

  // Hub-owned caches belong to the kicked session; drop them so no stale
  // private data survives into the next login on this device.
  invalidateAllWithPrefix(qc, ['hub']);
}

// ── Team run events ────────────────────────────────────────────

function onTeamRunStarted(qc: QueryClient, _payload: unknown) {
  invalidateAllWithPrefix(qc, hubQueryKeys.agentTeams.root);
}

function onTeamEvent(qc: QueryClient, _payload: unknown) {
  invalidateAllWithPrefix(qc, hubQueryKeys.agentTeams.root);
}

function onTeamAssignmentDone(qc: QueryClient, _payload: unknown) {
  invalidateAllWithPrefix(qc, hubQueryKeys.agentTeams.root);
}

function onTeamAssignmentFailed(qc: QueryClient, _payload: unknown) {
  invalidateAllWithPrefix(qc, hubQueryKeys.agentTeams.root);
}

// ── Event → handler mapping ────────────────────────────────────

type HubEventHandler = (qc: QueryClient, payload: unknown) => void;

const HUB_EVENT_HANDLERS: Record<string, HubEventHandler> = {
  [HUB_EVENTS.MESSAGE_NEW]: onMessageNew,
  [HUB_EVENTS.MESSAGE_RECALL]: onMessageRecall,
  [HUB_EVENTS.MESSAGE_PIN]: onMessagePin,
  [HUB_EVENTS.MESSAGE_UNPIN]: onMessageUnpin,
  [HUB_EVENTS.MESSAGE_REACTION_ADDED]: onMessageReactionAdded,
  [HUB_EVENTS.MESSAGE_REACTION_REMOVED]: onMessageReactionRemoved,
  [HUB_EVENTS.MESSAGE_READ]: onMessageRead,
  [HUB_EVENTS.SESSION_CREATED]: onSessionCreated,
  [HUB_EVENTS.SESSION_DISSOLVED]: onSessionDissolved,
  [HUB_EVENTS.SESSION_MEMBER_JOINED]: onSessionMemberJoined,
  [HUB_EVENTS.SESSION_MEMBER_LEFT]: onSessionMemberLeft,
  [HUB_EVENTS.SESSION_INFO_UPDATED]: onSessionInfoUpdated,
  [HUB_EVENTS.AGENT_DISPATCH]: onAgentDispatch,
  [HUB_EVENTS.AGENT_STREAM]: onAgentStream,
  [HUB_EVENTS.AGENT_DONE]: onAgentDone,
  [HUB_EVENTS.AGENT_FAILED]: onAgentFailed,
  [HUB_EVENTS.AGENT_CANCEL]: onAgentCancel,
  [HUB_EVENTS.AGENT_CONTROL]: onAgentControl,
  [HUB_EVENTS.NOTIFICATION_NEW]: onNotificationNew,
  [HUB_EVENTS.FRIEND_REQUEST]: onFriendRequest,
  [HUB_EVENTS.FRIEND_ACCEPTED]: onFriendAccepted,
  [HUB_EVENTS.DEVICE_ONLINE]: onDeviceOnline,
  [HUB_EVENTS.DEVICE_OFFLINE]: onDeviceOffline,
  [HUB_EVENTS.DEVICE_KICKED]: onDeviceKicked,
  [HUB_EVENTS.TEAM_RUN_STARTED]: onTeamRunStarted,
  [HUB_EVENTS.TEAM_EVENT]: onTeamEvent,
  [HUB_EVENTS.TEAM_ASSIGNMENT_DONE]: onTeamAssignmentDone,
  [HUB_EVENTS.TEAM_ASSIGNMENT_FAILED]: onTeamAssignmentFailed,
};

// ── Public API ──────────────────────────────────────────────────

export interface DesktopHubEventBridgeHandle {
  destroy: () => void;
}

/** Minimal on/off interface matching what desktop Hub WS provides. */
export interface DesktopHubWSLike {
  on: (type: HubEventType, handler: (payload: unknown) => void) => () => void;
  /** Optional gap subscription (#2101 G1). Absent in test stubs. */
  onGap?: (handler: (payload: HubWSGapPayload) => void) => () => void;
  /** Optional reconnect subscription (#2101 G4-②). Absent in test stubs. */
  onReconnected?: (handler: () => void) => () => void;
}

/**
 * Wire Desktop Hub WS events to React Query cache invalidation and
 * Zustand store updates. Returns a handle with a `destroy()` method.
 */
interface DesktopHubEventBridgeOptions {
  /** hubClient for incremental message resync on reconnect/gap (#2101 G4-②). */
  hubClient?: MessagesResyncHubClient;
}

export function createDesktopHubEventBridge(
  hubWS: DesktopHubWSLike,
  queryClient: QueryClient,
  options?: DesktopHubEventBridgeOptions,
): DesktopHubEventBridgeHandle {
  const unsubFns: Array<() => void> = [];

  for (const [eventType, handler] of Object.entries(HUB_EVENT_HANDLERS)) {
    const unsub = hubWS.on(eventType as HubEventType, (payload: unknown) => {
      try {
        handler(queryClient, payload);
      } catch (error) {
        console.error(
          `[desktopHubEventBridge] Error handling "${eventType}":`,
          error,
        );
      }
    });
    unsubFns.push(unsub);
  }

  // #2101 G4-②: shared resync trigger for both gap and reconnect events.
  // When hubClient is provided, performs incremental syncMessages(after_seq)
  // per cached session. Falls back to full threads invalidation otherwise.
  const triggerResync = (): void => {
    if (options?.hubClient) {
      void resyncMessagesAfterReconnect({
        queryClient,
        hubClient: options.hubClient,
      }).catch((err) => {
        console.error('[desktopHubEventBridge] resync failed:', err);
      });
    } else {
      invalidateAllWithPrefix(queryClient, hubQueryKeys.threads.root);
    }
  };

  // #2101 G1: On seq_id gap, trigger message resync (incremental or fallback).
  if (hubWS.onGap) {
    const gapUnsub = hubWS.onGap(() => {
      triggerResync();
    });
    unsubFns.push(gapUnsub);
  }

  // #2101 G4-②: On reconnect auth completion, trigger message resync.
  if (hubWS.onReconnected) {
    const reconnUnsub = hubWS.onReconnected(() => {
      triggerResync();
    });
    unsubFns.push(reconnUnsub);
  }

  return {
    destroy(): void {
      for (const unsub of unsubFns) {
        unsub();
      }
      unsubFns.length = 0;
    },
  };
}
