import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HUB_EVENTS } from '@shared/hubEvents';
import { getAgentActivityStore, getPinMapStore, type HubRuntimeEventTranscriptInput } from '@shared/transcript';
import { getMessageDelegationStore, getSubagentStreamStore } from '@shared/workbench';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHubWS, type HubWSHandle, type HubWSOptions } from '@shared/hub/hubWS';
import { type Transport } from '@/api/transport';
import type { TransportStatus } from '@/api/transport';
import { useConnectionStore } from '@/stores/connectionStore';
import { useHubStore } from '@/stores/hubStore';
import { useToastStore } from '@shared/ui/toast';
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
    getPinMapStore().reset();
    getSubagentStreamStore().reset();
    vi.useRealTimers();
  });

  it('feeds MESSAGE_PIN / MESSAGE_UNPIN frames into the session-scoped pinMap store', () => {
    const harness = mountRealtimeHarness();
    // Seed the pinMap for the harness runtime session, as the model's /pins
    // seeding effect does in production.
    getPinMapStore().loadPinnedForSession('hub-session-1', []);

    harness.emit(HUB_EVENTS.MESSAGE_PIN, {
      session_id: 'hub-session-1',
      message_id: 'message-1',
      pinned_by_user_id: 'user-1',
      pinned_at: '2026-08-01T00:00:00Z',
    });
    expect(getPinMapStore().isPinned('message-1')).toBe(true);

    harness.emit(HUB_EVENTS.MESSAGE_UNPIN, {
      session_id: 'hub-session-1',
      message_id: 'message-1',
    });
    expect(getPinMapStore().isPinned('message-1')).toBe(false);
  });

  it('drops pin frames from sessions other than the runtime session', () => {
    const harness = mountRealtimeHarness();
    getPinMapStore().loadPinnedForSession('hub-session-1', []);

    harness.emit(HUB_EVENTS.MESSAGE_PIN, {
      session_id: 'other-session',
      message_id: 'foreign-message',
      pinned_by_user_id: 'user-1',
      pinned_at: '2026-08-01T00:00:00Z',
    });
    expect(getPinMapStore().isPinned('foreign-message')).toBe(false);
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

describe('team.subagent.stream dispatch (#1478 Phase C)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    getSubagentStreamStore().reset();
    vi.useRealTimers();
  });

  it('routes team.subagent.stream frames to SubagentStreamStore byTaskId', () => {
    const harness = mountRealtimeHarness();
    const store = getSubagentStreamStore();

    harness.emit(HUB_EVENTS.TEAM_SUBAGENT_STREAM, {
      team_run_id: 'team-run-1',
      team_id: 'team-1',
      session_id: 'hub-session-1',
      assignment_id: 'assign-1',
      team_task_id: 'tt-1',
      member_id: 'member-1',
      agent_task_id: 'agent-task-1',
      agent_instance_id: 'agent-1',
      edge_run_id: 'edge-run-1',
      event_seq: 1,
      event_type: 'run.agent.text_delta',
      payload: { content: 'hello' },
      created_at: '2026-07-30T00:00:00Z',
    });

    const events = store.state.byTaskId['agent-task-1']!;
    expect(events).toBeDefined();
    expect(events).toHaveLength(1);
    expect(events[0]!.event_seq).toBe(1);
    expect(events[0]!.event_type).toBe('run.agent.text_delta');

    harness.unmount();
    harness.clear();
  });

  it('deduplicates events with the same (agent_task_id, event_seq)', () => {
    const harness = mountRealtimeHarness();
    const store = getSubagentStreamStore();
    const payload = {
      team_run_id: 'team-run-1',
      team_id: 'team-1',
      session_id: 'hub-session-1',
      agent_task_id: 'agent-task-1',
      agent_instance_id: 'agent-1',
      event_seq: 1,
      event_type: 'run.agent.text_delta',
      payload: { content: 'first' },
      created_at: '2026-07-30T00:00:00Z',
    };

    // First delivery.
    harness.emit(HUB_EVENTS.TEAM_SUBAGENT_STREAM, payload);
    const events1 = store.state.byTaskId['agent-task-1'];
    if (!events1) throw new Error('expected events');
    expect(events1[0]!.payload).toEqual({ content: 'first' });

    // Duplicate delivery with same event_seq — must be a no-op.
    harness.emit(HUB_EVENTS.TEAM_SUBAGENT_STREAM, {
      ...payload,
      payload: { content: 'second (should be ignored)' },
    });
    const events2 = store.state.byTaskId['agent-task-1'];
    expect(events2).toHaveLength(1);
    if (!events2) throw new Error('expected events');
    // Original payload preserved.
    expect(events2[0]!.payload).toEqual({ content: 'first' });

    harness.unmount();
    harness.clear();
  });

  it('appends new event_seq values and maintains ordering', () => {
    const harness = mountRealtimeHarness();
    const store = getSubagentStreamStore();

    harness.emit(HUB_EVENTS.TEAM_SUBAGENT_STREAM, {
      team_run_id: 'team-run-1',
      team_id: 'team-1',
      session_id: 'hub-session-1',
      agent_task_id: 'agent-task-1',
      agent_instance_id: 'agent-1',
      event_seq: 2,
      event_type: 'run.agent.text_delta',
      payload: { content: 'second' },
      created_at: '2026-07-30T00:00:01Z',
    });
    harness.emit(HUB_EVENTS.TEAM_SUBAGENT_STREAM, {
      team_run_id: 'team-run-1',
      team_id: 'team-1',
      session_id: 'hub-session-1',
      agent_task_id: 'agent-task-1',
      agent_instance_id: 'agent-1',
      event_seq: 1,
      event_type: 'run.agent.text_delta',
      payload: { content: 'first' },
      created_at: '2026-07-30T00:00:00Z',
    });

    // Two events, sorted by event_seq.
    const ordering = store.state.byTaskId['agent-task-1']!;
    expect(ordering).toHaveLength(2);
    expect(ordering[0]!.event_seq).toBe(1);
    expect(ordering[0]!.payload).toEqual({ content: 'first' });
    expect(ordering[1]!.event_seq).toBe(2);
    expect(ordering[1]!.payload).toEqual({ content: 'second' });

    harness.unmount();
    harness.clear();
  });

  it('tracks multiple tasks independently', () => {
    const harness = mountRealtimeHarness();
    const store = getSubagentStreamStore();

    harness.emit(HUB_EVENTS.TEAM_SUBAGENT_STREAM, {
      team_run_id: 'team-run-1',
      team_id: 'team-1',
      session_id: 'hub-session-1',
      agent_task_id: 'task-a',
      agent_instance_id: 'agent-1',
      event_seq: 1,
      event_type: 'run.agent.text_delta',
      payload: { content: 'a1' },
      created_at: '2026-07-30T00:00:00Z',
    });
    harness.emit(HUB_EVENTS.TEAM_SUBAGENT_STREAM, {
      team_run_id: 'team-run-1',
      team_id: 'team-1',
      session_id: 'hub-session-1',
      agent_task_id: 'task-b',
      agent_instance_id: 'agent-2',
      event_seq: 1,
      event_type: 'run.agent.text_delta',
      payload: { content: 'b1' },
      created_at: '2026-07-30T00:00:00Z',
    });

    const aEvents = store.state.byTaskId['task-a']!;
    const bEvents = store.state.byTaskId['task-b']!;
    expect(aEvents).toHaveLength(1);
    expect(bEvents).toHaveLength(1);
    expect(aEvents[0]!.payload).toEqual({ content: 'a1' });
    expect(bEvents[0]!.payload).toEqual({ content: 'b1' });

    harness.unmount();
    harness.clear();
  });
});

describe('agent.dispatch → MessageDelegationStore (#1406 Phase 3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    getMessageDelegationStore().reset();
    vi.useRealTimers();
  });

  it('indexes agent.dispatch by trigger_message_id for inline cards', () => {
    const harness = mountRealtimeHarness();
    const store = getMessageDelegationStore();

    harness.emit(HUB_EVENTS.AGENT_DISPATCH, {
      task_id: 'task-dispatch-1',
      trigger_message_id: 'msg-dispatch-1',
      session_id: 'hub-session-1',
      agent_instance_id: 'agent-1',
      display_name: 'Researcher',
      created_at: '2026-07-31T00:00:00Z',
    });

    const entries = store.getEntriesByMessage('msg-dispatch-1');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.taskId).toBe('task-dispatch-1');
    expect(entries[0]!.triggerMessageId).toBe('msg-dispatch-1');
    expect(entries[0]!.displayName).toBe('Researcher');
    expect(entries[0]!.status).toBe('dispatching');

    harness.unmount();
    harness.clear();
  });

  it('transitions dispatching → streaming → done across agent lifecycle frames', () => {
    const harness = mountRealtimeHarness();
    const store = getMessageDelegationStore();

    harness.emit(HUB_EVENTS.AGENT_DISPATCH, {
      task_id: 'task-lifecycle',
      trigger_message_id: 'msg-lifecycle',
      session_id: 'hub-session-1',
      display_name: 'Planner',
      created_at: '2026-07-31T00:00:00Z',
    });
    harness.emit(HUB_EVENTS.AGENT_STREAM, {
      task_id: 'task-lifecycle',
      session_id: 'hub-session-1',
      event_seq: 1,
      event_type: 'run.agent.text_delta',
      created_at: '2026-07-31T00:00:01Z',
    });
    harness.emit(HUB_EVENTS.AGENT_DONE, {
      task_id: 'task-lifecycle',
      session_id: 'hub-session-1',
      result_summary: 'done',
      created_at: '2026-07-31T00:00:02Z',
    });

    const entry = store.state.byTaskId['task-lifecycle'];
    expect(entry?.status).toBe('done');
    expect(entry?.triggerMessageId).toBe('msg-lifecycle');

    harness.unmount();
    harness.clear();
  });

  it('ignores agent.dispatch frames without trigger_message_id', () => {
    const harness = mountRealtimeHarness();
    const store = getMessageDelegationStore();

    harness.emit(HUB_EVENTS.AGENT_DISPATCH, {
      task_id: 'task-no-msg',
      session_id: 'hub-session-1',
      created_at: '2026-07-31T00:00:00Z',
    });
    expect(store.state.byTaskId['task-no-msg']).toBeUndefined();

    harness.unmount();
    harness.clear();
  });
});

describe('connection status visibility (#1816)', () => {
  beforeEach(() => {
    useConnectionStore.setState({ isConnected: false, reconnecting: false });
  });

  afterEach(() => {
    useConnectionStore.setState({ isConnected: false, reconnecting: false });
  });

  it('mirrors WS transport status into the connection store', () => {
    const harness = mountRealtimeHarness();
    expect(useConnectionStore.getState().isConnected).toBe(false);
    expect(useConnectionStore.getState().reconnecting).toBe(false);

    harness.setStatus('connected');
    expect(useConnectionStore.getState().isConnected).toBe(true);
    expect(useConnectionStore.getState().reconnecting).toBe(false);

    harness.setStatus('reconnecting');
    expect(useConnectionStore.getState().isConnected).toBe(false);
    expect(useConnectionStore.getState().reconnecting).toBe(true);

    harness.setStatus('connected');
    expect(useConnectionStore.getState().isConnected).toBe(true);
    expect(useConnectionStore.getState().reconnecting).toBe(false);

    harness.setStatus('disconnected');
    expect(useConnectionStore.getState().isConnected).toBe(false);
    expect(useConnectionStore.getState().reconnecting).toBe(false);

    harness.unmount();
  });

  it('never leaves a stale connected flag after the realtime socket is torn down', () => {
    const harness = mountRealtimeHarness();
    harness.setStatus('connected');
    expect(useConnectionStore.getState().isConnected).toBe(true);

    harness.unmount();
    expect(useConnectionStore.getState().isConnected).toBe(false);
    expect(useConnectionStore.getState().reconnecting).toBe(false);
  });
});

/**
 * Fake Transport that records message handlers so tests can deliver raw
 * frames. The real shared createHubWS is used on top of it, so these tests
 * exercise the production swallow behavior of device.kicked frames.
 */
function createFakeSocketTransport() {
  const messageHandlers = new Set<(data: unknown) => void>();
  const closeSpy = vi.fn();
  const transport: Transport = {
    connect: vi.fn(),
    send: vi.fn(),
    close: () => {
      closeSpy();
      messageHandlers.clear();
    },
    on: (event, handler) => {
      if (event !== 'message') return () => undefined;
      const messageHandler = handler as (data: unknown) => void;
      messageHandlers.add(messageHandler);
      return () => {
        messageHandlers.delete(messageHandler);
      };
    },
    getStatus: () => 'connected',
  };
  return {
    transport,
    closeSpy,
    deliver: (frame: unknown) => {
      for (const handler of [...messageHandlers]) handler(frame);
    },
  };
}

describe('device.kicked feedback (#1816)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useHubStore.getState().clear();
    useToastStore.setState({ toasts: [] });
  });

  function mountKickedHarness() {
    const fake = createFakeSocketTransport();
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const hook = renderHook(() => {
      useWebHubRealtime({
        enabled: true,
        runtimeSessionId: 'hub-session-1',
        runtimeTaskId: 'task-1',
        onRuntimeEvent: () => undefined,
        // Real shared socket: swallows kicked frames before app handlers.
        createSocket: createHubWS,
        createTransport: () => fake.transport,
        getToken: () => 'fixture-token',
      });
    }, { wrapper });
    return { ...fake, unmount: () => act(() => hook.unmount()) };
  }

  it('shows user-visible feedback, resets the session, and guides re-login when the Hub kicks this device', async () => {
    sessionStorage.setItem('agenthub_hub_token', 'live-access');
    sessionStorage.setItem('agenthub_hub_refresh_token', 'live-refresh');
    useHubStore.getState().setAuthenticated(true, 'user-1', 'alice');
    const harness = mountKickedHarness();

    act(() => {
      harness.deliver({ type: HUB_EVENTS.AUTH_OK, payload: null });
    });
    expect(useHubStore.getState().authenticated).toBe(true);

    act(() => {
      harness.deliver({ type: HUB_EVENTS.DEVICE_KICKED, payload: { reason: 'replaced' } });
    });

    // The shared hubWS closed the socket after the kicked frame…
    expect(harness.closeSpy).toHaveBeenCalled();
    // …and the transport-level observer surfaced user-visible feedback.
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toEqual(
      expect.objectContaining({ type: 'warning' }),
    );
    expect(String(toasts[0]?.message)).toMatch(/webChat\.deviceKicked/);
    expect(toasts[0]?.action?.label).toMatch(/webChat\.deviceKicked\.signIn/);

    await waitFor(() => {
      expect(useHubStore.getState().authenticated).toBe(false);
      expect(useHubStore.getState().showAuthModal).toBe(true);
    });
    expect(sessionStorage.getItem('agenthub_hub_token')).toBeNull();
    expect(sessionStorage.getItem('agenthub_hub_refresh_token')).toBeNull();

    harness.unmount();
  });

  it('does not react to non-kicked device frames', () => {
    useHubStore.getState().setAuthenticated(true, 'user-1', 'alice');
    const harness = mountKickedHarness();

    act(() => {
      harness.deliver({ type: HUB_EVENTS.AUTH_OK, payload: null });
      harness.deliver({ type: HUB_EVENTS.DEVICE_ONLINE, payload: { device_id: 'desktop-1' } });
    });

    expect(useToastStore.getState().toasts).toHaveLength(0);
    expect(useHubStore.getState().authenticated).toBe(true);
    expect(useHubStore.getState().showAuthModal).toBe(false);

    harness.unmount();
  });
});
