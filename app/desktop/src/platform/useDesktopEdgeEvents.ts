import { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeEdgeEventsToTranscript } from '@shared/transcript';
import { getAgentActivityStore, type AgentActivityStatus } from '@shared/transcript/agentActivity';
import type { EventEnvelope } from '@shared/events';
import type { TranscriptBlock } from '@shared/transcript';
import { createEventStream } from '@/api/eventClient';

const MAX_LIVE_EVENTS = 200;

export function useDesktopEdgeEvents(
  activeThreadId: string | undefined,
  persistedUntilMs: number | undefined,
): TranscriptBlock[] {
  const [events, setEvents] = useState<EventEnvelope[]>([]);
  const knownRunIds = useRef(new Set<string>());

  useEffect(() => {
    setEvents([]);
    knownRunIds.current = new Set<string>();
    if (!activeThreadId) return undefined;

    const stream = createEventStream();
    const unsubscribe = stream.subscribe((event) => {
      if (!matchesActiveThread(event, activeThreadId, knownRunIds.current)) return;

      const runId = eventRunId(event);
      if (runId) knownRunIds.current.add(runId);

      // Feed Edge SSE events into the agent activity store so the
      // streaming indicator appears while the run is in progress.
      pushEdgeEventToAgentActivity(event);

      setEvents((current) => appendLiveEvent(current, event));
    });

    return () => {
      unsubscribe();
      stream.close();
    };
  }, [activeThreadId]);

  const visibleEvents = useMemo(() => {
    if (persistedUntilMs === undefined) return events;
    return events.filter((event) => eventTimestampMs(event) > persistedUntilMs);
  }, [events, persistedUntilMs]);

  return useMemo(() => normalizeEdgeEventsToTranscript(visibleEvents), [visibleEvents]);
}

function appendLiveEvent(events: EventEnvelope[], event: EventEnvelope): EventEnvelope[] {
  if (events.some((item) => item.id === event.id)) return events;
  return [...events, event].slice(-MAX_LIVE_EVENTS);
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
