// Shared incremental message resync for hubWS reconnect/gap recovery (#2101 G4-②).
//
// When hubWS detects a reconnect (auth.ok after prior auth) or a seq_id gap,
// platforms call `resyncMessagesAfterReconnect` with their queryClient and
// hubClient. The helper scans cached message queries for known sessions,
// extracts the max seq_id per session, and calls syncMessages(after_seq) to
// fetch only missed frames. Results are merged back into the cache via the
// existing query key so downstream consumers see a seamless update.
//
// Key family (#2252): transcripts are not cached under one shape on every
// platform, so the caller declares which family it writes with via
// `messageKeys`. The helper never matches a literal shape of its own — that
// hardcoded `['hub','threads',<id>,'messages']` matcher is exactly what made
// this module a silent no-op on Desktop (real key
// `['hub','sessions',<id>,'messages']`) and on Web (real key
// `['web-v4','hub-messages',<id>]`): `discoverCachedSessionIds` returned [],
// the per-session loop body never ran, so `syncMessages` was never called and
// `degraded`/`errors` never accumulated anything worth logging.
//
// Degradation: if no cached messages exist for a session (e.g. first load
// happened during disconnect), we cannot compute after_seq. In that case we
// invalidate the family root so the next render does a full refetch.
// This is logged as a degraded resync for observability.

import type { QueryClient } from '@tanstack/react-query';
import type { HubMessage } from './hubClientDomainTypes';
import { hubThreadsMessagesFamily, type HubMessagesKeyFamily } from '../stores/queryKeys';

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
  /**
   * Key family the calling platform actually stores transcripts under.
   * Defaults to the SSOT threads family (`hubQueryKeys.threads.messages`),
   * which is what Desktop caches. Web must pass its own
   * `webHubMessagesFamily` (`['web-v4','hub-messages',<sessionId>]`).
   */
  messageKeys?: HubMessagesKeyFamily;
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
 * Discover every session id whose transcript is currently cached under
 * `family`. The family owns both the scan prefix and the reverse matcher, so
 * a platform whose keys have a different arity or namespace is discovered too.
 */
function discoverCachedSessionIds(
  qc: QueryClient,
  family: HubMessagesKeyFamily,
): string[] {
  const cache = qc.getQueriesData({ queryKey: family.root });
  const ids = new Set<string>();
  for (const [key] of cache) {
    if (!Array.isArray(key)) continue;
    const sessionId = family.sessionIdOf(key);
    if (sessionId) ids.add(sessionId);
  }
  return Array.from(ids);
}

/**
 * Incremental message resync after hubWS reconnect or gap detection.
 * Scans cached message queries of the caller's key family, computes
 * per-session after_seq watermarks, and fetches missed frames via
 * syncMessages. Falls back to invalidating the whole family when no watermark
 * is available.
 *
 * Idempotent: syncMessages results are merged into existing cache entries;
 * duplicate messages are harmless because downstream consumers use UPSERT
 * semantics keyed on message id.
 */
export async function resyncMessagesAfterReconnect(
  opts: ResyncMessagesOptions,
): Promise<ResyncMessagesResult> {
  const { queryClient, hubClient, logger = console } = opts;
  const messageKeys = opts.messageKeys ?? hubThreadsMessagesFamily;
  const result: ResyncMessagesResult = { synced: [], degraded: [], errors: [] };

  const sessionIds = discoverCachedSessionIds(queryClient, messageKeys);

  for (const sessionId of sessionIds) {
    const messagesKey = messageKeys.of(sessionId);
    const cached = queryClient.getQueryData(messagesKey);
    const maxSeq = extractMaxSeq(cached);

    if (maxSeq < 0) {
      // No watermark — degrade to full invalidation of the transcript family.
      result.degraded.push(sessionId);
      logger.warn(
        `[hubMessagesResync] no cached watermark for session ${sessionId}; invalidating transcript family`,
      );
      void queryClient.invalidateQueries({ queryKey: messageKeys.root }).catch(() => {
        /* non-fatal */
      });
      continue;
    }

    try {
      const missed = await hubClient.syncMessages(sessionId, { after_seq: maxSeq });
      if (missed.length > 0) {
        // Merge into existing cache. We append and deduplicate by id so the
        // cache stays sorted-ish and idempotent.
        const existing = (queryClient.getQueryData(messagesKey) as HubMessage[] | undefined) ?? [];
        const seen = new Set(existing.map((m) => m.id));
        const merged = [...existing];
        for (const msg of missed) {
          if (!seen.has(msg.id)) {
            merged.push(msg);
            seen.add(msg.id);
          }
        }
        queryClient.setQueryData(messagesKey, merged);
      }
      result.synced.push(sessionId);
    } catch (err) {
      result.errors.push({ sessionId, error: err });
      logger.error(`[hubMessagesResync] syncMessages failed for ${sessionId}:`, err);
      // On error, fall back to invalidation so the next render recovers.
      void queryClient.invalidateQueries({ queryKey: messagesKey }).catch(() => {
        /* non-fatal */
      });
    }
  }

  return result;
}
