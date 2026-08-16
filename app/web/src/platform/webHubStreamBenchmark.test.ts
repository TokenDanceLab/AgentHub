/**
 * Deterministic renderer benchmark for #1415.
 *
 * Fake time models a bursty 240 event/s stream. A 16 ms window should cap
 * React commits near the display refresh rate while preserving every event.
 * This is fixture-unit/performance-microbenchmark evidence, not a live Hub or
 * production-capacity claim.
 */
import {
  createElement,
  useCallback,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HUB_EVENTS } from '@shared/hubEvents';
import {
  getAgentActivityStore,
  type HubRuntimeEventTranscriptInput,
} from '@shared/transcript';
import type { HubWSHandle, HubWSOptions } from '@shared/hub/hubWS';
import { appendHubRuntimeEvent } from './webWorkbenchRuntimeEvents';
import {
  AGENT_STREAM_LIVE_BATCH_WINDOW_MS,
  useWebHubRealtime,
} from './webHubRealtime';

const SESSION_ID = 'hub-session-bench';
const TASK_ID = 'task-bench';
const EVENT_INTERVAL_MS = 4;
const EVENT_COUNT = 120;

function streamPayload(seq: number): Record<string, unknown> {
  return {
    id: `event-${seq}`,
    task_id: TASK_ID,
    edge_run_id: 'run-bench',
    session_id: SESSION_ID,
    agent_id: 'agent-bench',
    event_seq: seq,
    event_type: 'run.agent.text_delta',
    payload: { content: `token-${seq}` },
    created_at: new Date(Date.UTC(2026, 6, 27, 0, 0, 0, seq)).toISOString(),
  };
}

function runRendererScenario(windowMs: number) {
  const handlers = new Set<(type: string, payload: unknown) => void>();
  const createSocket = (_options: HubWSOptions): HubWSHandle => ({
    onAny: (handler: (type: string, payload: unknown) => void) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onStatus: () => () => undefined,
    connect: () => undefined,
    close: () => undefined,
  }) as unknown as HubWSHandle;

  const queryClient = new QueryClient();
  const counters = { renders: 0, activityNotifies: 0 };
  const activityStore = getAgentActivityStore();
  const unsubscribeActivity = activityStore.subscribe(() => {
    counters.activityNotifies += 1;
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);

  const hook = renderHook(() => {
    counters.renders += 1;
    const [events, setEvents] = useState<HubRuntimeEventTranscriptInput[]>([]);
    const append = useCallback((event: HubRuntimeEventTranscriptInput) => {
      setEvents((current) => appendHubRuntimeEvent(current, event));
    }, []);
    useSyncExternalStore(
      activityStore.subscribe,
      activityStore.getSnapshot,
      activityStore.getSnapshot,
    );
    useWebHubRealtime({
      enabled: true,
      runtimeSessionId: SESSION_ID,
      runtimeTaskId: TASK_ID,
      onRuntimeEvent: append,
      createSocket,
      getToken: () => 'fixture-token',
      liveBatchWindowMs: windowMs,
    });
    return events;
  }, { wrapper });

  const initialRenders = counters.renders;
  for (let seq = 1; seq <= EVENT_COUNT; seq += 1) {
    act(() => {
      for (const handler of handlers) {
        handler(HUB_EVENTS.AGENT_STREAM, streamPayload(seq));
      }
      vi.advanceTimersByTime(EVENT_INTERVAL_MS);
    });
  }
  act(() => {
    vi.runOnlyPendingTimers();
  });

  const result = {
    renders: counters.renders - initialRenders,
    activityNotifies: counters.activityNotifies,
    events: [...hook.result.current],
  };
  act(() => hook.unmount());
  unsubscribeActivity();
  queryClient.clear();
  activityStore.reset();
  return result;
}

describe('web Hub stream renderer benchmark', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getAgentActivityStore().reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('16 ms microbatch caps burst commits while retaining ordered raw events', () => {
    const immediate = runRendererScenario(0);
    const microbatched = runRendererScenario(AGENT_STREAM_LIVE_BATCH_WINDOW_MS);

    console.log(
      `[stream benchmark] ${EVENT_COUNT} events @ ${1000 / EVENT_INTERVAL_MS}/s: ` +
      `immediate=${immediate.renders} renders, ` +
      `${AGENT_STREAM_LIVE_BATCH_WINDOW_MS}ms=${microbatched.renders} renders`,
    );

    expect(immediate.renders).toBe(EVENT_COUNT);
    expect(microbatched.renders).toBe(EVENT_COUNT / 4);
    expect(microbatched.renders).toBeLessThanOrEqual(immediate.renders * 0.25);
    expect(microbatched.activityNotifies).toBe(EVENT_COUNT / 4);
    expect(microbatched.events).toHaveLength(EVENT_COUNT);
    expect(microbatched.events.map((event) => event.id)).toEqual(
      Array.from({ length: EVENT_COUNT }, (_, index) => `event-${index + 1}`),
    );
  });
});
