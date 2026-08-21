import { describe, expect, it, beforeEach, vi } from 'vitest';
import { HUB_EVENTS } from '@shared/hubEvents';
import {
  createMessageDelegationStore,
  type MessageDelegationStore,
} from './MessageDelegationStore';

function dispatchFrame(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    task_id: 'task-1',
    trigger_message_id: 'msg-1',
    session_id: 'sess-1',
    agent_instance_id: 'inst-1',
    display_name: 'Researcher',
    created_at: '2026-07-31T00:00:00Z',
    ...overrides,
  };
}

describe('MessageDelegationStore', () => {
  let store: MessageDelegationStore;

  beforeEach(() => {
    store = createMessageDelegationStore();
  });

  // ── AGENT_DISPATCH ──────────────────────────────────────────────────────

  it('indexes an entry by trigger_message_id on agent.dispatch', () => {
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, dispatchFrame());

    const entries = store.getEntriesByMessage('msg-1');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      taskId: 'task-1',
      triggerMessageId: 'msg-1',
      displayName: 'Researcher',
      status: 'dispatching',
    });
  });

  it('ignores agent.dispatch without trigger_message_id (cannot inline)', () => {
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, dispatchFrame({ trigger_message_id: '' }));
    expect(store.getEntriesByMessage('msg-1')).toHaveLength(0);
  });

  it('ignores agent.dispatch without task_id', () => {
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, dispatchFrame({ task_id: '' }));
    expect(store.getEntriesByMessage('msg-1')).toHaveLength(0);
  });

  it('accepts camelCase aliases (triggerMessageId / taskId / displayName)', () => {
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, {
      taskId: 'task-camel',
      triggerMessageId: 'msg-camel',
      displayName: 'Planner',
      createdAt: '2026-07-31T00:00:00Z',
    });
    const entries = store.getEntriesByMessage('msg-camel');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.taskId).toBe('task-camel');
    expect(entries[0]!.displayName).toBe('Planner');
  });

  it('falls back to a task short code when display_name is missing', () => {
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, dispatchFrame({
      task_id: 'task-abc-xyz789',
      display_name: '',
    }));
    expect(store.getEntriesByMessage('msg-1')[0]!.displayName).toBe('#xyz789');
  });

  // ── AGENT_STREAM churn control ───────────────────────────────────────────

  it('transitions dispatching → streaming on the first agent.stream', () => {
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, dispatchFrame());
    store.handleEvent(HUB_EVENTS.AGENT_STREAM, {
      task_id: 'task-1',
      created_at: '2026-07-31T00:00:01Z',
    });
    expect(store.getEntriesByMessage('msg-1')[0]!.status).toBe('streaming');
  });

  it('no-ops on subsequent agent.stream tokens (no per-token churn)', () => {
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, dispatchFrame());
    const listener = vi.fn();
    store.subscribe(listener);

    store.handleEvent(HUB_EVENTS.AGENT_STREAM, { task_id: 'task-1', created_at: 't1' });
    const callsAfterFirst = listener.mock.calls.length;
    // Subsequent stream tokens must not notify.
    store.handleEvent(HUB_EVENTS.AGENT_STREAM, { task_id: 'task-1', created_at: 't2' });
    store.handleEvent(HUB_EVENTS.AGENT_STREAM, { task_id: 'task-1', created_at: 't3' });
    expect(listener.mock.calls.length).toBe(callsAfterFirst);
    // Status remains streaming with the first transition's timestamp.
    const entry = store.getEntriesByMessage('msg-1')[0]!;
    expect(entry.status).toBe('streaming');
    expect(entry.updatedAt).toBe('t1');
  });

  it('ignores agent.stream for a task it never saw a dispatch for', () => {
    store.handleEvent(HUB_EVENTS.AGENT_STREAM, { task_id: 'ghost', created_at: 't1' });
    expect(store.state.byTaskId['ghost']).toBeUndefined();
  });

  // ── Terminal events ──────────────────────────────────────────────────────

  it('transitions to done on agent.done', () => {
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, dispatchFrame());
    store.handleEvent(HUB_EVENTS.AGENT_DONE, {
      task_id: 'task-1',
      result_summary: 'all good',
      created_at: '2026-07-31T00:00:05Z',
    });
    expect(store.getEntriesByMessage('msg-1')[0]!.status).toBe('done');
  });

  it('transitions to failed on agent.failed', () => {
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, dispatchFrame());
    store.handleEvent(HUB_EVENTS.AGENT_FAILED, {
      task_id: 'task-1',
      error: 'boom',
      created_at: '2026-07-31T00:00:05Z',
    });
    expect(store.getEntriesByMessage('msg-1')[0]!.status).toBe('failed');
  });

  it('transitions to cancelled on agent.cancel', () => {
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, dispatchFrame());
    store.handleEvent(HUB_EVENTS.AGENT_CANCEL, {
      task_id: 'task-1',
      reason: 'user abort',
      created_at: '2026-07-31T00:00:05Z',
    });
    expect(store.getEntriesByMessage('msg-1')[0]!.status).toBe('cancelled');
  });

  it('ignores terminal events for an unknown task', () => {
    store.handleEvent(HUB_EVENTS.AGENT_DONE, { task_id: 'ghost' });
    store.handleEvent(HUB_EVENTS.AGENT_FAILED, { task_id: 'ghost' });
    store.handleEvent(HUB_EVENTS.AGENT_CANCEL, { task_id: 'ghost' });
    expect(Object.keys(store.state.byTaskId)).toHaveLength(0);
  });

  // ── trigger_message_id preservation ──────────────────────────────────────

  it('preserves the trigger_message_id link when a terminal frame omits it', () => {
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, dispatchFrame());
    // AGENT_DONE only carries task_id — the store must keep the msg-1 link.
    store.handleEvent(HUB_EVENTS.AGENT_DONE, { task_id: 'task-1', created_at: 't1' });
    expect(store.getEntriesByMessage('msg-1')).toHaveLength(1);
    expect(store.state.byTaskId['task-1']!.triggerMessageId).toBe('msg-1');
  });

  // ── Multi-agent dispatch ─────────────────────────────────────────────────

  it('stacks multiple delegation entries for the same message', () => {
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, dispatchFrame({
      task_id: 'task-a', display_name: 'Agent A', created_at: '2026-07-31T00:00:00Z',
    }));
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, dispatchFrame({
      task_id: 'task-b', display_name: 'Agent B', created_at: '2026-07-31T00:00:01Z',
    }));
    const entries = store.getEntriesByMessage('msg-1');
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.displayName)).toEqual(['Agent A', 'Agent B']);
  });

  it('upserts in place when a second dispatch arrives for the same task', () => {
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, dispatchFrame({
      task_id: 'task-1', display_name: 'Old Name', created_at: '2026-07-31T00:00:00Z',
    }));
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, dispatchFrame({
      task_id: 'task-1', display_name: 'New Name', created_at: '2026-07-31T00:00:02Z',
    }));
    const entries = store.getEntriesByMessage('msg-1');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.displayName).toBe('New Name');
  });

  it('sorts entries by updatedAt then taskId for stable ordering', () => {
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, dispatchFrame({
      task_id: 'task-b', created_at: '2026-07-31T00:00:02Z',
    }));
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, dispatchFrame({
      task_id: 'task-a', created_at: '2026-07-31T00:00:02Z',
    }));
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, dispatchFrame({
      task_id: 'task-c', created_at: '2026-07-31T00:00:00Z',
    }));
    const ids = store.getEntriesByMessage('msg-1').map((e) => e.taskId);
    // Oldest first; ties broken by taskId asc.
    expect(ids).toEqual(['task-c', 'task-a', 'task-b']);
  });

  // ── Non-agent events ──────────────────────────────────────────────────────

  it('ignores non-agent event types', () => {
    store.handleEvent(HUB_EVENTS.MESSAGE_NEW, { task_id: 'task-1', trigger_message_id: 'msg-1' });
    store.handleEvent(HUB_EVENTS.TEAM_RUN_STARTED, { task_id: 'task-1' });
    expect(Object.keys(store.state.byTaskId)).toHaveLength(0);
  });

  it('ignores malformed payloads', () => {
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, null);
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, 'string');
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, undefined);
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, { /* no task_id */ trigger_message_id: 'msg-1' });
    expect(Object.keys(store.state.byTaskId)).toHaveLength(0);
  });

  // ── subscribe / reset ────────────────────────────────────────────────────

  it('notifies subscribers on state changes and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsub = store.subscribe(listener);
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, dispatchFrame());
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    store.handleEvent(HUB_EVENTS.AGENT_DONE, { task_id: 'task-1', created_at: 't1' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('isolates listener errors from the realtime path', () => {
    const exploding = vi.fn(() => { throw new Error('boom'); });
    const fine = vi.fn();
    store.subscribe(exploding);
    store.subscribe(fine);
    expect(() => store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, dispatchFrame())).not.toThrow();
    expect(fine).toHaveBeenCalled();
  });

  it('clears all entries on reset and notifies', () => {
    store.handleEvent(HUB_EVENTS.AGENT_DISPATCH, dispatchFrame());
    const listener = vi.fn();
    store.subscribe(listener);
    store.reset();
    expect(store.getEntriesByMessage('msg-1')).toHaveLength(0);
    expect(listener).toHaveBeenCalled();
  });
});
