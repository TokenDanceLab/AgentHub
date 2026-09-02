// #2252 regression suite: Web reconnect/gap message resync.
//
// Web caches transcripts under ['web-v4','hub-messages',<sessionId>] (SSOT:
// webPlatformMessageHelpers.hubMessagesQueryKey), but the shared
// `resyncMessagesAfterReconnect` discovered cached sessions by matching the
// 4-tuple ['hub','threads',<id>,'messages'] shape only. The two never met, so
// the #2101 G1/G4-② wiring below was a 100% no-op on Web: `discoverCachedSessionIds`
// returned [], the per-session loop body never ran, `syncMessages` was never
// called, and nothing was logged.
//
// The cache is seeded through the REAL exported key factory, not a literal, so
// this test tracks whatever shape Web actually renders from.

import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HUB_EVENTS } from '@shared/hubEvents';
import { createHubWS } from '@shared/hub/hubWS';
import type { Transport } from '@/api/transport';
import { createHubClient } from '@/api/hubClient';
import type { MessageResponse } from '@/api/hubClient';
import { useConnectionStore } from '@/stores/connectionStore';
import { hubMessagesQueryKey } from './webPlatformMessageHelpers';
import { useWebHubRealtime } from './webHubRealtime';

vi.mock('@/api/hubClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hubClient')>();
  return { ...actual, createHubClient: vi.fn() };
});

function makeMsg(id: string, sessionId: string, seq: number): MessageResponse {
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

/** Fake Transport that lets the test deliver raw frames to the real hubWS. */
function createFakeSocketTransport() {
  const messageHandlers = new Set<(data: unknown) => void>();
  const transport: Transport = {
    connect: vi.fn(),
    send: vi.fn(),
    close: () => {
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
    deliver: (frame: unknown) => {
      for (const handler of [...messageHandlers]) handler(frame);
    },
  };
}

describe('webHubRealtime reconnect resync (#2252)', () => {
  const syncMessages = vi.fn();

  beforeEach(() => {
    syncMessages.mockReset();
    syncMessages.mockResolvedValue([]);
    vi.mocked(createHubClient).mockReturnValue({ syncMessages } as never);
    useConnectionStore.getState().setConnected(false);
  });

  function mountRealtime(queryClient: QueryClient) {
    const fake = createFakeSocketTransport();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const hook = renderHook(
      () =>
        useWebHubRealtime({
          enabled: true,
          runtimeSessionId: 'hub-session-1',
          runtimeTaskId: 'task-1',
          createSocket: createHubWS,
          createTransport: () => fake.transport,
          getToken: () => 'fixture-token',
        }),
      { wrapper },
    );
    return { ...fake, unmount: () => act(() => hook.unmount()) };
  }

  it('calls syncMessages with the cached watermark after a reconnect auth', async () => {
    const queryClient = new QueryClient();
    // The real Web transcript cache for the active session, watermark seq 10.
    queryClient.setQueryData(hubMessagesQueryKey('hub-session-1'), [
      makeMsg('m1', 'hub-session-1', 4),
      makeMsg('m2', 'hub-session-1', 10),
    ]);
    syncMessages.mockResolvedValue([makeMsg('m3', 'hub-session-1', 11)]);
    const harness = mountRealtime(queryClient);

    act(() => {
      harness.deliver({ type: HUB_EVENTS.AUTH_OK, payload: null });
    });
    // First auth is not a reconnect — nothing must be resynced yet.
    expect(syncMessages).not.toHaveBeenCalled();

    act(() => {
      harness.deliver({ type: HUB_EVENTS.AUTH_OK, payload: null });
    });

    await waitFor(() => expect(syncMessages).toHaveBeenCalledTimes(1));
    expect(syncMessages).toHaveBeenCalledWith('hub-session-1', { after_seq: 10 });

    // Missed frames are merged back under the same real Web key.
    await waitFor(() => {
      const cached = queryClient.getQueryData(hubMessagesQueryKey('hub-session-1')) as MessageResponse[];
      expect(cached.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    });

    harness.unmount();
  });

  it('resyncs every cached Web session, not just the active one', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(hubMessagesQueryKey('hub-session-1'), [
      makeMsg('a1', 'hub-session-1', 7),
    ]);
    queryClient.setQueryData(hubMessagesQueryKey('hub-session-2'), [
      makeMsg('b1', 'hub-session-2', 3),
    ]);
    const harness = mountRealtime(queryClient);

    act(() => {
      harness.deliver({ type: HUB_EVENTS.AUTH_OK, payload: null });
      harness.deliver({ type: HUB_EVENTS.AUTH_OK, payload: null });
    });

    await waitFor(() => expect(syncMessages).toHaveBeenCalledTimes(2));
    const syncedSessions = syncMessages.mock.calls.map((call) => call[0]).sort();
    expect(syncedSessions).toEqual(['hub-session-1', 'hub-session-2']);

    harness.unmount();
  });
});
