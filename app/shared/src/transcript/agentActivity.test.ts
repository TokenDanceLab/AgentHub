import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAgentActivityStore, getAgentActivityStore } from './agentActivity';
import { HUB_EVENTS } from '../hubEvents';

describe('agentActivity store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes toolCalls in the snapshot (not dropped)', () => {
    const store = createAgentActivityStore();
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, {
      task_id: 'task-1',
      agent_name: 'Sonnet',
      tool_calls: 3,
    });

    expect(store.getSnapshot().activeAgents).toEqual([
      { id: 'task-1', name: 'Sonnet', status: 'dispatching', toolCalls: 3 },
    ]);
  });

  it('accumulates toolCalls deltas from pushAgentStatus (Edge SSE semantics)', () => {
    const store = createAgentActivityStore();
    store.pushAgentStatus('run-1', 'Agent', 'thinking');
    store.pushAgentStatus('run-1', 'Agent', 'streaming', 1);
    store.pushAgentStatus('run-1', 'Agent', 'streaming', 1);

    const entry = store.getSnapshot().activeAgents.find((a) => a.id === 'run-1');
    expect(entry?.toolCalls).toBe(2);
  });

  it('keeps a zero toolCalls baseline without deltas', () => {
    const store = createAgentActivityStore();
    store.pushAgentStatus('run-1', 'Agent', 'thinking');
    store.pushAgentStatus('run-1', 'Agent', 'streaming');

    const entry = store.getSnapshot().activeAgents.find((a) => a.id === 'run-1');
    expect(entry?.toolCalls).toBe(0);
  });

  it('snapshot is a serialisable array (no Map)', () => {
    const store = createAgentActivityStore();
    store.handleEvent(HUB_EVENTS.AGENT_STREAM, {
      agent_id: 'a-1',
      agent_name: 'A',
    });
    store.handleEvent(HUB_EVENTS.AGENT_STREAM, {
      agent_id: 'a-2',
      agent_name: 'B',
    });

    const snapshot = store.getSnapshot();
    expect(Array.isArray(snapshot.activeAgents)).toBe(true);
    expect(snapshot.activeAgents.map((a) => a.id).sort()).toEqual(['a-1', 'a-2']);
  });

  it('drops the entry after done auto-removal', () => {
    const store = createAgentActivityStore();
    store.pushAgentStatus('run-1', 'Agent', 'thinking');
    store.pushAgentStatus('run-1', 'Agent', 'done');

    vi.advanceTimersByTime(3_100);
    expect(store.getSnapshot().activeAgents).toHaveLength(0);
  });

  it('reset clears entries and timers', () => {
    const store = createAgentActivityStore();
    store.pushAgentStatus('run-1', 'Agent', 'thinking');
    store.pushAgentStatus('run-1', 'Agent', 'done');
    store.reset();

    expect(store.getSnapshot().activeAgents).toHaveLength(0);
    vi.advanceTimersByTime(10_000);
    expect(store.getSnapshot().activeAgents).toHaveLength(0);
  });

  it('tracks the full Hub WS lifecycle: dispatch → stream → done → auto-remove', () => {
    const store = createAgentActivityStore();
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, { agent_id: 'a-1', agent_name: 'Builder' });
    expect(store.getSnapshot().activeAgents[0]).toMatchObject({
      id: 'a-1',
      name: 'Builder',
      status: 'dispatching',
    });

    store.handleEvent(HUB_EVENTS.AGENT_STREAM, { agent_id: 'a-1' });
    expect(store.getSnapshot().activeAgents[0]).toMatchObject({
      status: 'streaming',
      name: 'Builder',
    });

    store.handleEvent(HUB_EVENTS.AGENT_DONE, { agent_id: 'a-1' });
    expect(store.getSnapshot().activeAgents[0]).toMatchObject({ status: 'done' });

    // Done entries auto-remove after DONE_REMOVE_MS.
    vi.advanceTimersByTime(3_100);
    expect(store.getSnapshot().activeAgents).toHaveLength(0);
  });

  it('marks failed agents and removes them after the longer failed delay', () => {
    const store = createAgentActivityStore();
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, { agent_id: 'a-1', agent_name: 'Builder' });
    store.handleEvent(HUB_EVENTS.AGENT_FAILED, { agent_id: 'a-1' });
    expect(store.getSnapshot().activeAgents[0]).toMatchObject({ status: 'failed' });

    // Still present partway through the failed window.
    vi.advanceTimersByTime(3_100);
    expect(store.getSnapshot().activeAgents).toHaveLength(1);

    vi.advanceTimersByTime(2_000);
    expect(store.getSnapshot().activeAgents).toHaveLength(0);
  });

  it('cancel removes the agent immediately and clears any pending removal', () => {
    const store = createAgentActivityStore();
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, { agent_id: 'a-1', agent_name: 'Builder' });
    store.handleEvent(HUB_EVENTS.AGENT_DONE, { agent_id: 'a-1' }); // schedules removal
    store.handleEvent(HUB_EVENTS.AGENT_CANCEL, { agent_id: 'a-1' });

    expect(store.getSnapshot().activeAgents).toHaveLength(0);
    // The cancelled removal timer must not fire and resurrect nothing.
    vi.advanceTimersByTime(10_000);
    expect(store.getSnapshot().activeAgents).toHaveLength(0);
  });

  it('a new stream after done cancels the pending removal timer', () => {
    const store = createAgentActivityStore();
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, { agent_id: 'a-1', agent_name: 'Builder' });
    store.handleEvent(HUB_EVENTS.AGENT_DONE, { agent_id: 'a-1' }); // schedules removal
    store.handleEvent(HUB_EVENTS.AGENT_STREAM, { agent_id: 'a-1' }); // clears it

    vi.advanceTimersByTime(10_000);
    expect(store.getSnapshot().activeAgents).toHaveLength(1);
    expect(store.getSnapshot().activeAgents[0]).toMatchObject({ status: 'streaming' });
  });

  it('pushAgentStatus clears a pending removal timer when the agent resumes', () => {
    const store = createAgentActivityStore();
    store.pushAgentStatus('run-1', 'Agent', 'done'); // schedules removal
    store.pushAgentStatus('run-1', 'Agent', 'streaming'); // clears it

    vi.advanceTimersByTime(10_000);
    expect(store.getSnapshot().activeAgents).toHaveLength(1);
    expect(store.getSnapshot().activeAgents[0]?.status).toBe('streaming');
  });

  it('failed pushAgentStatus uses the failed removal delay', () => {
    const store = createAgentActivityStore();
    store.pushAgentStatus('run-1', 'Agent', 'failed');

    vi.advanceTimersByTime(3_100);
    expect(store.getSnapshot().activeAgents).toHaveLength(1);
    vi.advanceTimersByTime(2_000);
    expect(store.getSnapshot().activeAgents).toHaveLength(0);
  });

  it('ignores malformed payloads and unknown event types', () => {
    const store = createAgentActivityStore();
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, undefined);
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, 'not-an-object');
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, { agent_name: 'no id' });
    store.handleEvent('some.other.event', { agent_id: 'a-1' });

    expect(store.getSnapshot().activeAgents).toHaveLength(0);
  });

  it('accepts camelCase payload aliases and defaults the agent name', () => {
    const store = createAgentActivityStore();
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, { taskId: 'task-9', agentLabel: 'Reviewer' });
    store.handleEvent(HUB_EVENTS.AGENT_STREAM, { agentId: 'task-10', toolCalls: 2 });

    const agents = store.getSnapshot().activeAgents;
    expect(agents.find((a) => a.id === 'task-9')?.name).toBe('Reviewer');
    const defaulted = agents.find((a) => a.id === 'task-10');
    expect(defaulted?.name).toBe('Agent');
    expect(defaulted?.toolCalls).toBe(2);
  });

  it('notifies subscribers on change and supports unsubscribe', () => {
    const store = createAgentActivityStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.pushAgentStatus('run-1', 'Agent', 'thinking');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.pushAgentStatus('run-1', 'Agent', 'done');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('getSnapshot returns a cached, serialisable snapshot', () => {
    const store = createAgentActivityStore();
    expect(store.getSnapshot().activeAgents).toEqual([]);

    store.pushAgentStatus('run-1', 'Agent', 'thinking');
    const first = store.getSnapshot();
    const second = store.getSnapshot();
    expect(first).toBe(second);
    expect(first.activeAgents).toEqual([
      { id: 'run-1', name: 'Agent', status: 'thinking', toolCalls: 0 },
    ]);
  });
});

describe('agentActivity singleton', () => {
  it('returns the same store instance across calls', () => {
    const first = getAgentActivityStore();
    const second = getAgentActivityStore();
    expect(first).toBe(second);
    first.reset();
  });
});
