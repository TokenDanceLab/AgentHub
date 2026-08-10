import { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeEdgeEventsToTranscript } from '@shared/transcript';
import { getAgentActivityStore, type AgentActivityStatus } from '@shared/transcript/agentActivity';
import type { EventEnvelope } from '@shared/events';
import type { TranscriptBlock } from '@shared/transcript';
import { createEventStream } from '@/api/eventClient';

const MAX_LIVE_EVENTS = 200;
// Coalesce incoming WS events into a single setEvents call per animation
// frame (or a 50ms fallback timer when rAF is unavailable, e.g. jsdom). Long
// streaming sessions emit many text_delta/thinking events in rapid bursts;
// flushing them in a batch turns the previous O(n) normalize + O(n) dedupe
// per event into O(n) per batch, eliminating the O(n²) long-session stall.
const BATCH_FLUSH_TIMEOUT_MS = 50;

export function useDesktopEdgeEvents(
  activeThreadId: string | undefined,
  persistedUntilMs: number | undefined,
): TranscriptBlock[] {
  const [events, setEvents] = useState<EventEnvelope[]>([]);
  const knownRunIds = useRef(new Set<string>());

  // Batch buffer: events accumulated since the last flush. Flushing drains
  // this array and applies it to `events` in one setEvents call so the
  // downstream transcript normalization (useMemo on visibleEvents) only
  // recomputes once per batch instead of once per WS event.
  const pendingEventsRef = useRef<EventEnvelope[]>([]);
  // O(1) dedupe set mirrored from `events` + the in-flight batch. Replaces
  // the old appendLiveEvent `events.some(item => item.id === event.id)`
  // linear scan that made every event O(n) (O(n²) per session).
  const knownIdsRef = useRef<Set<string>>(new Set());
  const flushScheduledRef = useRef(false);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset the transcript STATE when the active thread changes. This is the
  // sanctioned "adjusting state when a prop changes" pattern (React docs) —
  // only state setters are called here so the previous thread's events never
  // render for the new thread. The batch/dedupe REF resets cannot happen
  // during render (react-hooks/refs); they are performed in the
  // activeThreadId effect below, which runs after commit and before the new
  // subscription attaches (and after the old subscription's cleanup flushes
  // any in-flight batch).
  const [prevThreadId, setPrevThreadId] = useState(activeThreadId);
  if (prevThreadId !== activeThreadId) {
    setPrevThreadId(activeThreadId);
    setEvents([]);
  }

  // ── Batch flush ──────────────────────────────────────────────────────
  // Apply all buffered events to state in one shot. Dedupes against the known
  // id set (O(batch size)) and appends, respecting the live-events cap.
  const flushPendingEvents = () => {
    flushScheduledRef.current = false;
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const batch = pendingEventsRef.current;
    pendingEventsRef.current = [];
    if (batch.length === 0) return;

    const knownIds = knownIdsRef.current;
    // Collect only the fresh events from this batch (dedupe within the batch
    // and against previously-seen events) without any O(events.length) scan.
    const fresh: EventEnvelope[] = [];
    for (const candidate of batch) {
      if (knownIds.has(candidate.id)) continue;
      knownIds.add(candidate.id);
      fresh.push(candidate);
    }
    if (fresh.length === 0) return;

    setEvents((current) => {
      const combined = current.length + fresh.length;
      // Fast path: still under the cap → simple concat (no slice copy of current).
      if (combined <= MAX_LIVE_EVENTS) {
        return current.concat(fresh);
      }
      // Over the cap: keep the most recent MAX_LIVE_EVENTS. Drop the evicted
      // ids from the known set so a theoretical replay of the same id is
      // treated as fresh rather than silently dropped.
      const overflow = combined - MAX_LIVE_EVENTS;
      const next = current.slice(overflow).concat(fresh);
      for (let i = 0; i < overflow && i < current.length; i++) {
        const evicted = current[i];
        if (evicted) knownIds.delete(evicted.id);
      }
      return next;
    });
  };

  const scheduleFlush = () => {
    if (flushScheduledRef.current) return;
    flushScheduledRef.current = true;
    // Prefer requestAnimationFrame (aligns flush with paint, naturally
    // throttled to ~60fps). Fall back to a 50ms timer when rAF is absent
    // (jsdom/test env) so batches still coalesce there.
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => flushPendingEvents());
    } else {
      flushTimerRef.current = setTimeout(flushPendingEvents, BATCH_FLUSH_TIMEOUT_MS);
    }
  };

  useEffect(() => {
    // Reset batch/dedupe refs on thread switch so stale events from the
    // previous thread never leak into the new thread's transcript, and so
    // the dedupe set cannot grow unbounded across sessions. These ref
    // writes cannot happen during render (react-hooks/refs); the effect
    // fires after commit, before the new subscription attaches, and after
    // the previous subscription's cleanup flushed any in-flight batch.
    pendingEventsRef.current = [];
    knownIdsRef.current = new Set();
    knownRunIds.current = new Set<string>();
    if (!activeThreadId) return undefined;

    const stream = createEventStream();
    stream.onStatusChange((status) => {
      void status;
    });
    const unsubscribe = stream.subscribe((event) => {
      if (!matchesActiveThread(event, activeThreadId, knownRunIds.current)) return;

      const runId = eventRunId(event);
      if (runId) knownRunIds.current.add(runId);

      pushEdgeEventToAgentActivity(event);
      pendingEventsRef.current.push(event);
      scheduleFlush();
    });

    return () => {
      unsubscribe();
      stream.close();
      // Flush any buffered events on unmount so none are silently lost when
      // the component tears down between the last event and the next paint.
      if (flushScheduledRef.current) {
        flushPendingEvents();
      } else if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
    // flushPendingEvents/scheduleFlush are stable closures over refs; only
    // activeThreadId drives the (re)subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId]);

  const visibleEvents = useMemo(() => {
    if (persistedUntilMs === undefined) return events;
    return events.filter((event) => eventTimestampMs(event) > persistedUntilMs);
  }, [events, persistedUntilMs]);

  return useMemo(() => normalizeEdgeEventsToTranscript(visibleEvents), [visibleEvents]);
}

function matchesActiveThread(
  event: EventEnvelope,
  activeThreadId: string,
  knownRunIds: Set<string>,
): boolean {
  const threadId = eventThreadId(event);
  if (threadId) return threadId === activeThreadId;

  const runId = eventRunId(event);
  return Boolean(runId && knownRunIds.has(runId));
}

function eventThreadId(event: EventEnvelope): string | undefined {
  return stringField(event.payload.threadId) ?? stringField(event.scope.threadId);
}

function eventRunId(event: EventEnvelope): string | undefined {
  return stringField(event.payload.runId) ?? stringField(event.scope.runId);
}

function eventTimestampMs(event: EventEnvelope): number {
  const parsed = Date.parse(event.sentAt);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

// ── Edge SSE → Agent Activity bridge ──────────────────────────────────────────

/**
 * Translates Edge SSE events into agent activity store status updates
 * so the streaming indicator appears during a run.
 *
 * Mapping:
 *   run.queued / run.started              → dispatching / thinking
 *   run.agent.thinking                    → thinking
 *   run.output / run.agent.text_delta     → streaming
 *   run.agent.tool_call                   → streaming (+ toolCalls increment)
 *   run.finished                          → done
 *   run.failed                            → failed
 *   run.cancelled                         → (remove)
 */
function pushEdgeEventToAgentActivity(event: EventEnvelope): void {
  const store = getAgentActivityStore();
  const runId = stringField(event.payload.runId) ?? stringField(event.scope.runId);
  if (!runId) return;

  // Derive a human-readable agent name from the event payload.
  const agentName =
    stringField(event.payload.agentName) ??
    stringField(event.payload.agentLabel) ??
    stringField(event.payload.runnerName) ??
    stringField(event.payload.adapterId) ??
    'Agent';

  let status: AgentActivityStatus | undefined;
  let toolCalls: number | undefined;

  switch (event.type) {
    case 'run.queued':
      status = 'dispatching';
      break;
    case 'run.started':
    case 'run.agent.thinking':
      status = 'thinking';
      break;
    case 'run.output':
    case 'run.output.batch':
    case 'run.agent.text_delta':
    case 'run.agent.text_block':
    case 'run.agent.result':
      status = 'streaming';
      break;
    case 'run.agent.tool_call':
      status = 'streaming';
      toolCalls = 1;
      break;
    case 'run.finished':
      status = 'done';
      break;
    case 'run.failed':
      status = 'failed';
      break;
    case 'run.cancelled':
      // Remove just this agent entry.
      store.pushAgentStatus(runId, agentName, 'done');
      return;
    default:
      // Not a run lifecycle event — skip.
      return;
  }

  if (status) {
    store.pushAgentStatus(runId, agentName, status, toolCalls);
  }
}
