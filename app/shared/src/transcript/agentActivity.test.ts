import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAgentActivityStore } from './agentActivity';
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
});
