// Hub WebSocket event → React Query cache + Zustand store bridge (Desktop).
// Subscribes to Hub WS events and dispatches cache invalidations and store
// updates. Desktop uses this for Hub-connected team run tracking.
//
// The Desktop has two WS connections:
// 1. Edge local event stream (edgeEventBridge.ts) — runtime events
// 2. Hub WS (this bridge) — team/agent dispatch events from the Hub

import type { QueryClient } from '@tanstack/react-query';
import { HUB_EVENTS, hubQueryKeys } from '@agenthub/shared';
import type {
  HubAgentDispatchPayload,
  HubAgentDonePayload,
  HubAgentFailedPayload,
  HubAgentCancelPayload,
} from '@agenthub/shared';
import { useTaskBridgeStore, type AgentTask } from '@/stores/taskBridgeStore';

// ── Helpers ──────────────────────────────────────────────────────

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function invalidateAllWithPrefix(qc: QueryClient, prefix: readonly unknown[]) {
  void qc.invalidateQueries({ queryKey: prefix }).catch(() => {
    /* non-fatal */
  });
}

function getTaskBridge() {
  return useTaskBridgeStore.getState();
}

// ── Event handlers ──────────────────────────────────────────────

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
}

function onAgentDone(qc: QueryClient, payload: unknown) {
  const data = payload as HubAgentDonePayload;
  const taskId = str(data?.task_id);

  if (taskId) {
    getTaskBridge().updateTask(taskId, { status: 'done' });
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

// ── Event → handler mapping ────────────────────────────────────

type HubEventHandler = (qc: QueryClient, payload: unknown) => void;

const HUB_EVENT_HANDLERS: Record<string, HubEventHandler> = {
  [HUB_EVENTS.AGENT_DISPATCH]: onAgentDispatch,
  [HUB_EVENTS.AGENT_DONE]: onAgentDone,
  [HUB_EVENTS.AGENT_FAILED]: onAgentFailed,
  [HUB_EVENTS.AGENT_CANCEL]: onAgentCancel,
};

// ── Public API ──────────────────────────────────────────────────

export interface DesktopHubEventBridgeHandle {
  destroy: () => void;
}

/** Minimal on/off interface matching what desktop Hub WS provides. */
export interface DesktopHubWSLike {
  on: (type: string, handler: (payload: unknown) => void) => () => void;
}

/**
 * Wire Desktop Hub WS events to React Query cache invalidation and
 * Zustand store updates. Returns a handle with a `destroy()` method.
 */
export function createDesktopHubEventBridge(
  hubWS: DesktopHubWSLike,
  queryClient: QueryClient,
): DesktopHubEventBridgeHandle {
  const unsubFns: Array<() => void> = [];

  for (const [eventType, handler] of Object.entries(HUB_EVENT_HANDLERS)) {
    const unsub = hubWS.on(eventType, (payload: unknown) => {
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

  return {
    destroy(): void {
      for (const unsub of unsubFns) {
        unsub();
      }
      unsubFns.length = 0;
    },
  };
}
