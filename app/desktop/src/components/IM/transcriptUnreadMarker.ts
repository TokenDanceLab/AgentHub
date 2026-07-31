// IM transcript unread-marker derivation (T8 desktop IM path).
//
// Consumes the Hub session read watermark and the loaded message list to find
// the first unread message, whose transcript block id anchors the unread
// divider rendered by ChatView. No protocol changes: the watermark is the
// existing `unread_count` on HubSession, which the hub-server computes as
// `next_seq − last_read_seq` (floored at 0) — i.e. the exact number of
// messages after the current user's read watermark.

import { hubMessageBlockId, type HubMessageTranscriptInput } from '@shared/transcript';

export interface TranscriptUnreadMarker {
  /** Transcript block id of the first unread message — divider renders above it. */
  anchorBlockId: string;
  /** Unread message count visible in the loaded message window. */
  count: number;
  /** Seq of the last read message (the watermark) — drives the read-through hint. */
  readThroughSeq?: number;
}

/**
 * Derive the unread marker from the session's unread_count watermark.
 *
 * Semantics: the last `unreadCount` messages (by ascending seq) are unread.
 * The first unread message is the anchor; `readThroughSeq` is its seq − 1,
 * which equals the server watermark `last_read_seq` when the message window
 * is contiguous (deleted/filtered messages make it an approximation only).
 *
 * Returns undefined when there is nothing to mark (no messages, or the
 * watermark is already at the tip).
 */
export function computeTranscriptUnreadMarker(
  messages: HubMessageTranscriptInput[] | undefined,
  unreadCount: number | undefined,
): TranscriptUnreadMarker | undefined {
  if (!messages?.length || !unreadCount || unreadCount <= 0) return undefined;

  // Cap at the loaded window: if the watermark points beyond what was
  // fetched (e.g. a windowed query), every loaded message is unread.
  const unread = Math.min(unreadCount, messages.length);

  // Seq is the authoritative server order (monotonic with created_at).
  const sorted = [...messages].sort((a, b) => (a.seq_id ?? 0) - (b.seq_id ?? 0));
  const firstUnread = sorted[sorted.length - unread];
  if (!firstUnread) return undefined;

  const anchorBlockId = hubMessageBlockId(firstUnread);
  if (!anchorBlockId) return undefined;

  const seq = firstUnread.seq_id;
  return {
    anchorBlockId,
    count: unread,
    ...(seq != null && seq > 1 ? { readThroughSeq: seq - 1 } : {}),
  };
}
