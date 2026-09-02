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
