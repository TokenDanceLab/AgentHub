import { afterEach, describe, expect, it } from 'vitest';
import { HUB_EVENTS } from '../hubEvents';
import type { HubMessageTranscriptInput } from './normalizeHubMessages';
import {
  createPinMapStore,
  getPinMapStore,
  withPinnedState,
  type PinMapStore,
} from './pinMap';

afterEach(() => {
  getPinMapStore().reset();
});

function pinFrame(messageId: string, sessionId: string) {
  return {
    type: HUB_EVENTS.MESSAGE_PIN,
    payload: {
      session_id: sessionId,
      message_id: messageId,
      pinned_by_user_id: 'u1',
      pinned_at: '2026-08-01T00:00:00Z',
    },
  };
}

function unpinFrame(messageId: string, sessionId: string) {
  return {
    type: HUB_EVENTS.MESSAGE_UNPIN,
    payload: { session_id: sessionId, message_id: messageId },
  };
}

describe('pinMap store', () => {
  it('no-ops setPinned without an active session (pre-seed frames are dropped)', () => {
    const store = createPinMapStore();
    store.setPinned('m1', true);
    expect(store.isPinned('m1')).toBe(false);
    expect(store.getSnapshot()).toEqual({ sessionId: null, pinnedIds: new Set() });
  });

  it('setPinned / isPinned read and write the active session bucket', () => {
    const store = createPinMapStore();
    store.loadPinnedForSession('s1', []);
    store.setPinned('m1', true);
    store.setPinned('m2', true);
    store.setPinned('m2', false); // toggling off removes the id

    expect(store.isPinned('m1')).toBe(true);
    expect(store.isPinned('m2')).toBe(false);
    expect(store.isPinned('unknown')).toBe(false);
    expect(store.getSnapshot()).toEqual({
      sessionId: 's1',
      pinnedIds: new Set(['m1']),
    });
  });

  it('isolates pin state per session and switches the active bucket on load', () => {
    const store = createPinMapStore();
    store.loadPinnedForSession('s1', ['a', 'b']);
    store.loadPinnedForSession('s2', ['c']);

    expect(store.isPinned('a')).toBe(false); // now on s2
    expect(store.isPinned('c')).toBe(true);
    expect(store.getSnapshot().sessionId).toBe('s2');

    // Switching back to s1 restores its seeded set without re-seeding.
    store.setActiveSession('s1');
    expect(store.isPinned('a')).toBe(true);
    expect(store.isPinned('c')).toBe(false);
  });

  it('loadPinnedForSession replaces the full seed set (server list is authoritative)', () => {
    const store = createPinMapStore();
    store.loadPinnedForSession('s1', ['a', 'b']);
    store.loadPinnedForSession('s1', ['b', 'c']); // refetch: a unpinned, c pinned

    expect(store.isPinned('a')).toBe(false);
    expect(store.isPinned('b')).toBe(true);
    expect(store.isPinned('c')).toBe(true);
  });

  it('handleFrame feeds MESSAGE_PIN / MESSAGE_UNPIN frames into the active bucket', () => {
    const store = createPinMapStore();
    store.loadPinnedForSession('s1', []);

    store.handleFrame(HUB_EVENTS.MESSAGE_PIN, pinFrame('m1', 's1').payload);
    expect(store.isPinned('m1')).toBe(true);

    store.handleFrame(HUB_EVENTS.MESSAGE_UNPIN, unpinFrame('m1', 's1').payload);
    expect(store.isPinned('m1')).toBe(false);

    // Session-less or malformed frames are ignored.
    store.handleFrame(HUB_EVENTS.MESSAGE_PIN, { message_id: 'm2' });
    store.handleFrame(HUB_EVENTS.MESSAGE_PIN, { session_id: 's1' });
    expect(store.isPinned('m2')).toBe(false);

    // Non-pin frame types are ignored.
    store.handleFrame(HUB_EVENTS.MESSAGE_NEW, { session_id: 's1', message_id: 'm9' });
    expect(store.isPinned('m9')).toBe(false);
  });

  it('handleFrame drops frames from non-active sessions when a filter is given', () => {
    const store = createPinMapStore();
    store.loadPinnedForSession('s1', []);

    // Web passes the active runtime session id: foreign-session frames are dropped.
    store.handleFrame(HUB_EVENTS.MESSAGE_PIN, pinFrame('m1', 'other-session').payload, 's1');
    expect(store.isPinned('m1')).toBe(false);

    store.handleFrame(HUB_EVENTS.MESSAGE_PIN, pinFrame('m2', 's1').payload, 's1');
    expect(store.isPinned('m2')).toBe(true);
  });

  it('subscribes and notifies only on actual changes; unsubscribe stops notifications', () => {
    const store = createPinMapStore();
    store.loadPinnedForSession('s1', []);
    let notifications = 0;
    const unsubscribe = store.subscribe(() => { notifications += 1; });

    store.setPinned('m1', true);
    store.setPinned('m1', true); // idempotent — no notification
    expect(notifications).toBe(1);

    unsubscribe();
    store.setPinned('m2', true);
    expect(notifications).toBe(1);
  });

  it('getSnapshot keeps a stable reference until the next mutation', () => {
    const store = createPinMapStore();
    store.loadPinnedForSession('s1', []);
    const snapshotA = store.getSnapshot();
    const snapshotB = store.getSnapshot();
    expect(snapshotA).toBe(snapshotB);

    store.setPinned('m1', true);
    const snapshotC = store.getSnapshot();
    expect(snapshotC).not.toBe(snapshotA);
    expect(snapshotC.pinnedIds.has('m1')).toBe(true);
    // Snapshot is a copy — mutating the store never mutates an old snapshot.
    expect(snapshotA.pinnedIds.has('m1')).toBe(false);
  });

  it('reset clears all sessions and the active pointer', () => {
    const store = createPinMapStore();
    store.loadPinnedForSession('s1', ['a']);
    store.reset();

    expect(store.getSnapshot()).toEqual({ sessionId: null, pinnedIds: new Set() });
    expect(store.isPinned('a')).toBe(false);
    // Post-reset frames are dropped until the next seed.
    store.handleFrame(HUB_EVENTS.MESSAGE_PIN, pinFrame('a', 's1').payload, 's1');
    expect(store.isPinned('a')).toBe(false);
  });

  it('singleton getter returns a shared store', () => {
    const a = getPinMapStore();
    const b = getPinMapStore();
    expect(a).toBe(b);
    a.loadPinnedForSession('s1', ['x']);
    expect(b.isPinned('x')).toBe(true);
  });
});

describe('withPinnedState', () => {
  const base: HubMessageTranscriptInput[] = [
    { id: 'm1', session_id: 's1', seq_id: 1, sender_type: 'user', content: { text: 'hi' } },
    { id: 'm2', session_id: 's1', seq_id: 2, sender_type: 'user', content: { text: 'yo' } },
  ];

  it('merges pinned flags in by server message id', () => {
    const merged = withPinnedState(base, new Set(['m1']));
    expect(merged?.[0]).toEqual({ ...base[0], pinned: true });
    expect(merged?.[1]).toBe(base[1]); // unpinned message keeps its reference
  });

  it('does not touch messages already carrying pinned: true', () => {
    const withFlag: HubMessageTranscriptInput[] = [{ ...base[0]!, pinned: true }, base[1]!];
    const merged = withPinnedState(withFlag, new Set(['m1']));
    expect(merged?.[0]).toBe(withFlag[0]); // reference preserved
  });

  it('only writes pinned: true — absent/false keeps the field unset', () => {
    const merged = withPinnedState(base, new Set([]));
    expect(merged).toBe(base); // empty set returns the original array
    expect('pinned' in (merged?.[0] ?? {})).toBe(false);
  });

  it('does not match client_msg_id (client-side id is a different namespace)', () => {
    const withClientId = [{ ...base[0], client_msg_id: 'client-1' }];
    const merged = withPinnedState(withClientId, new Set(['client-1']));
    expect(merged?.[0]).toBe(withClientId[0]);
  });

  it('falls back to message_id when id is absent', () => {
    const input = [{ message_id: 'm7', session_id: 's1', seq_id: 3, sender_type: 'user', content: { text: 'x' } }];
    const merged = withPinnedState(input, new Set(['m7']));
    expect(merged?.[0]).toEqual({ ...input[0], pinned: true });
  });

  it('handles undefined input', () => {
    expect(withPinnedState(undefined, new Set(['m1']))).toBeUndefined();
  });
});
