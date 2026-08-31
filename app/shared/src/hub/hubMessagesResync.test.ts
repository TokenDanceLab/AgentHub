import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { hubQueryKeys } from '../stores/queryKeys';
import type { HubMessage } from './hubClientDomainTypes';
import {
  extractMaxSeq,
  resyncMessagesAfterReconnect,
  type MessagesResyncHubClient,
} from './hubMessagesResync';

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

describe('extractMaxSeq', () => {
  it('returns -1 for non-array input', () => {
    expect(extractMaxSeq(null)).toBe(-1);
    expect(extractMaxSeq(undefined)).toBe(-1);
    expect(extractMaxSeq('not-array')).toBe(-1);
    expect(extractMaxSeq({})).toBe(-1);
  });

  it('returns -1 for empty array', () => {
    expect(extractMaxSeq([])).toBe(-1);
  });

  it('returns max seq_id from valid messages', () => {
    const msgs = [makeMsg('a', 's1', 5), makeMsg('b', 's1', 12), makeMsg('c', 's1', 8)];
    expect(extractMaxSeq(msgs)).toBe(12);
  });

  it('skips entries without numeric seq_id', () => {
    const mixed = [
      makeMsg('a', 's1', 3),
      { id: 'b', session_id: 's1' }, // no seq_id
      { id: 'c', session_id: 's1', seq_id: 'not-number' },
      makeMsg('d', 's1', 7),
    ];
    expect(extractMaxSeq(mixed)).toBe(7);
  });
});

describe('resyncMessagesAfterReconnect', () => {
  let qc: QueryClient;
  let hubClient: MessagesResyncHubClient & { syncMessages: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    qc = new QueryClient();
    hubClient = {
      syncMessages: vi.fn().mockResolvedValue([]),
    };
  });

  it('returns empty result when no sessions are cached', async () => {
    const result = await resyncMessagesAfterReconnect({ queryClient: qc, hubClient });
    expect(result.synced).toEqual([]);
    expect(result.degraded).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(hubClient.syncMessages).not.toHaveBeenCalled();
  });

  it('calls syncMessages with correct after_seq for cached session', async () => {
    const msgs = [makeMsg('m1', 'sess-1', 10), makeMsg('m2', 'sess-1', 20)];
    qc.setQueryData(hubQueryKeys.threads.messages('sess-1'), msgs);

    hubClient.syncMessages.mockResolvedValue([makeMsg('m3', 'sess-1', 25)]);

    const result = await resyncMessagesAfterReconnect({ queryClient: qc, hubClient });

    expect(hubClient.syncMessages).toHaveBeenCalledTimes(1);
    expect(hubClient.syncMessages).toHaveBeenCalledWith('sess-1', { after_seq: 20 });
    expect(result.synced).toEqual(['sess-1']);
    expect(result.degraded).toEqual([]);

    // Verify merged cache
    const cached = qc.getQueryData(hubQueryKeys.threads.messages('sess-1')) as HubMessage[];
    expect(cached.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('deduplicates messages already in cache', async () => {
    const msgs = [makeMsg('m1', 'sess-1', 10)];
    qc.setQueryData(hubQueryKeys.threads.messages('sess-1'), msgs);

    // Server returns same message again (idempotent)
    hubClient.syncMessages.mockResolvedValue([makeMsg('m1', 'sess-1', 10)]);

    await resyncMessagesAfterReconnect({ queryClient: qc, hubClient });

    const cached = qc.getQueryData(hubQueryKeys.threads.messages('sess-1')) as HubMessage[];
    expect(cached).toHaveLength(1);
    expect(cached[0].id).toBe('m1');
  });

  it('degrades to invalidation when no cached watermark exists', async () => {
    // Set a cache entry that is an empty array (no messages → no watermark)
    qc.setQueryData(hubQueryKeys.threads.messages('sess-empty'), []);

    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined as never);

    const result = await resyncMessagesAfterReconnect({ queryClient: qc, hubClient });

    expect(result.degraded).toEqual(['sess-empty']);
    expect(result.synced).toEqual([]);
    expect(hubClient.syncMessages).not.toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: hubQueryKeys.threads.root });
  });

  it('handles syncMessages error gracefully and falls back to invalidation', async () => {
    qc.setQueryData(hubQueryKeys.threads.messages('sess-err'), [makeMsg('m1', 'sess-err', 5)]);

    hubClient.syncMessages.mockRejectedValue(new Error('network'));
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined as never);
    const logger = { warn: vi.fn(), error: vi.fn() };

    const result = await resyncMessagesAfterReconnect({ queryClient: qc, hubClient, logger });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].sessionId).toBe('sess-err');
    expect(logger.error).toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: hubQueryKeys.threads.messages('sess-err'),
    });
  });

  it('processes multiple sessions independently', async () => {
    qc.setQueryData(hubQueryKeys.threads.messages('s1'), [makeMsg('a', 's1', 10)]);
    qc.setQueryData(hubQueryKeys.threads.messages('s2'), [makeMsg('b', 's2', 20)]);

    hubClient.syncMessages.mockResolvedValue([]);

    const result = await resyncMessagesAfterReconnect({ queryClient: qc, hubClient });

    expect(hubClient.syncMessages).toHaveBeenCalledTimes(2);
    expect(result.synced.sort()).toEqual(['s1', 's2']);
  });

  it('triggers only once per call (idempotent at call level)', async () => {
    qc.setQueryData(hubQueryKeys.threads.messages('s1'), [makeMsg('a', 's1', 10)]);
    hubClient.syncMessages.mockResolvedValue([]);

    await resyncMessagesAfterReconnect({ queryClient: qc, hubClient });
    await resyncMessagesAfterReconnect({ queryClient: qc, hubClient });

    // Two calls → two syncMessages invocations (each call is independent;
    // dedup is within a single call's merge step, not across calls).
    expect(hubClient.syncMessages).toHaveBeenCalledTimes(2);
  });
});
