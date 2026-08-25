import type { ComposerIntent, ComposerMention } from '@shared/composer';

/**
 * Client-side pending dispatch queue (CF22 / composer streaming spike ②,
 * visible queue + steer semantics #1965).
 *
 * The Hub message is already persisted before `turn_in_progress` is returned.
 * Queue entries therefore represent dispatch-only work: they never resend,
 * edit, recall, or delete the transcript message.
 *
 * AgentHub currently has no mid-run injection channel. Queue order and
 * retargeting apply to the NEXT dispatch after the active run reaches a
 * terminal state; they do not steer the run that is already executing.
 */

export type PendingDispatchStatus = 'queued' | 'dispatching' | 'retrying' | 'failed';

export interface PendingDispatchIntent<Intent = ComposerIntent> {
  /** Dispatch target agent profile id. */
  agentId: string;
  /** Hub id of the message that is already persisted in the transcript. */
  messageId: string;
  /** Number of dispatch-only retry attempts already made. */
  attempt: number;
  /** Visible queue state. Failed rows stay visible until retried or removed. */
  status: PendingDispatchStatus;
  /** Stable failure category for user-facing status copy (never raw errors). */
  failureReason?: 'retry-exhausted' | 'dispatch-error' | undefined;
  /** Captured dispatch payload. The message body is never re-sent. */
  intent: Intent;
}

export const MAX_PENDING_DISPATCH_RETRIES = 3;
export const PENDING_DISPATCH_RETRY_DELAY_MS = 1500;

/** Append at the tail (FIFO). Duplicate persisted message ids are ignored. */
export function enqueuePendingIntent<Intent>(
  queue: PendingDispatchIntent<Intent>[],
  entry: PendingDispatchIntent<Intent>,
): PendingDispatchIntent<Intent>[] {
  if (queue.some((item) => item.messageId === entry.messageId)) return queue;
  return [...queue, entry];
}

/** First row, including failed rows (view/order helper). */
export function peekPendingIntent<Intent>(
  queue: PendingDispatchIntent<Intent>[],
): PendingDispatchIntent<Intent> | undefined {
  return queue[0];
}

/** First entry eligible for the next dispatch; failed rows never block later work. */
export function peekDispatchablePendingIntent<Intent>(
  queue: PendingDispatchIntent<Intent>[],
): PendingDispatchIntent<Intent> | undefined {
  return queue.find((item) => item.status === 'queued' || item.status === 'retrying');
}

/** Remove one dispatch intent only. The persisted transcript message remains. */
export function removePendingIntent<Intent>(
  queue: PendingDispatchIntent<Intent>[],
  entry: PendingDispatchIntent<Intent>,
): PendingDispatchIntent<Intent>[] {
  return queue.filter((item) => item.messageId !== entry.messageId);
}

function replacePendingIntent<Intent>(
  queue: PendingDispatchIntent<Intent>[],
  messageId: string,
  replace: (entry: PendingDispatchIntent<Intent>) => PendingDispatchIntent<Intent>,
): PendingDispatchIntent<Intent>[] {
  const index = queue.findIndex((item) => item.messageId === messageId);
  if (index < 0) return queue;
  const entry = queue[index];
  if (!entry) return queue;
  const nextEntry = replace(entry);
  if (nextEntry === entry) return queue;
  const next = [...queue];
  next[index] = nextEntry;
  return next;
}

export function markPendingIntentDispatching<Intent>(
  queue: PendingDispatchIntent<Intent>[],
  entry: PendingDispatchIntent<Intent>,
): PendingDispatchIntent<Intent>[] {
  return replacePendingIntent(queue, entry.messageId, (current) => ({
    ...current,
    status: 'dispatching',
    failureReason: undefined,
  }));
}

/**
 * Record a recoverable `turn_in_progress` result. The row stays visible after
 * the retry budget is exhausted instead of disappearing silently.
 */
export function markPendingIntentRetried<Intent>(
  queue: PendingDispatchIntent<Intent>[],
  entry: PendingDispatchIntent<Intent>,
): { queue: PendingDispatchIntent<Intent>[]; outcome: 'requeued' | 'abandoned' } {
  const nextAttempt = entry.attempt + 1;
  const abandoned = nextAttempt >= MAX_PENDING_DISPATCH_RETRIES;
  return {
    queue: replacePendingIntent(queue, entry.messageId, (current) => ({
      ...current,
      attempt: nextAttempt,
      status: abandoned ? 'failed' : 'retrying',
      ...(abandoned
        ? { failureReason: 'retry-exhausted' as const }
        : { failureReason: undefined }),
    })),
    outcome: abandoned ? 'abandoned' : 'requeued',
  };
}

/** Keep a non-recoverable dispatch error visible for explicit manual action. */
export function markPendingIntentFailed<Intent>(
  queue: PendingDispatchIntent<Intent>[],
  entry: PendingDispatchIntent<Intent>,
): PendingDispatchIntent<Intent>[] {
  return replacePendingIntent(queue, entry.messageId, (current) => ({
    ...current,
    status: 'failed',
    failureReason: 'dispatch-error',
  }));
}

/** Manual retry resets only dispatch state; it never re-sends the message. */
export function retryPendingIntent<Intent>(
  queue: PendingDispatchIntent<Intent>[],
  messageId: string,
): PendingDispatchIntent<Intent>[] {
  return replacePendingIntent(queue, messageId, (entry) => {
    if (entry.status !== 'failed') return entry;
    return {
      ...entry,
      attempt: 0,
      status: 'queued',
      failureReason: undefined,
    };
  });
}

export type PendingIntentMove = 'front' | 'up' | 'down';

/**
 * Reorder NEXT-turn dispatch work. Dispatching rows are immutable because the
 * request has already crossed the platform boundary.
 */
export function movePendingIntent<Intent>(
  queue: PendingDispatchIntent<Intent>[],
  messageId: string,
  move: PendingIntentMove,
): PendingDispatchIntent<Intent>[] {
  const index = queue.findIndex((item) => item.messageId === messageId);
  if (index < 0) return queue;
  const entry = queue[index];
  if (!entry || entry.status === 'dispatching') return queue;
  const targetIndex = move === 'front' ? 0 : move === 'up' ? index - 1 : index + 1;
  if (targetIndex === index || targetIndex < 0 || targetIndex >= queue.length) return queue;
  if (queue[targetIndex]?.status === 'dispatching') return queue;
  const next = [...queue];
  next.splice(index, 1);
  next.splice(targetIndex, 0, entry);
  return next;
}

/** Change the agent target for the NEXT dispatch; context mentions stay intact. */
export function retargetPendingIntent<Intent extends ComposerIntent>(
  queue: PendingDispatchIntent<Intent>[],
  messageId: string,
  target: ComposerMention,
): PendingDispatchIntent<Intent>[] {
  if (target.dispatchRole === 'context') return queue;
  return replacePendingIntent(queue, messageId, (entry) => {
    if (entry.status === 'dispatching') return entry;
    const dispatchIndex = entry.intent.mentions.findIndex(
      (mention) => mention.dispatchRole !== 'context',
    );
    if (dispatchIndex < 0 || entry.agentId === target.id) return entry;
    const mentions = entry.intent.mentions.map((mention, index) =>
      index === dispatchIndex ? target : mention,
    );
    return {
      ...entry,
      agentId: target.id,
      intent: { ...entry.intent, mentions },
    };
  });
}

export const PENDING_INTENT_PREVIEW_CHARS = 80;

export interface PendingDispatchQueueItemView {
  messageId: string;
  agentId: string;
  agentLabel: string;
  text: string;
  attempt: number;
  status: PendingDispatchStatus;
  failureReason?: PendingDispatchIntent['failureReason'];
}

export function describePendingIntent<Intent extends ComposerIntent>(
  entry: PendingDispatchIntent<Intent>,
): PendingDispatchQueueItemView {
  const rawText = entry.intent.text.trim();
  const text = rawText.length > PENDING_INTENT_PREVIEW_CHARS
    ? `${rawText.slice(0, PENDING_INTENT_PREVIEW_CHARS)}…`
    : rawText;
  const dispatchMention = entry.intent.mentions.find(
    (mention) => mention.dispatchRole !== 'context',
  );
  return {
    messageId: entry.messageId,
    agentId: entry.agentId,
    agentLabel: dispatchMention?.label ?? entry.agentId,
    text,
    attempt: entry.attempt,
    status: entry.status,
    ...(entry.failureReason ? { failureReason: entry.failureReason } : {}),
  };
}
