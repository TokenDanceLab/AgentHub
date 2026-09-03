// #2252 regression suite for the Desktop Hub session/message query wrappers.
//
// Two things are pinned here:
//
// 1. Convergence — `useHubMessages` must register the SSOT key
//    (`hubQueryKeys.threads.messages`). The key is DERIVED from the hook
//    rather than hardcoded so the assertion cannot be satisfied by a shape
//    that only exists in tests (the failure mode that kept
//    hubMessagesResync.test.ts green while production was a 100% no-op).
//
// 2. No lost invalidation — the message-mutating wrappers only know a
//    messageId (recall/edit) or a set of *target* sessions (forward), so they
//    invalidate broadly. Before #2252 the broad `['hub','sessions']` prefix
//    also covered the transcript cache, because transcripts lived under that
//    same prefix. Moving transcripts to the threads family would silently
//    stop self-recall / self-edit / pin / unpin / forward from refreshing the
//    transcript — a worse symptom than the bug being fixed. These guards were
//    green before the key move and must stay green after it.

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { hubQueryKeys } from '@shared/stores/queryKeys';
import type { HubMessage } from '@shared/hub/hubClientDomainTypes';
import { createHubClient } from '@/api/hubClient';
import {
  useHubEditMessage,
  useHubForwardMessage,
  useHubMarkRead,
  useHubMessages,
  useHubPinMessage,
  useHubRecallMessage,
  useHubSendMessage,
  useHubSessions,
  useHubUnpinMessage,
} from './sessionQueries';

vi.mock('@/api/hubClient', () => ({ createHubClient: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ getAccessToken: vi.fn(() => 'fixture-token') }));

const SESSION_PROBE = '__key-shape-probe__';
/** Sessions-list prefix (`useHubSessions`) — not a transcript key. */
const SESSIONS_LIST_KEY = hubQueryKeys.threads.list;

const client = {
  listSessions: vi.fn(),
  getMessages: vi.fn(),
  sendMessage: vi.fn(),
  markRead: vi.fn(),
  recallMessage: vi.fn(),
  editMessage: vi.fn(),
  pinMessage: vi.fn(),
  unpinMessage: vi.fn(),
  forwardMessage: vi.fn(),
};

function makeMsg(id: string, sessionId: string, seq: number): HubMessage {
  return {
    id,
    session_id: sessionId,
    seq_id: seq,
    sender_type: 'user',
    sender_id: 'u1',
    content_type: 'text',
    content: `msg-${id}`,
  };
}

function deriveRealMessagesKey(): (sessionId: string) => unknown[] {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { unmount } = renderHook(() => useHubMessages(SESSION_PROBE, { enabled: false }), {
    wrapper,
  });
  const first = queryClient.getQueryCache().findAll()[0];
  if (!first) throw new Error('useHubMessages registered no query — cannot derive the real key');
  const shape = [...first.queryKey] as unknown[];
  expect(shape).toContain(SESSION_PROBE);
  unmount();
  queryClient.clear();
  return (sessionId: string) => shape.map((seg) => (seg === SESSION_PROBE ? sessionId : seg));
}

/** Mount every message-mutating wrapper against one fresh cache. */
function mountMutations() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => ({
      send: useHubSendMessage(),
      markRead: useHubMarkRead(),
      recall: useHubRecallMessage(),
      edit: useHubEditMessage(),
      pin: useHubPinMessage(),
      unpin: useHubUnpinMessage(),
      forward: useHubForwardMessage(),
    }),
    { wrapper },
  );
  return { queryClient, mutations: hook.result.current, unmount: hook.unmount };
}

describe('desktop sessionQueries message cache keys (#2252)', () => {
  let realMessagesKey: (sessionId: string) => unknown[];

  beforeAll(() => {
    vi.mocked(createHubClient).mockReturnValue(client as never);
    for (const fn of Object.values(client)) fn.mockResolvedValue([]);
    realMessagesKey = deriveRealMessagesKey();
  });

  it('registers useHubMessages under the SSOT threads messages key', () => {
    expect(realMessagesKey('sess-1')).toEqual(hubQueryKeys.threads.messages('sess-1'));
  });

  it('keeps the sessions list on its own prefix (not a transcript key)', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { unmount } = renderHook(() => useHubSessions({ enabled: false }), { wrapper });
    const first = queryClient.getQueryCache().findAll()[0];
    expect(first?.queryKey).toEqual(SESSIONS_LIST_KEY);
    unmount();
  });

  it('invalidates the transcript of the sent-to session after sendMessage', async () => {
    client.sendMessage.mockResolvedValue({ message_id: 'm1', seq_id: 1, created_at: 'now' });
    const { queryClient, mutations, unmount } = mountMutations();
    const key = realMessagesKey('sess-send');
    queryClient.setQueryData(key, [makeMsg('m0', 'sess-send', 1)]);

    await act(async () => {
      await mutations.send.mutateAsync({
        sessionId: 'sess-send',
        data: { client_msg_id: 'c1', content_type: 'text', content: 'hi' },
      });
    });

    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    unmount();
  });

  // Broad-invalidating wrappers: they cannot build a per-session transcript
  // key, so they must cover the whole transcript family.
  const broadCases: Array<{
    name: string;
    run: (m: ReturnType<typeof mountMutations>['mutations']) => Promise<unknown>;
  }> = [
    { name: 'recallMessage', run: (m) => m.recall.mutateAsync('msg-1') },
    { name: 'editMessage', run: (m) => m.edit.mutateAsync({ messageId: 'msg-1', data: { content: 'edited' } }) },
    { name: 'pinMessage', run: (m) => m.pin.mutateAsync({ messageId: 'msg-1', sessionId: 'sess-1' }) },
    { name: 'unpinMessage', run: (m) => m.unpin.mutateAsync({ messageId: 'msg-1', sessionId: 'sess-1' }) },
    { name: 'markRead', run: (m) => m.markRead.mutateAsync({ sessionId: 'sess-1', lastReadSeq: 9 }) },
    { name: 'forwardMessage', run: (m) => m.forward.mutateAsync({ messageId: 'msg-1', targetSessionIds: ['sess-other'] }) },
  ];

  for (const testCase of broadCases) {
    it(`${testCase.name} still refreshes the transcript and the sessions list`, async () => {
      const { queryClient, mutations, unmount } = mountMutations();
      // A transcript the user is NOT looking at must still be marked stale so
      // the next open refetches (forward writes into other sessions).
      const key = realMessagesKey('sess-other');
      queryClient.setQueryData(key, [makeMsg('m1', 'sess-other', 4)]);
      queryClient.setQueryData(SESSIONS_LIST_KEY, []);

      await act(async () => {
        await testCase.run(mutations);
      });

      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(SESSIONS_LIST_KEY)?.isInvalidated).toBe(true);
      unmount();
    });
  }
});
