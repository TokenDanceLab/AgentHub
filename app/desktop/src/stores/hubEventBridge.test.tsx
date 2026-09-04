// #2252 regression suite for the Desktop Hub WS → React Query bridge.
//
// Every assertion below derives the transcript cache key from the real
// `useHubMessages` hook instead of hardcoding a shape. That is the whole
// point of the suite: before #2252 the bridge invalidated
// `hubQueryKeys.threads.messages(id)` = ['hub','threads',<id>,'messages']
// while `useHubMessages` cached under ['hub','sessions',<id>,'messages'], so
// every peer-originated MESSAGE_* frame missed the cache and the Desktop
// transcript never refetched. A test that hardcoded either shape would have
// stayed green through the entire defect (that is exactly what
// useDesktopWorkbenchModel.test.tsx did for MESSAGE_NEW).
//
// The reconnect/gap cases assert `syncMessages` was actually called because
// `resyncMessagesAfterReconnect` discovered cached sessions by the threads
// shape only, which made #2101 G1/G4-② a silent no-op on Desktop.

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HUB_EVENTS } from '@shared/hubEvents';
import { hubQueryKeys } from '@shared/stores/queryKeys';
import type { HubMessage } from '@shared/hub/hubClientDomainTypes';
import type { HubWSGapPayload } from '@shared/hub/hubWS';
import { createHubClient } from '@/api/hubClient';
import { useHubMessages } from '@/api/sessionQueries';
import { createDesktopHubEventBridge, type DesktopHubWSLike } from './hubEventBridge';

vi.mock('@/api/hubClient', () => ({ createHubClient: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ getAccessToken: vi.fn(() => 'fixture-token') }));

type GapHandler = (payload: HubWSGapPayload) => void;

const SESSION_PROBE = '__key-shape-probe__';
const getMessages = vi.fn();

function makeMsg(id: string, sessionId: string, seq: number): HubMessage {
  return {
    id,
    session_id: sessionId,
    seq_id: seq,
    sender_type: 'user',
    sender_id: 'peer-1',
    content_type: 'text',
    content: `msg-${id}`,
  };
}

/**
 * Discover the query key shape `useHubMessages` really registers, then return
 * a builder that swaps in an arbitrary session id. No shape is hardcoded, so
 * this suite cannot be fooled by a key family that only exists in tests.
 */
function discoverRealMessagesKeyBuilder(): (sessionId: string) => unknown[] {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { unmount } = renderHook(() => useHubMessages(SESSION_PROBE, { enabled: false }), {
    wrapper,
  });
  const registered = queryClient.getQueryCache().findAll();
  const first = registered[0];
  if (!first) throw new Error('useHubMessages registered no query — cannot derive the real key');
  const shape = [...first.queryKey] as unknown[];
  expect(shape).toContain(SESSION_PROBE);
  unmount();
  queryClient.clear();
  return (sessionId: string) => shape.map((seg) => (seg === SESSION_PROBE ? sessionId : seg));
}

function createFakeHubWS() {
  const handlers = new Map<string, (payload: unknown) => void>();
  const gapHandlers = new Set<GapHandler>();
  const reconnectedHandlers = new Set<() => void>();
  const hubWS: DesktopHubWSLike = {
    on: (type, handler) => {
      handlers.set(type, handler);
      return () => {
        handlers.delete(type);
      };
    },
    onGap: (handler) => {
      gapHandlers.add(handler);
      return () => {
        gapHandlers.delete(handler);
      };
    },
    onReconnected: (handler) => {
      reconnectedHandlers.add(handler);
      return () => {
        reconnectedHandlers.delete(handler);
      };
    },
  };
  return {
    hubWS,
    emit: (type: string, payload: unknown) => {
      handlers.get(type)?.(payload);
    },
    gap: () => {
      for (const fn of [...gapHandlers]) fn({ lastSeq: 1, receivedSeq: 5, gapSize: 3 });
    },
    reconnect: () => {
      for (const fn of [...reconnectedHandlers]) fn();
    },
  };
}

describe('desktop hubEventBridge transcript cache wiring (#2252)', () => {
  let realMessagesKey: (sessionId: string) => unknown[];

  beforeAll(() => {
    vi.mocked(createHubClient).mockReturnValue({ getMessages } as never);
    realMessagesKey = discoverRealMessagesKeyBuilder();
  });

  beforeEach(() => {
    getMessages.mockResolvedValue([]);
  });

  it('caches the Desktop transcript under the SSOT threads messages key', () => {
    // The convergence assertion: the hook and hubQueryKeys must agree, which
    // is what makes the bridge's MESSAGE_* invalidations land at all.
    expect(realMessagesKey('sess-1')).toEqual(hubQueryKeys.threads.messages('sess-1'));
  });

  const peerFrames: Array<{ name: string; type: string }> = [
    { name: 'MESSAGE_NEW', type: HUB_EVENTS.MESSAGE_NEW },
    { name: 'MESSAGE_RECALL', type: HUB_EVENTS.MESSAGE_RECALL },
    { name: 'MESSAGE_REACTION_ADDED', type: HUB_EVENTS.MESSAGE_REACTION_ADDED },
    { name: 'MESSAGE_REACTION_REMOVED', type: HUB_EVENTS.MESSAGE_REACTION_REMOVED },
  ];

  for (const frame of peerFrames) {
    it(`invalidates the real transcript cache on a peer ${frame.name} frame`, () => {
      const queryClient = new QueryClient();
      const key = realMessagesKey('sess-peer');
      queryClient.setQueryData(key, [makeMsg('m1', 'sess-peer', 3)]);
      const fake = createFakeHubWS();
      const bridge = createDesktopHubEventBridge(fake.hubWS, queryClient);

      fake.emit(frame.type, {
        id: 'm2',
        message_id: 'm2',
        session_id: 'sess-peer',
        content_type: 'text',
        content: 'from peer',
      });

      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
      bridge.destroy();
    });
  }

  it('resyncs the real transcript cache after a reconnect (#2101 G4-②)', async () => {
    const queryClient = new QueryClient();
    const key = realMessagesKey('sess-reconnect');
    queryClient.setQueryData(key, [makeMsg('m1', 'sess-reconnect', 10)]);
    const syncMessages = vi.fn().mockResolvedValue([makeMsg('m2', 'sess-reconnect', 11)]);
    const fake = createFakeHubWS();
    const bridge = createDesktopHubEventBridge(fake.hubWS, queryClient, {
      hubClient: { syncMessages },
    });

    fake.reconnect();
    await vi.waitFor(() => expect(syncMessages).toHaveBeenCalledTimes(1));

    expect(syncMessages).toHaveBeenCalledWith('sess-reconnect', { after_seq: 10 });
    const cached = queryClient.getQueryData(key) as HubMessage[];
    expect(cached.map((m) => m.id)).toEqual(['m1', 'm2']);
    bridge.destroy();
  });

  it('resyncs the real transcript cache on a seq_id gap (#2101 G1)', async () => {
    const queryClient = new QueryClient();
    const key = realMessagesKey('sess-gap');
    queryClient.setQueryData(key, [makeMsg('m1', 'sess-gap', 20)]);
    const syncMessages = vi.fn().mockResolvedValue([]);
    const fake = createFakeHubWS();
    const bridge = createDesktopHubEventBridge(fake.hubWS, queryClient, {
      hubClient: { syncMessages },
    });

    fake.gap();
    await vi.waitFor(() => expect(syncMessages).toHaveBeenCalledTimes(1));

    expect(syncMessages).toHaveBeenCalledWith('sess-gap', { after_seq: 20 });
    bridge.destroy();
  });
});

// ── #2261: the session-list half of the bridge ──────────────────────────────
//
// Before this change five handlers invalidated `hubQueryKeys.threads.detail(id)`
// — a factory with 0 useQuery consumers — and four more invalidated it next to a
// key that already covered the same data. `invalidateQueries` matches by prefix,
// and `['hub','threads','detail',id]` is not a prefix of anything the shells
// actually cache, so all nine matched no cache entry: the user-visible case was
// MESSAGE_READ, whose own comment claimed "read receipts affect thread-level
// unread_count" while the unread badge stayed stale.
//
// The assertion chain here is deliberately two links, because a test that seeds a
// key it invented proves nothing (#2252's original lesson):
//   1. sessionQueries.test.tsx pins that the live `useHubSessions` hook registers
//      exactly `hubQueryKeys.threads.list`;
//   2. this suite pins that the bridge invalidates that same factory key.
// Together they mean the frame lands on the entry the UI really reads.
describe('desktop hubEventBridge session-list cache wiring (#2261)', () => {
  const listFrames: Array<{ name: string; type: string }> = [
    { name: 'MESSAGE_READ', type: HUB_EVENTS.MESSAGE_READ },
    { name: 'MESSAGE_NEW', type: HUB_EVENTS.MESSAGE_NEW },
    { name: 'SESSION_MEMBER_JOINED', type: HUB_EVENTS.SESSION_MEMBER_JOINED },
    { name: 'SESSION_MEMBER_LEFT', type: HUB_EVENTS.SESSION_MEMBER_LEFT },
    { name: 'SESSION_INFO_UPDATED', type: HUB_EVENTS.SESSION_INFO_UPDATED },
  ];

  for (const frame of listFrames) {
    it(`invalidates the real session-list cache on ${frame.name}`, () => {
      const queryClient = new QueryClient();
      const key = hubQueryKeys.threads.list;
      queryClient.setQueryData(key, []);
      const fake = createFakeHubWS();
      const bridge = createDesktopHubEventBridge(fake.hubWS, queryClient);

      fake.emit(frame.type, {
        session_id: 'sess-list',
        user_id: 'user-1',
        last_read_seq: 3,
      });

      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
      bridge.destroy();
    });
  }

  it('invalidates the real pins cache on MESSAGE_PIN', () => {
    const queryClient = new QueryClient();
    const key = hubQueryKeys.threads.pins('sess-pin');
    queryClient.setQueryData(key, []);
    const fake = createFakeHubWS();
    const bridge = createDesktopHubEventBridge(fake.hubWS, queryClient);

    fake.emit(HUB_EVENTS.MESSAGE_PIN, { session_id: 'sess-pin', message_id: 'm1' });

    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    bridge.destroy();
  });

  it('keeps the ghost thread-detail factory deleted (ADR-029: no factory without a consumer)', () => {
    // Reintroducing `detail` without a real thread-detail query is how nine
    // invalidations silently matched nothing; this fails the day it comes back.
    expect((hubQueryKeys.threads as Record<string, unknown>).detail).toBeUndefined();
    expect((hubQueryKeys.threads as Record<string, unknown>).all).toBeUndefined();
    expect(hubQueryKeys.threads.list).toEqual(['hub', 'threads', 'list']);
    // root stays a prefix of every threads key, so broad invalidation still works
    expect(hubQueryKeys.threads.list[0]).toBe(hubQueryKeys.threads.root[0]);
    expect(hubQueryKeys.threads.list[1]).toBe(hubQueryKeys.threads.root[1]);
  });
});

// ── #2261: contacts family ────────────────────────────────────────────────
//
// The live Desktop contacts query is pinned separately in
// hubQueries.contacts.test.tsx. These assertions verify that realtime frames
// hit that same key rather than a longer prefix or a key with no producer.
describe('desktop hubEventBridge contacts cache wiring (#2261)', () => {
  it.each([
    ['SESSION_CREATED', HUB_EVENTS.SESSION_CREATED],
    ['FRIEND_ACCEPTED', HUB_EVENTS.FRIEND_ACCEPTED],
  ])('invalidates the live contacts list on %s', (_name, type) => {
    const queryClient = new QueryClient();
    const key = hubQueryKeys.contacts.list;
    queryClient.setQueryData(key, []);
    const fake = createFakeHubWS();
    const bridge = createDesktopHubEventBridge(fake.hubWS, queryClient);

    fake.emit(type, {
      session_id: 'sess-contacts',
      user_id: 'peer-1',
      nickname: 'Peer',
    });

    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    bridge.destroy();
  });

  it('does not invalidate the contacts list for a pending friend request', () => {
    const queryClient = new QueryClient();
    const key = hubQueryKeys.contacts.list;
    queryClient.setQueryData(key, []);
    const fake = createFakeHubWS();
    const bridge = createDesktopHubEventBridge(fake.hubWS, queryClient);

    fake.emit(HUB_EVENTS.FRIEND_REQUEST, {
      user_id: 'peer-2',
      nickname: 'Pending Peer',
    });

    // A pending request is surfaced as a notification; it does not change the
    // accepted contacts collection and there is no friend-request query.
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
    bridge.destroy();
  });
});
