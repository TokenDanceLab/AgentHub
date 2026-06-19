// WebSocket event → React Query cache + Zustand store bridge.
// Subscribes to Hub WS events and dispatches cache invalidations and store
// updates so that server-pushed changes immediately reflect in the UI
// without waiting for the next polling interval.
//
// This is the central integration point between the Hub WebSocket layer
// and the frontend state layer. All WS event → store wiring lives here.

import type { QueryClient } from '@tanstack/react-query';
import { HUB_EVENTS } from '@shared/hubEvents';
import { hubQueryKeys } from '@shared/stores/queryKeys';
import type {
  HubAgentDispatchPayload,
  HubAgentDonePayload,
  HubAgentFailedPayload,
  HubAgentCancelPayload,
  HubAgentRegeneratePayload,
  HubMessage,
  HubNotification,
  HubSession,
  HubFriendEventPayload,
  HubDevicePresencePayload,
  HubDeviceKickedPayload,
} from '@shared/hubClient';
import type { HubWSHandle } from '@/api/hubWS';
import { useTaskBridgeStore } from '@/stores/taskBridgeStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useRunStore } from '@/stores/runStore';
import type { AgentTask } from '@/stores/taskBridgeStore';

// ── Helpers ──────────────────────────────────────────────────────

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

// ── Store references (lazy — only accessed in callbacks) ────────

function getTaskBridge() {
  return useTaskBridgeStore.getState();
}

function getConnection() {
  return useConnectionStore.getState();
}

function getRun() {
  return useRunStore.getState();
}

// ── Query cache invalidation helpers ────────────────────────────

function invalidateQuery(qc: QueryClient, key: readonly unknown[]) {
  // Fire-and-forget; errors are non-fatal for cache sync
  void qc.invalidateQueries({ queryKey: key }).catch(() => {
    /* ignore */
  });
}

function invalidateAllWithPrefix(qc: QueryClient, prefix: readonly unknown[]) {
  void qc.invalidateQueries({ queryKey: prefix }).catch(() => {
    /* ignore */
  });
}

// ── Event handlers ──────────────────────────────────────────────

function onMessageNew(qc: QueryClient, payload: unknown) {
  const msg = payload as HubMessage;
  const sessionId = str(msg?.session_id || msg?.id);
  if (sessionId) {
    invalidateQuery(qc, hubQueryKeys.threads.messages(sessionId));
    // Also invalidate the thread list to update last_message / unread_count
    invalidateAllWithPrefix(qc, hubQueryKeys.threads.root);
  }
}

function onMessageEdited(qc: QueryClient, payload: unknown) {
  const data = payload as { session_id?: string; message_id?: string };
  const sessionId = str(data?.session_id);
  if (sessionId) {
    invalidateQuery(qc, hubQueryKeys.threads.messages(sessionId));
  }
}

function onMessageRecall(qc: QueryClient, payload: unknown) {
  const data = payload as { session_id?: string; id?: string; message_id?: string };
  const sessionId = str(data?.session_id);
  if (sessionId) {
    invalidateQuery(qc, hubQueryKeys.threads.messages(sessionId));
  }
}

function onMessagePin(_qc: QueryClient, _payload: unknown) {
  invalidateAllWithPrefix(_qc, hubQueryKeys.threads.root);
}

function onMessageUnpin(_qc: QueryClient, _payload: unknown) {
  invalidateAllWithPrefix(_qc, hubQueryKeys.threads.root);
}

function onMessageReactionAdded(_qc: QueryClient, _payload: unknown) {
  invalidateAllWithPrefix(_qc, hubQueryKeys.threads.root);
}

function onMessageReactionRemoved(_qc: QueryClient, _payload: unknown) {
  invalidateAllWithPrefix(_qc, hubQueryKeys.threads.root);
}

function onMessageRead(_qc: QueryClient, _payload: unknown) {
  // read receipts affect thread-level unread_count → invalidate thread list
  invalidateAllWithPrefix(_qc, hubQueryKeys.threads.root);
}

function onSessionCreated(qc: QueryClient, _payload: unknown) {
  invalidateAllWithPrefix(qc, hubQueryKeys.threads.root);
  invalidateAllWithPrefix(qc, hubQueryKeys.contacts.root);
}

function onSessionDissolved(qc: QueryClient, payload: unknown) {
  const data = payload as { session_id?: string };
  const sessionId = str(data?.session_id);
  if (sessionId) {
    invalidateQuery(qc, hubQueryKeys.threads.detail(sessionId));
    invalidateQuery(qc, hubQueryKeys.threads.messages(sessionId));
  }
  invalidateAllWithPrefix(qc, hubQueryKeys.threads.root);
}

function onSessionMemberJoined(qc: QueryClient, _payload: unknown) {
  invalidateAllWithPrefix(qc, hubQueryKeys.threads.root);
}

function onSessionMemberLeft(qc: QueryClient, _payload: unknown) {
  invalidateAllWithPrefix(qc, hubQueryKeys.threads.root);
}

function onSessionInfoUpdated(qc: QueryClient, payload: unknown) {
  const data = payload as Partial<HubSession> & { session_id: string };
  const sessionId = str(data?.session_id);
  if (sessionId) {
    invalidateQuery(qc, hubQueryKeys.threads.detail(sessionId));
  }
  invalidateAllWithPrefix(qc, hubQueryKeys.threads.root);
}

function onAgentDispatch(qc: QueryClient, payload: unknown) {
  const data = payload as HubAgentDispatchPayload;

  // Update task bridge store
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

  // Invalidate team-related caches
  invalidateAllWithPrefix(qc, hubQueryKeys.agentTeams.root);
  invalidateAllWithPrefix(qc, hubQueryKeys.agents.root);
}

function onAgentStream(_qc: QueryClient, _payload: unknown) {
  // Streaming events update the run store for live token tracking
  // but do not require full cache invalidation
}

function onAgentDone(qc: QueryClient, payload: unknown) {
  const data = payload as HubAgentDonePayload;
  const taskId = str(data?.task_id);

  if (taskId) {
    getTaskBridge().updateTask(taskId, { status: 'done' });
    // Also update the run store
    const task = getTaskBridge().getTaskByRunId(taskId);
    if (task?.runId && getRun().currentRunId === task.runId) {
      getRun().setRunState('COMPLETED' as never);
    }
  }

  invalidateAllWithPrefix(qc, hubQueryKeys.agentTeams.root);
  invalidateAllWithPrefix(qc, hubQueryKeys.threads.root);
}

function onAgentFailed(qc: QueryClient, payload: unknown) {
  const data = payload as HubAgentFailedPayload;
  const taskId = str(data?.task_id);
  const error = str(data?.error || data?.error_message);

  if (taskId) {
    getTaskBridge().updateTask(taskId, { status: 'failed', error: error || undefined });
    const task = getTaskBridge().getTaskByRunId(taskId);
    if (task?.runId && getRun().currentRunId === task.runId) {
      getRun().setRunState('FAILED' as never);
    }
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

function onAgentRegenerate(qc: QueryClient, payload: unknown) {
  const data = payload as HubAgentRegeneratePayload;

  // Add the new task
  const newTask: AgentTask = {
    taskId: str(data?.new_task_id),
    agentId: str(data?.agent_instance_id),
    prompt: '',
    status: 'queued',
    dispatchPayload: (isObj(data) ? data : {}) as Record<string, unknown>,
    createdAt: new Date().toISOString(),
  };

  if (newTask.taskId) {
    getTaskBridge().addTask(newTask);
  }

  invalidateAllWithPrefix(qc, hubQueryKeys.agentTeams.root);
  invalidateAllWithPrefix(qc, hubQueryKeys.threads.root);
}

function onAgentControl(_qc: QueryClient, _payload: unknown) {
  // Agent control events (permission decisions from Hub relay)
  // are processed by useHubIntegration — no cache invalidation needed
}

// ── Plan approval events ──────────────────────────────────────

function onPlanProposed(qc: QueryClient, _payload: unknown) {
  invalidateAllWithPrefix(qc, hubQueryKeys.agentTeams.root);
}

function onPlanApproved(qc: QueryClient, _payload: unknown) {
  invalidateAllWithPrefix(qc, hubQueryKeys.agentTeams.root);
}

function onPlanRejected(qc: QueryClient, _payload: unknown) {
  invalidateAllWithPrefix(qc, hubQueryKeys.agentTeams.root);
}

function onPlanExpired(qc: QueryClient, _payload: unknown) {
  invalidateAllWithPrefix(qc, hubQueryKeys.agentTeams.root);
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

function onNotificationNew(qc: QueryClient, _payload: unknown) {
  invalidateAllWithPrefix(qc, hubQueryKeys.notifications.root);
}

function onFriendRequest(qc: QueryClient, _payload: unknown) {
  invalidateQuery(qc, hubQueryKeys.contacts.friendRequests);
}

function onFriendAccepted(qc: QueryClient, _payload: unknown) {
  invalidateAllWithPrefix(qc, hubQueryKeys.contacts.root);
  invalidateQuery(qc, hubQueryKeys.contacts.friendRequests);
}

function onDeviceOnline(qc: QueryClient, payload: unknown) {
  const data = payload as HubDevicePresencePayload;
  getConnection().setOnline(true, null);
  // Invalidate targets to reflect online status
  invalidateAllWithPrefix(qc, hubQueryKeys.executionTargets.root);
}

function onDeviceOffline(qc: QueryClient, payload: unknown) {
  const data = payload as HubDevicePresencePayload;
  invalidateAllWithPrefix(qc, hubQueryKeys.executionTargets.root);
}

function onDeviceKicked(_qc: QueryClient, _payload: unknown) {
  // Device kicked — the auth middleware should clear the session;
  // this is handled at the auth layer, not cache invalidation.
}

// ── Event → handler mapping ─────────────────────────────────────

type WSEventHandler = (qc: QueryClient, payload: unknown) => void;

const EVENT_HANDLERS: Record<string, WSEventHandler> = {
  [HUB_EVENTS.MESSAGE_NEW]: onMessageNew,
  [HUB_EVENTS.MESSAGE_EDITED]: onMessageEdited,
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
  [HUB_EVENTS.AGENT_REGENERATE]: onAgentRegenerate,
  [HUB_EVENTS.NOTIFICATION_NEW]: onNotificationNew,
  [HUB_EVENTS.FRIEND_REQUEST]: onFriendRequest,
  [HUB_EVENTS.FRIEND_ACCEPTED]: onFriendAccepted,
  [HUB_EVENTS.DEVICE_ONLINE]: onDeviceOnline,
  [HUB_EVENTS.DEVICE_OFFLINE]: onDeviceOffline,
  [HUB_EVENTS.DEVICE_KICKED]: onDeviceKicked,
  [HUB_EVENTS.PLAN_PROPOSED]: onPlanProposed,
  [HUB_EVENTS.PLAN_APPROVED]: onPlanApproved,
  [HUB_EVENTS.PLAN_REJECTED]: onPlanRejected,
  [HUB_EVENTS.PLAN_EXPIRED]: onPlanExpired,
  [HUB_EVENTS.TEAM_RUN_STARTED]: onTeamRunStarted,
  [HUB_EVENTS.TEAM_EVENT]: onTeamEvent,
  [HUB_EVENTS.TEAM_ASSIGNMENT_DONE]: onTeamAssignmentDone,
  [HUB_EVENTS.TEAM_ASSIGNMENT_FAILED]: onTeamAssignmentFailed,
};

// ── Public API ───────────────────────────────────────────────────

export interface WSEventBridgeHandle {
  /** Detach all event listeners and clean up. */
  destroy: () => void;
}

/**
 * Wire Hub WebSocket events to React Query cache invalidation and
 * Zustand store updates. Returns a handle with a `destroy()` method
 * that unsubscribes all handlers.
 *
 * Call this once when the Hub WS connection is established.
 */
export function createWSEventBridge(
  hubWS: HubWSHandle,
  queryClient: QueryClient,
): WSEventBridgeHandle {
  const unsubFns: Array<() => void> = [];

  for (const [eventType, handler] of Object.entries(EVENT_HANDLERS)) {
    const unsub = hubWS.on(eventType as never, (payload: unknown) => {
      try {
        handler(queryClient, payload);
      } catch (error) {
        console.error(
          `[wsEventBridge] Error handling "${eventType}":`,
          error,
        );
      }
    });
    unsubFns.push(unsub);
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
