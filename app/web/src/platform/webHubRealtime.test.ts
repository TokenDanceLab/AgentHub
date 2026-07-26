import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HUB_EVENTS } from '@shared/hubEvents';
import { getAgentActivityStore, type HubRuntimeEventTranscriptInput } from '@shared/transcript';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HubWSHandle, HubWSOptions } from '@/api/hubWS';
import type { TransportStatus } from '@/api/transport';
import {
  AGENT_STREAM_LIVE_BATCH_WINDOW_MS,
  AGENT_STREAM_INVALIDATE_WINDOW_MS,
  createWebWorkbenchLiveEventBatcher,
  createWebWorkbenchHubInvalidationScheduler,
  dispatchHubRuntimeEvent,
  invalidateWebWorkbenchHubQueries,
  useWebHubRealtime,
} from './webHubRealtime';

describe('webHubRealtime', () => {
  it('invalidates Hub sessions and the active session messages for message events', () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

    invalidateWebWorkbenchHubQueries(queryClient, HUB_EVENTS.MESSAGE_NEW, {
      session_id: 'hub-session-1',
      message_id: 'message-1',
    });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['web-v4', 'hub-sessions'] });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['web-v4', 'hub-messages', 'hub-session-1'],
    });
  });

  it('reads nested message session ids from Hub event payloads', () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

    invalidateWebWorkbenchHubQueries(queryClient, HUB_EVENTS.MESSAGE_RECALL, {
      message: { session_id: 'hub-session-nested', message_id: 'message-2' },
    });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['web-v4', 'hub-messages', 'hub-session-nested'],
    });
  });

  it('invalidates all Hub messages when agent task events omit a session id', () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

    invalidateWebWorkbenchHubQueries(queryClient, HUB_EVENTS.AGENT_DONE, {
      task_id: 'task-1',
      result_summary: 'done',
    });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['web-v4', 'hub-sessions'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['web-v4', 'hub-messages'] });
  });

  it('updates the Hub task index when agent lifecycle events arrive', () => {
    const queryClient = new QueryClient();

    invalidateWebWorkbenchHubQueries(queryClient, HUB_EVENTS.AGENT_DONE, {
      task_id: 'task-1',
      session_id: 'hub-session-1',
      edge_run_id: 'edge-run-1',
      result_summary: 'done',
    });

    expect(queryClient.getQueryData(['web-v4', 'agent-task-index', 'task-1'])).toEqual({
      taskId: 'task-1',
      sessionId: 'hub-session-1',
      edgeRunId: 'edge-run-1',
      status: 'completed',
    });
    expect(queryClient.getQueryData(['web-v4', 'active-agent-task', 'hub-session-1'])).toEqual({
      taskId: 'task-1',
      sessionId: 'hub-session-1',
      edgeRunId: 'edge-run-1',
      status: 'completed',
    });
  });

  it('invalidates execution targets on device online events', () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

    invalidateWebWorkbenchHubQueries(queryClient, HUB_EVENTS.DEVICE_ONLINE, {
      device_id: 'desktop-1',
    });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['web-v4', 'execution-targets'] });
  });

  it('dispatches matching Hub agent.stream runtime events to the live transcript handler', () => {
    const onRuntimeEvent = vi.fn();

    dispatchHubRuntimeEvent(HUB_EVENTS.AGENT_STREAM, {
      id: 'evt-live',
      task_id: 'task-live',
      edge_run_id: 'run-live',
      session_id: 'hub-session-1',
      agent_instance_id: 'agent-live',
      event_seq: 1,
      event_type: 'run.agent.text_block',
      payload: { content: 'live block' },
      created_at: '2026-06-07T05:00:00Z',
    }, 'hub-session-1', onRuntimeEvent);

    expect(onRuntimeEvent).toHaveBeenCalledWith({
      id: 'evt-live',
      task_id: 'task-live',
      edge_run_id: 'run-live',
      session_id: 'hub-session-1',
      agent_instance_id: 'agent-live',
      event_seq: 1,
      event_type: 'run.agent.text_block',
      payload: { content: 'live block' },
      created_at: '2026-06-07T05:00:00Z',
    });
  });

  it('does not dispatch runtime events for another Hub session', () => {
    const onRuntimeEvent = vi.fn();

    dispatchHubRuntimeEvent(HUB_EVENTS.AGENT_STREAM, {
      id: 'evt-other',
      session_id: 'hub-session-2',
      event_type: 'run.agent.text_block',
      payload: { content: 'other session' },
    }, 'hub-session-1', onRuntimeEvent);

    expect(onRuntimeEvent).not.toHaveBeenCalled();
  });

  it('dispatches terminal Hub agent events into the runtime transcript', () => {
    const onRuntimeEvent = vi.fn();

    dispatchHubRuntimeEvent(HUB_EVENTS.AGENT_DONE, {
      task_id: 'task-terminal',
      edge_run_id: 'run-terminal',
      session_id: 'hub-session-1',
      result_summary: 'Tests passed',
      usage: { input_tokens: 10, output_tokens: 5 },
      created_at: '2026-06-07T05:00:02Z',
    }, 'hub-session-1', onRuntimeEvent);

    expect(onRuntimeEvent).toHaveBeenCalledWith({
      task_id: 'task-terminal',
      edge_run_id: 'run-terminal',
      session_id: 'hub-session-1',
      event_type: 'run.agent.result',
      payload: {
        content: 'Tests passed',
        success: true,
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      created_at: '2026-06-07T05:00:02Z',
    });
  });
});

describe('createWebWorkbenchHubInvalidationScheduler (#1352)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const sessionsKeyCalls = (invalidateQueries: { mock: { calls: unknown[][] } }) =>
    invalidateQueries.mock.calls.filter(([filters]) =>
      JSON.stringify((filters as { queryKey?: unknown } | undefined)?.queryKey)
        === JSON.stringify(['web-v4', 'hub-sessions']),
    );

  it('coalesces per-token AGENT_STREAM invalidations into a single trailing flush', () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const scheduler = createWebWorkbenchHubInvalidationScheduler(queryClient);

    for (let seq = 1; seq <= 5; seq += 1) {
      scheduler.notify(HUB_EVENTS.AGENT_STREAM, {
        task_id: 'task-stream',
        session_id: 'hub-session-1',
        event_seq: seq,
        event_type: 'run.agent.text_delta',
      });
    }

    // No cache traffic while the stream window is open.
    expect(invalidateQueries).not.toHaveBeenCalled();

    vi.advanceTimersByTime(AGENT_STREAM_INVALIDATE_WINDOW_MS);

    // Five frames → exactly one flush.
    expect(sessionsKeyCalls(invalidateQueries)).toHaveLength(1);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['web-v4', 'hub-messages', 'hub-session-1'],
    });

    scheduler.dispose();
  });

  it('opens a new window for stream frames arriving after a flush', () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const scheduler = createWebWorkbenchHubInvalidationScheduler(queryClient);

    scheduler.notify(HUB_EVENTS.AGENT_STREAM, { task_id: 'task-stream', session_id: 'hub-session-1', event_seq: 1 });
    vi.advanceTimersByTime(AGENT_STREAM_INVALIDATE_WINDOW_MS);
    scheduler.notify(HUB_EVENTS.AGENT_STREAM, { task_id: 'task-stream', session_id: 'hub-session-1', event_seq: 2 });
    vi.advanceTimersByTime(AGENT_STREAM_INVALIDATE_WINDOW_MS);

    expect(sessionsKeyCalls(invalidateQueries)).toHaveLength(2);

    scheduler.dispose();
  });

  it('keeps non-stream events immediate and flushes the pending stream frame first', () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const scheduler = createWebWorkbenchHubInvalidationScheduler(queryClient);

    scheduler.notify(HUB_EVENTS.AGENT_STREAM, {
      task_id: 'task-1',
      session_id: 'hub-session-1',
      event_seq: 1,
    });
    scheduler.notify(HUB_EVENTS.AGENT_DONE, {
      task_id: 'task-1',
      session_id: 'hub-session-1',
      result_summary: 'done',
    });

    // AGENT_DONE invalidated without waiting for the window…
    expect(sessionsKeyCalls(invalidateQueries)).toHaveLength(2);
    // …and the pending stream frame flushed BEFORE it, so the terminal
    // task-index status wins and is not overwritten by a late `running` write.
    expect(queryClient.getQueryData(['web-v4', 'agent-task-index', 'task-1'])).toMatchObject({
      status: 'completed',
    });

    vi.advanceTimersByTime(AGENT_STREAM_INVALIDATE_WINDOW_MS);
    expect(queryClient.getQueryData(['web-v4', 'agent-task-index', 'task-1'])).toMatchObject({
      status: 'completed',
    });

    scheduler.dispose();
  });

  it('flushes the trailing stream frame on dispose', () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const scheduler = createWebWorkbenchHubInvalidationScheduler(queryClient);

    scheduler.notify(HUB_EVENTS.AGENT_STREAM, { task_id: 'task-1', session_id: 'hub-session-1', event_seq: 1 });
    expect(invalidateQueries).not.toHaveBeenCalled();

    scheduler.dispose();

    expect(sessionsKeyCalls(invalidateQueries)).toHaveLength(1);
    // Timer was cleared — nothing double-flushes afterwards.
    vi.advanceTimersByTime(AGENT_STREAM_INVALIDATE_WINDOW_MS);
    expect(sessionsKeyCalls(invalidateQueries)).toHaveLength(1);
  });
});

function streamEvent(seq: number): HubRuntimeEventTranscriptInput {
  return {
    id: `event-${seq}`,
    task_id: 'task-1',
    edge_run_id: 'run-1',
    session_id: 'hub-session-1',
    agent_instance_id: 'agent-1',
    event_seq: seq,
    event_type: 'run.agent.text_delta',
    payload: { content: `token-${seq}` },
    created_at: `2026-07-27T00:00:${String(seq).padStart(2, '0')}Z`,
  };
}

describe('createWebWorkbenchLiveEventBatcher (#1415)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushes every original event in order after one display-frame window', () => {
    const batches: HubRuntimeEventTranscriptInput[][] = [];
    const batcher = createWebWorkbenchLiveEventBatcher((events) => {
      batches.push([...events]);
    });

    batcher.push(streamEvent(1));
    batcher.push(streamEvent(2));
    vi.advanceTimersByTime(AGENT_STREAM_LIVE_BATCH_WINDOW_MS - 1);
    expect(batches).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(batches).toEqual([[streamEvent(1), streamEvent(2)]]);
    batcher.dispose();
  });

  it('supports activity-only work and never double-flushes after dispose', () => {
    const flush = vi.fn();
    const batcher = createWebWorkbenchLiveEventBatcher(flush);

    batcher.push();
    batcher.dispose();
    expect(flush).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledWith([]);

    vi.advanceTimersByTime(AGENT_STREAM_LIVE_BATCH_WINDOW_MS);
    batcher.push(streamEvent(1));
    expect(flush).toHaveBeenCalledOnce();
  });
});

function mountRealtimeHarness() {
  const anyHandlers = new Set<(type: string, payload: unknown) => void>();
  const statusHandlers = new Set<(status: TransportStatus) => void>();
  const close = vi.fn();
  const createSocket = (_options: HubWSOptions): HubWSHandle => ({
    onAny: (handler: (type: string, payload: unknown) => void) => {
      anyHandlers.add(handler);
      return () => anyHandlers.delete(handler);
    },
    onStatus: (handler: (status: TransportStatus) => void) => {
      statusHandlers.add(handler);
      return () => statusHandlers.delete(handler);
    },
    connect: () => undefined,
    close,
  }) as unknown as HubWSHandle;
  const queryClient = new QueryClient();
  const delivered: HubRuntimeEventTranscriptInput[] = [];
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  const hook = renderHook(({ runtimeSessionId, runtimeTaskId }: {
    runtimeSessionId: string;
    runtimeTaskId: string;
  }) => {
    useWebHubRealtime({
      enabled: true,
      runtimeSessionId,
      runtimeTaskId,
      onRuntimeEvent: (event) => delivered.push(event),
      createSocket,
      getToken: () => 'fixture-token',
    });
  }, {
    wrapper,
    initialProps: {
      runtimeSessionId: 'hub-session-1',
      runtimeTaskId: 'task-1',
    },
  });

  return {
    delivered,
    close,
    emit: (type: string, payload: unknown) => {
      act(() => {
        for (const handler of anyHandlers) handler(type, payload);
      });
    },
    setStatus: (status: TransportStatus) => {
      act(() => {
        for (const handler of statusHandlers) handler(status);
      });
    },
    switchRuntime: (runtimeSessionId: string, runtimeTaskId: string) => {
      act(() => hook.rerender({ runtimeSessionId, runtimeTaskId }));
    },
    unmount: () => act(() => hook.unmount()),
    clear: () => queryClient.clear(),
  };
}

describe('useWebHubRealtime live event ordering (#1415)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    getAgentActivityStore().reset();
    vi.useRealTimers();
  });

  it('flushes pending stream events before dispatching a non-stream event immediately', () => {
    const harness = mountRealtimeHarness();
    harness.emit(HUB_EVENTS.AGENT_STREAM, streamEvent(1));
    harness.emit(HUB_EVENTS.AGENT_DONE, {
      task_id: 'task-1',
      edge_run_id: 'run-1',
      session_id: 'hub-session-1',
      result_summary: 'done',
      created_at: '2026-07-27T00:01:00Z',
    });

    expect(harness.delivered.map((event) => event.event_type)).toEqual([
      'run.agent.text_delta',
      'run.agent.result',
    ]);
    vi.advanceTimersByTime(AGENT_STREAM_LIVE_BATCH_WINDOW_MS);
    expect(harness.delivered).toHaveLength(2);
    harness.unmount();
    harness.clear();
  });

  it('flushes a trailing stream frame on socket disconnect without duplication', () => {
    const harness = mountRealtimeHarness();
    harness.emit(HUB_EVENTS.AGENT_STREAM, streamEvent(1));
    expect(harness.delivered).toEqual([]);

    harness.setStatus('disconnected');
    expect(harness.delivered).toEqual([streamEvent(1)]);
    vi.advanceTimersByTime(AGENT_STREAM_LIVE_BATCH_WINDOW_MS);
    expect(harness.delivered).toHaveLength(1);
    harness.unmount();
    harness.clear();
  });

  it('flushes a trailing stream frame during unmount before closing the socket', () => {
    const harness = mountRealtimeHarness();
    harness.emit(HUB_EVENTS.AGENT_STREAM, streamEvent(1));

    harness.unmount();
    expect(harness.delivered).toEqual([streamEvent(1)]);
    expect(harness.close).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(AGENT_STREAM_LIVE_BATCH_WINDOW_MS);
    expect(harness.delivered).toHaveLength(1);
    harness.clear();
  });

  it('drains the previous conversation before switching runtime refs', () => {
    const harness = mountRealtimeHarness();
    harness.emit(HUB_EVENTS.AGENT_STREAM, streamEvent(1));

    harness.switchRuntime('hub-session-2', 'task-2');
    expect(harness.delivered).toEqual([streamEvent(1)]);

    const nextEvent = {
      ...streamEvent(2),
      task_id: 'task-2',
      session_id: 'hub-session-2',
    };
    harness.emit(HUB_EVENTS.AGENT_STREAM, nextEvent);
    vi.advanceTimersByTime(AGENT_STREAM_LIVE_BATCH_WINDOW_MS);
    expect(harness.delivered).toEqual([streamEvent(1), nextEvent]);
    harness.unmount();
    harness.clear();
  });
});
