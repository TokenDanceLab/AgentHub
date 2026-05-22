// WebSocket event stream hook.
// Creates a new stream when Edge comes online, tears it down when offline.

import { useState, useEffect, useRef, useCallback } from 'react';
import { createEventStream, EventEnvelope } from '@/api/eventClient';
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

function summarize(event: EventEnvelope): string {
  const p = event.payload ?? {};
  const parts: string[] = [];
  if (p.runId) parts.push(`run=${p.runId}`);
  if (p.runnerId) parts.push(`runner=${p.runnerId}`);
  if (p.stream) parts.push(`stream=${p.stream}`);
  if (typeof p.text === 'string') parts.push(`"${p.text.slice(0, 60)}"`);
  if (Array.isArray(p.chunks)) parts.push(`chunks=${p.chunks.length}`);
  if (p.status) parts.push(`status=${p.status}`);
  if (typeof p.message === 'string') parts.push(p.message);
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

    const unsubEvents = stream.subscribe((event) => {
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
          summary: summarize(event),
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
