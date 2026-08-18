import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSubagentStreamStore } from './SubagentStreamStore';

function frame(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    team_run_id: 'team-run-1',
    team_id: 'team-1',
    session_id: 'session-1',
    agent_task_id: 'task-1',
    agent_instance_id: 'instance-1',
    event_seq: 1,
    event_type: 'message',
    payload: { text: 'hello' },
    created_at: '2026-05-24T10:00:00.000Z',
    ...overrides,
  };
}

describe('createSubagentStreamStore', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('aggregates a pushed event under its agent_task_id', () => {
    const store = createSubagentStreamStore();
    store.push(frame());

    const events = store.state.byTaskId['task-1'];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      agent_task_id: 'task-1',
      event_seq: 1,
      event_type: 'message',
    });
  });

  it('treats a duplicate (agent_task_id, event_seq) as a no-op', () => {
    const store = createSubagentStreamStore();
    store.push(frame());
    store.push(frame({ payload: { text: 'duplicate' } }));

    expect(store.state.byTaskId['task-1']).toHaveLength(1);
  });

  it('appends new event_seq values and keeps them sorted', () => {
    const store = createSubagentStreamStore();
    store.push(frame({ event_seq: 3 }));
    store.push(frame({ event_seq: 1 }));
    store.push(frame({ event_seq: 2 }));

    const seqs = store.state.byTaskId['task-1'].map((event) => event.event_seq);
    expect(seqs).toEqual([1, 2, 3]);
  });

  it('buckets events by distinct agent_task_id', () => {
    const store = createSubagentStreamStore();
    store.push(frame({ agent_task_id: 'task-a', event_seq: 1 }));
    store.push(frame({ agent_task_id: 'task-b', event_seq: 1 }));

    expect(Object.keys(store.state.byTaskId).sort()).toEqual(['task-a', 'task-b']);
    expect(store.state.byTaskId['task-a']).toHaveLength(1);
    expect(store.state.byTaskId['task-b']).toHaveLength(1);
  });

  it('rejects payloads missing agent_task_id', () => {
    const store = createSubagentStreamStore();
    store.push(frame({ agent_task_id: '' }));

    expect(store.state.byTaskId).toEqual({});
    expect(warnSpy).toHaveBeenCalled();
  });

  it('rejects payloads missing event_seq', () => {
    const store = createSubagentStreamStore();
    const payload = frame();
    delete payload.event_seq;
    store.push(payload);

    expect(store.state.byTaskId).toEqual({});
    expect(warnSpy).toHaveBeenCalled();
  });

  it('ignores non-object payloads without throwing', () => {
    const store = createSubagentStreamStore();
    expect(() => {
      store.push(null);
      store.push('not-an-object');
      store.push(42);
    }).not.toThrow();
    expect(store.state.byTaskId).toEqual({});
  });

  it('accepts camelCase field aliases', () => {
    const store = createSubagentStreamStore();
    store.push({
      teamRunId: 'team-run-9',
      agentTaskId: 'task-camel',
      agentInstanceId: 'instance-camel',
      eventSeq: 5,
      eventType: 'tool_call',
      createdAt: '2026-05-24T10:00:00.000Z',
    });

    const events = store.state.byTaskId['task-camel'];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      team_run_id: 'team-run-9',
      agent_instance_id: 'instance-camel',
      event_seq: 5,
      event_type: 'tool_call',
    });
  });

  it('includes optional fields only when present', () => {
    const store = createSubagentStreamStore();
    store.push(frame({ assignment_id: 'assign-1', edge_run_id: 'edge-1' }));
    store.push(frame({ agent_task_id: 'task-2', event_seq: 1 }));

    expect(store.state.byTaskId['task-1'][0].assignment_id).toBe('assign-1');
    expect(store.state.byTaskId['task-1'][0].edge_run_id).toBe('edge-1');
    expect(store.state.byTaskId['task-2'][0].assignment_id).toBeUndefined();
  });
});

describe('createSubagentStreamStore subscription', () => {
  it('notifies subscribers on push and supports unsubscribe', () => {
    const store = createSubagentStreamStore();
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });

    store.push(frame());
    expect(calls).toBe(1);

    unsubscribe();
    store.push(frame({ event_seq: 2 }));
    expect(calls).toBe(1);
  });

  it('does not notify for a rejected push', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createSubagentStreamStore();
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });

    store.push(frame({ agent_task_id: '' }));
    expect(calls).toBe(0);
    warnSpy.mockRestore();
  });

  it('isolates a throwing listener from the others', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createSubagentStreamStore();
    let healthyCalls = 0;
    store.subscribe(() => {
      throw new Error('boom');
    });
    store.subscribe(() => {
      healthyCalls += 1;
    });

    expect(() => store.push(frame())).not.toThrow();
    expect(healthyCalls).toBe(1);
    warnSpy.mockRestore();
  });

  it('reset clears state and notifies', () => {
    const store = createSubagentStreamStore();
    store.push(frame());
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });

    store.reset();
    expect(store.state.byTaskId).toEqual({});
    expect(calls).toBe(1);
  });
});
