// WebSocket event stream hook.

import { useState, useEffect, useRef, useCallback } from 'react';
import { createEventStream } from '@/api/eventClient';
import type { EventEnvelope } from '@shared/events';
import { EVENT_LOG_MAX } from '@/config';

export interface LogEntry {
  seq: number;
  type: string;
  summary: string;
  sentAt: string;
  id: string;
}

export interface EventStreamState {
  events: LogEntry[];
  isConnected: boolean;
  clearEvents: () => void;
}

function summarize(payload: Record<string, unknown>): string {
  const parts: string[] = [];
  if (payload.runId) parts.push(`run=${payload.runId}`);
  if (payload.runnerId) parts.push(`runner=${payload.runnerId}`);
  if (payload.stream) parts.push(`stream=${payload.stream}`);
  if (typeof payload.text === 'string') parts.push(`"${payload.text.slice(0, 60)}"`);
  if (Array.isArray(payload.chunks)) parts.push(`chunks=${payload.chunks.length}`);
  if (payload.status) parts.push(`status=${payload.status}`);
  if (typeof payload.message === 'string') parts.push(payload.message);
  return parts.join(' ');
}

export function useEventStream(online: boolean): EventStreamState {
  const [events, setEvents] = useState<LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const mountedRef = useRef(true);

  const clearEvents = useCallback(() => setEvents([]), []);

  useEffect(() => {
    mountedRef.current = true;
    if (!online) {
      setIsConnected(false);
      return;
    }

    const stream = createEventStream();

    const unsubStatus = stream.onStatusChange((connected) => {
      if (!mountedRef.current) return;
      setIsConnected(connected);
    });

    const unsubEvents = stream.subscribe((event: EventEnvelope) => {
      if (!mountedRef.current) return;
      if (event.type === 'error') {
        console.warn('Event stream error:', event.payload?.message);
        return;
      }
      setIsConnected(true);
      setEvents((prev) => [
        ...prev.slice(-(EVENT_LOG_MAX - 1)),
        {
          seq: event.seq,
          type: event.type,
          summary: summarize(event.payload),
          sentAt: event.sentAt,
          id: event.id,
        },
      ]);
    });

    return () => {
      mountedRef.current = false;
      unsubStatus();
      unsubEvents();
      stream.close();
    };
  }, [online]);

  return { events, isConnected, clearEvents };
}
