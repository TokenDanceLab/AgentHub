// Shared incremental message resync for hubWS reconnect/gap recovery (#2101 G4-②).
//
// When hubWS detects a reconnect (auth.ok after prior auth) or a seq_id gap,
// platforms call `resyncMessagesAfterReconnect` with their queryClient and
// hubClient. The helper scans cached message queries for known sessions,
// extracts the max seq_id per session, and calls syncMessages(after_seq) to
// fetch only missed frames. Results are merged back into the cache via the
// existing query key so downstream consumers see a seamless update.
//
// Degradation: if no cached messages exist for a session (e.g. first load
// happened during disconnect), we cannot compute after_seq. In that case we
// invalidate the entire threads family so the next render does a full refetch.
// This is logged as a degraded resync for observability.

import type { QueryClient } from '@tanstack/react-query';
import type { HubMessage } from './hubClientDomainTypes';
import { hubQueryKeys } from '../stores/queryKeys';

/** Minimal hubClient surface needed for message resync. */
export interface MessagesResyncHubClient {
  syncMessages: (
    sessionId: string,
    params?: { after_seq?: number; limit?: number },
  ) => Promise<HubMessage[]>;
}

export interface ResyncMessagesOptions {
  queryClient: QueryClient;
  hubClient: MessagesResyncHubClient;
  /** Optional logger override (defaults to console). */
  logger?: Pick<typeof console, 'warn' | 'error'>;
}

export interface ResyncMessagesResult {
  /** Sessions successfully resynced with after_seq. */
  synced: string[];
  /** Sessions that fell back to full invalidation (no cached watermark). */
  degraded: string[];
  /** Errors encountered per session (non-fatal; other sessions still proceed). */
  errors: Array<{ sessionId: string; error: unknown }>;
}

/**
 * Extract the max seq_id from a cached messages array. Returns -1 when the
 * cache entry is missing, empty, or contains no valid seq_id values.
 */
export function extractMaxSeq(cached: unknown): number {
  if (!Array.isArray(cached)) return -1;
  let max = -1;
  for (const item of cached) {
    if (
      item !== null &&
      typeof item === 'object' &&
      'seq_id' in item &&
      typeof (item as Record<string, unknown>).seq_id === 'number'
    ) {
      const seq = (item as Record<string, unknown>).seq_id as number;
      if (Number.isFinite(seq) && seq > max) {
        max = seq;
      }
    }
  }
  return max;
}

/**
 * Discover all session IDs currently cached under the threads.messages prefix.
 * Query keys follow the shape ['hub', 'threads', <sessionId>, 'messages'].
 */
function discoverCachedSessionIds(qc: QueryClient): string[] {
  const cache = qc.getQueriesData({ queryKey: hubQueryKeys.threads.root });
  const ids = new Set<string>();
  for (const [key] of cache) {
    // Match ['hub', 'threads', <sessionId>, 'messages']
    if (
      Array.isArray(key) &&
      key.length === 4 &&
      key[0] === 'hub' &&
      key[1] === 'threads' &&
      key[3] === 'messages' &&
      typeof key[2] === 'string'
    ) {
      ids.add(key[2]);
    }
  }
  return Array.from(ids);
}

/**
 * Incremental message resync after hubWS reconnect or gap detection.
 * Scans cached message queries, computes per-session after_seq watermarks,
 * and fetches missed frames via syncMessages. Falls back to full threads
 * invalidation when no watermark is available.
 *
 * Idempotent: syncMessages results are merged into existing cache entries;
 * duplicate messages are harmless because downstream consumers use UPSERT
 * semantics keyed on message id.
 */
export async function resyncMessagesAfterReconnect(
  opts: ResyncMessagesOptions,
): Promise<ResyncMessagesResult> {
  const { queryClient, hubClient, logger = console } = opts;
  const result: ResyncMessagesResult = { synced: [], degraded: [], errors: [] };

  const sessionIds = discoverCachedSessionIds(queryClient);

  for (const sessionId of sessionIds) {
    const cached = queryClient.getQueryData(hubQueryKeys.threads.messages(sessionId));
    const maxSeq = extractMaxSeq(cached);

    if (maxSeq < 0) {
      // No watermark — degrade to full invalidation of this session's threads.
      result.degraded.push(sessionId);
      logger.warn(
        `[hubMessagesResync] no cached watermark for session ${sessionId}; invalidating threads family`,
      );
      void queryClient.invalidateQueries({ queryKey: hubQueryKeys.threads.root }).catch(() => {
        /* non-fatal */
      });
      continue;
    }

    try {
      const missed = await hubClient.syncMessages(sessionId, { after_seq: maxSeq });
      if (missed.length > 0) {
        // Merge into existing cache. We append and deduplicate by id so the
        // cache stays sorted-ish and idempotent.
        const existing = (queryClient.getQueryData(hubQueryKeys.threads.messages(sessionId)) as HubMessage[] | undefined) ?? [];
        const seen = new Set(existing.map((m) => m.id));
        const merged = [...existing];
        for (const msg of missed) {
          if (!seen.has(msg.id)) {
            merged.push(msg);
            seen.add(msg.id);
          }
        }
        queryClient.setQueryData(hubQueryKeys.threads.messages(sessionId), merged);
      }
      result.synced.push(sessionId);
    } catch (err) {
      result.errors.push({ sessionId, error: err });
      logger.error(`[hubMessagesResync] syncMessages failed for ${sessionId}:`, err);
      // On error, fall back to invalidation so the next render recovers.
      void queryClient.invalidateQueries({ queryKey: hubQueryKeys.threads.messages(sessionId) }).catch(() => {
        /* non-fatal */
      });
    }
  }

  return result;
}
