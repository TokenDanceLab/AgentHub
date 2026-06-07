import { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeEdgeEventsToTranscript } from '@shared/transcript';
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
