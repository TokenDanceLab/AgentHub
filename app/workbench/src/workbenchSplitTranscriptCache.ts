/* ==========================================================================
   workbenchSplitTranscriptCache — per-conversation transcript snapshots for
   the read-only split panes (#1997, UX F3).

   The shell feeds the workbench exactly ONE transcript (the active
   conversation). Split view needs the last-seen content of inactive
   conversations, so while a conversation is active its transcript reference
   is snapshotted into a small bounded cache. Pure frontend state — no Hub
   protocol, no second state system.
   ========================================================================== */

import { useEffect, useState } from 'react';
import type { TranscriptBlock } from '@shared/transcript';

/** Bound the cache: a handful of inactive panes is the realistic maximum. */
const SPLIT_TRANSCRIPT_CACHE_LIMIT = 8;

/**
 * Snapshot the active conversation's transcript on every change. Returns a
 * stable map identity while nothing changes (identity-check on the stored
 * array keeps shell re-renders from churning the cache).
 */
export function useSplitTranscriptCache(
  activeConversationId: string | undefined,
  transcript: TranscriptBlock[],
): ReadonlyMap<string, TranscriptBlock[]> {
  const [cache, setCache] = useState<ReadonlyMap<string, TranscriptBlock[]>>(
    () => new Map<string, TranscriptBlock[]>(),
  );

  useEffect(() => {
    if (!activeConversationId || transcript.length === 0) return;
    setCache((current) => {
      if (current.get(activeConversationId) === transcript) return current;
      const next = new Map(current);
      next.set(activeConversationId, transcript);
      while (next.size > SPLIT_TRANSCRIPT_CACHE_LIMIT) {
        const oldest = next.keys().next();
        if (oldest.done) break;
        next.delete(oldest.value);
      }
      return next;
    });
  }, [activeConversationId, transcript]);

  return cache;
}
