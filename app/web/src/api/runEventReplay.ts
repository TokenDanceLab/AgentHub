// RunEvent replay for WebSocket reconnection gap fill.
//
// When the WebSocket disconnects and reconnects, the client may have missed
// agent.stream / agent.done / agent.failed / agent.cancel events. This module
// tracks the highest event_seq seen per task before disconnect, and on
// reconnect fetches missed events from the REST API
// (`GET /web/agent-tasks/:id/events?after_seq=<lastSeq>`) to fill the gap.

import type { HubClient } from '@/api/hubClient';
import type { HubRuntimeEventTranscriptInput } from '@shared/transcript';
import { useConnectionStore } from '@/stores/connectionStore';

interface ReplayControllerOptions {
  hubClient: HubClient;
  /** Currently active agent task ID (may change over time). */
  getActiveTaskId: () => string | undefined;
  /** Callback to inject replayed events into the live event stream. */
  onReplayEvents: (events: HubRuntimeEventTranscriptInput[], taskId: string) => void;
}

/**
 * Tracks the highest event_seq seen per task from live WS events.
 * Call `trackEvent` for every incoming runtime event.
 */
export function trackEventSeq(taskId: string | undefined, eventSeq: number | undefined): void {
  if (!taskId || eventSeq == null || eventSeq < 0) return;
  const store = useConnectionStore.getState();
  const current = store.lastEventSeq[taskId];
  if (current == null || eventSeq > current) {
    store.setLastEventSeq(taskId, eventSeq);
  }
}

/**
 * Attempt replay for the given task after reconnecting.
 * Returns the number of events replayed, or 0 if none were needed.
 */
export async function replayMissedEvents(opts: ReplayControllerOptions): Promise<number> {
  const { hubClient, getActiveTaskId, onReplayEvents } = opts;
  const taskId = getActiveTaskId();
  if (!taskId) return 0;

  const store = useConnectionStore.getState();
  const lastSeq = store.lastEventSeq[taskId];
  if (lastSeq == null || lastSeq <= 0) return 0;

  store.setRecoveryState('recovering');
  store.setRecoveryError(null);

  try {
    const events = await hubClient.listTaskRunEventsAfter(taskId, lastSeq);
    if (events.length === 0) {
      store.setRecoveryState('idle');
      return 0;
    }

    // Convert API events to transcript input format.
    const replayEvents: HubRuntimeEventTranscriptInput[] = events.map((event) => ({
      id: event.id,
      task_id: event.task_id,
      ...(event.edge_run_id ? { edge_run_id: event.edge_run_id } : {}),
      session_id: event.session_id,
      agent_instance_id: event.agent_instance_id,
      event_seq: event.event_seq,
      event_type: event.event_type,
      payload: event.payload,
      created_at: event.created_at,
    }));

    // Update tracked seq to the highest replayed.
    const maxSeq = Math.max(...events.map((e) => e.event_seq));
    if (maxSeq > lastSeq) {
      store.setLastEventSeq(taskId, maxSeq);
    }

    onReplayEvents(replayEvents, taskId);
    store.setRecoveryState('idle');
    return replayEvents.length;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown replay error';
    console.warn(`[Replay] Failed to replay events for task ${taskId}:`, message);
    store.setRecoveryState('failed');
    store.setRecoveryError(message);
    return 0;
  }
}

/**
 * Create a recovery state transcript block that can be inserted
 * into the transcript to indicate where replay events were inserted.
 */

/**
 * Read the current recovery state from the connection store.
 */
