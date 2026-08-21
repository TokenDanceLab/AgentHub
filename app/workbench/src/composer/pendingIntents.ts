import type { ComposerIntent } from '@shared/composer';

/**
 * Client-side pending dispatch queue (CF22 / composer streaming spike ②).
 *
 * When a streaming send hits the recoverable 409 `turn_in_progress` the Hub
 * message is already persisted (SendMessage is independent) — only the
 * agent-task dispatch was rejected. Instead of silently dropping the dispatch
 * opportunity, ConversationHost enqueues a "dispatch intent" here and retries
 * the dispatch (never the message) when the agent run reaches a terminal
 * state. This module holds the pure queue logic only; state ownership and the
 * redispatch call live in ConversationHost.
 */

export interface PendingDispatchIntent<Intent = ComposerIntent> {
  /**
   * Composer mention profile id of the dispatch target (@agent that carries
   * `dispatchRole !== 'context'`). Informational for the badge; the platform
   * resolves the Hub agent instance on redispatch.
   */
  agentId: string;
  /**
   * Hub message id of the already-sent message. This is the `intentId`
   * returned by `submitComposerIntent` and doubles as the retry trigger
   * message for `triggerAgentTask`.
   */
  messageId: string;
  /**
   * Number of redispatch attempts already made (0 = freshly enqueued).
   * The original submit is not counted — the retry budget is per redispatch.
   */
  attempt: number;
  /**
   * Full submit payload captured at enqueue time. Never re-sent as a message;
   * used to resolve the dispatch target and to rebuild Hub model params.
   */
  intent: Intent;
}

/**
 * Upper bound of redispatch attempts per intent. When a retry still returns
 * 409 at this count the intent is abandoned and the user is told to retrigger
 * manually (the message itself is already in the transcript).
 */
export const MAX_PENDING_DISPATCH_RETRIES = 3;

/**
 * Delay used for the "busy window may already be over" fallback flush
 * (enqueue while no run is reported active) — short enough to feel
 * automatic, long enough for the Hub task status to settle.
 */
export const PENDING_DISPATCH_RETRY_DELAY_MS = 1500;

/** Append a pending intent at the tail (FIFO). Dedupes by messageId. */
export function enqueuePendingIntent<Intent>(
  queue: PendingDispatchIntent<Intent>[],
  entry: PendingDispatchIntent<Intent>,
): PendingDispatchIntent<Intent>[] {
  if (queue.some((item) => item.messageId === entry.messageId)) return queue;
  return [...queue, entry];
}

/** Peek the head of the queue without mutating it. */
export function peekPendingIntent<Intent>(
  queue: PendingDispatchIntent<Intent>[],
): PendingDispatchIntent<Intent> | undefined {
  return queue.length > 0 ? queue[0] : undefined;
}

/** Remove an intent by messageId (identity of a dispatch entry). */
export function removePendingIntent<Intent>(
  queue: PendingDispatchIntent<Intent>[],
  entry: PendingDispatchIntent<Intent>,
): PendingDispatchIntent<Intent>[] {
  return queue.filter((item) => item.messageId !== entry.messageId);
}

export type PendingDispatchRetryOutcome = 'requeued' | 'abandoned';

/**
 * Record one failed redispatch (409 turn_in_progress) for the queue head.
 * Keeps the entry at the head (the whole queue waits for the head anyway) and
 * bumps the attempt counter. When the counter hits the retry budget the entry
 * is dropped and 'abandoned' is returned so the caller can surface a toast.
 */
export function markPendingIntentRetried<Intent>(
  queue: PendingDispatchIntent<Intent>[],
  entry: PendingDispatchIntent<Intent>,
): { queue: PendingDispatchIntent<Intent>[]; outcome: PendingDispatchRetryOutcome } {
  const nextAttempt = entry.attempt + 1;
  if (nextAttempt >= MAX_PENDING_DISPATCH_RETRIES) {
    return { queue: removePendingIntent(queue, entry), outcome: 'abandoned' };
  }
  return {
    queue: queue.map((item) =>
      item.messageId === entry.messageId ? { ...item, attempt: nextAttempt } : item,
    ),
    outcome: 'requeued',
  };
}
