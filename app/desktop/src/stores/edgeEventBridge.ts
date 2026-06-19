// Edge WebSocket event → React Query cache + Zustand store bridge.
// Subscribes to the Edge event stream and dispatches cache invalidations
// and store updates on each event, keeping the UI in-sync with runtime
// state without relying solely on polling intervals.
//
// Desktop uses two WS connections: Edge local events (this bridge) and
// Hub WS (see useHubWSConnection for Hub-driven bridge equivalent).

import type { QueryClient } from '@tanstack/react-query';
import type { StreamHandle } from '@/api/eventClient';
import { edgeQueryKeys } from '@agenthub/shared';
import { useConnectionStore } from '@/stores/connectionStore';
import { useRunStore } from '@/stores/runStore';
import type { RunState } from '@/utils/runStateMachine';

// ── Helpers ──────────────────────────────────────────────────────

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
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

// Edge run status string → runStore RunState
function runStatusToRunState(status: string): RunState | null {
  switch (status) {
    case 'queued':
    case 'running':
      return 'RUNNING' as RunState;
    case 'streaming':
      return 'STREAMING' as RunState;
    case 'waiting_for_input':
      return 'WAITING_FOR_INPUT' as RunState;
    case 'completed':
    case 'done':
      return 'COMPLETED' as RunState;
    case 'failed':
      return 'FAILED' as RunState;
    case 'cancelled':
      return 'CANCELLED' as RunState;
    default:
      return null;
  }
}

// ── Event handlers ──────────────────────────────────────────────

function onProjectCreated(qc: QueryClient, _payload: Record<string, unknown>) {
  invalidateAllWithPrefix(qc, edgeQueryKeys.threads.root);
}

function onProjectUpdated(qc: QueryClient, _payload: Record<string, unknown>) {
  invalidateAllWithPrefix(qc, edgeQueryKeys.threads.root);
}

function onThreadCreated(qc: QueryClient, payload: Record<string, unknown>) {
  invalidateAllWithPrefix(qc, edgeQueryKeys.threads.root);
}

function onThreadUpdated(qc: QueryClient, payload: Record<string, unknown>) {
  const threadId = str(payload.threadId);
  if (threadId) {
    invalidateQuery(qc, edgeQueryKeys.threads.items(threadId));
  }
  invalidateAllWithPrefix(qc, edgeQueryKeys.threads.root);
}

function onMessageCreated(qc: QueryClient, payload: Record<string, unknown>) {
  const threadId = str(payload.threadId);
  if (threadId) {
    invalidateQuery(qc, edgeQueryKeys.threads.items(threadId));
  }
}

function onMessageDelta(_qc: QueryClient, _payload: Record<string, unknown>) {
  // Streaming deltas are handled by the streaming layer in real time;
  // we don't invalidate the full query for every delta.
}

function onItemCreated(qc: QueryClient, payload: Record<string, unknown>) {
  const threadId = str(payload.threadId);
  if (threadId) {
    invalidateQuery(qc, edgeQueryKeys.threads.items(threadId));
  }
}

function onItemUpdated(qc: QueryClient, payload: Record<string, unknown>) {
  const threadId = str(payload.threadId);
  if (threadId) {
    invalidateQuery(qc, edgeQueryKeys.threads.items(threadId));
  }
}

function onRunnerOnline(qc: QueryClient, _payload: Record<string, unknown>) {
  invalidateAllWithPrefix(qc, edgeQueryKeys.runners.root);
  invalidateAllWithPrefix(qc, edgeQueryKeys.agents.root);
  getConnection().setOnline(true, null);
}

function onRunnerOffline(qc: QueryClient, _payload: Record<string, unknown>) {
  invalidateAllWithPrefix(qc, edgeQueryKeys.runners.root);
  invalidateAllWithPrefix(qc, edgeQueryKeys.agents.root);
}

function getConnection() {
  return useConnectionStore.getState();
}

function getRun() {
  return useRunStore.getState();
}

function onRunQueued(qc: QueryClient, payload: Record<string, unknown>) {
  const runId = str(payload.runId);
  if (runId) {
    getRun().setRun(runId);
    getRun().setRunState('RUNNING' as RunState);
  }
  invalidateAllWithPrefix(qc, edgeQueryKeys.runs.root);
  invalidateAllWithPrefix(qc, edgeQueryKeys.threads.root);
}

function onRunStarted(qc: QueryClient, payload: Record<string, unknown>) {
  const runId = str(payload.runId);
  if (runId && getRun().currentRunId === runId) {
    getRun().setRunState('RUNNING' as RunState);
  }
  invalidateAllWithPrefix(qc, edgeQueryKeys.runs.root);
}

function onRunStatusChanged(qc: QueryClient, payload: Record<string, unknown>) {
  const runId = str(payload.runId);
  const status = str(payload.status);
  const newState = runStatusToRunState(status);
  if (runId && newState && getRun().currentRunId === runId) {
    getRun().setRunState(newState);
  }
  invalidateAllWithPrefix(qc, edgeQueryKeys.runs.root);
}

function onRunFinished(qc: QueryClient, payload: Record<string, unknown>) {
  const runId = str(payload.runId);
  if (runId && getRun().currentRunId === runId) {
    getRun().setRunState('COMPLETED' as RunState);
  }
  invalidateAllWithPrefix(qc, edgeQueryKeys.runs.root);
  invalidateQuery(qc, edgeQueryKeys.threads.items(str(payload.threadId || '')));
}

function onRunFailed(qc: QueryClient, payload: Record<string, unknown>) {
  const runId = str(payload.runId);
  if (runId && getRun().currentRunId === runId) {
    getRun().setRunState('FAILED' as RunState);
  }
  invalidateAllWithPrefix(qc, edgeQueryKeys.runs.root);
}

function onRunCancelled(qc: QueryClient, payload: Record<string, unknown>) {
  const runId = str(payload.runId);
  if (runId && getRun().currentRunId === runId) {
    getRun().setRunState('CANCELLED' as RunState);
  }
  invalidateAllWithPrefix(qc, edgeQueryKeys.runs.root);
}

function onApprovalRequested(qc: QueryClient, _payload: Record<string, unknown>) {
  invalidateAllWithPrefix(qc, edgeQueryKeys.runs.root);
}

function onApprovalDecided(qc: QueryClient, _payload: Record<string, unknown>) {
  invalidateAllWithPrefix(qc, edgeQueryKeys.runs.root);
}

function onArtifactCreated(qc: QueryClient, _payload: Record<string, unknown>) {
  invalidateAllWithPrefix(qc, edgeQueryKeys.threads.root);
}

function onPreviewReady(qc: QueryClient, _payload: Record<string, unknown>) {
  invalidateAllWithPrefix(qc, edgeQueryKeys.runs.root);
}

function onPreviewStopped(qc: QueryClient, _payload: Record<string, unknown>) {
  invalidateAllWithPrefix(qc, edgeQueryKeys.runs.root);
}

// ── Event → handler mapping ────────────────────────────────────

type EdgeEventHandler = (qc: QueryClient, payload: Record<string, unknown>) => void;

const EDGE_EVENT_HANDLERS: Record<string, EdgeEventHandler> = {
  'project.created': onProjectCreated,
  'project.updated': onProjectUpdated,
  'thread.created': onThreadCreated,
  'thread.updated': onThreadUpdated,
  'message.created': onMessageCreated,
  'message.delta': onMessageDelta,
  'item.created': onItemCreated,
  'item.updated': onItemUpdated,
  'runner.online': onRunnerOnline,
  'runner.offline': onRunnerOffline,
  'run.queued': onRunQueued,
  'run.started': onRunStarted,
  'run.status.changed': onRunStatusChanged,
  'run.finished': onRunFinished,
  'run.failed': onRunFailed,
  'run.cancelled': onRunCancelled,
  'approval.requested': onApprovalRequested,
  'approval.decided': onApprovalDecided,
  'artifact.created': onArtifactCreated,
  'preview.ready': onPreviewReady,
  'preview.stopped': onPreviewStopped,
};

// ── Public API ──────────────────────────────────────────────────

export interface EdgeEventBridgeHandle {
  /** Detach all event listeners and clean up. */
  destroy: () => void;
}

/**
 * Wire Edge event stream events to React Query cache invalidation and
 * Zustand store updates. Returns a handle with a `destroy()` method
 * that unsubscribes all handlers.
 *
 * Call this once when the Edge event stream is active.
 */
export function createEdgeEventBridge(
  stream: StreamHandle,
  queryClient: QueryClient,
): EdgeEventBridgeHandle {
  const unsub = stream.subscribe((event) => {
    const handler = EDGE_EVENT_HANDLERS[event.type];
    if (!handler) return;
    try {
      handler(queryClient, event.payload ?? {});
    } catch (error) {
      console.error(
        `[edgeEventBridge] Error handling "${event.type}":`,
        error,
      );
    }
  });

  return {
    destroy(): void {
      unsub();
    },
  };
}
