import { describe, expect, it } from 'vitest';
import {
  enqueuePendingIntent,
  markPendingIntentRetried,
  MAX_PENDING_DISPATCH_RETRIES,
  peekPendingIntent,
  removePendingIntent,
  type PendingDispatchIntent,
} from './pendingIntents';

function entry(
  overrides: Partial<PendingDispatchIntent<unknown>> = {},
): PendingDispatchIntent<unknown> {
  return {
    agentId: 'builder',
    messageId: `msg-${Math.random()}`,
    attempt: 0,
    intent: { conversationId: 'team' },
    ...overrides,
  };
}

describe('pendingIntents queue', () => {
  it('enqueue appends at the tail (FIFO)', () => {
    const first = entry({ messageId: 'm1' });
    const second = entry({ messageId: 'm2' });
    const queue = enqueuePendingIntent([], first);
    const next = enqueuePendingIntent(queue, second);
    expect(next).toHaveLength(2);
    expect(peekPendingIntent(next)?.messageId).toBe('m1');
  });

  it('enqueue dedupes by messageId', () => {
    const first = entry({ messageId: 'm1' });
    const queue = enqueuePendingIntent([], first);
    const next = enqueuePendingIntent(queue, entry({ messageId: 'm1' }));
    expect(next).toBe(queue);
    expect(next).toHaveLength(1);
  });

  it('peek returns the head without mutating the queue', () => {
    const queue = [entry({ messageId: 'm1' }), entry({ messageId: 'm2' })];
    expect(peekPendingIntent(queue)?.messageId).toBe('m1');
    expect(queue).toHaveLength(2);
  });

  it('peek returns undefined for an empty queue', () => {
    expect(peekPendingIntent([])).toBeUndefined();
  });

  it('remove drops the entry by messageId regardless of position', () => {
    const queue = [entry({ messageId: 'm1' }), entry({ messageId: 'm2' }), entry({ messageId: 'm3' })];
    const second = queue[1];
    expect(second).toBeDefined();
    const next = removePendingIntent(queue, second as NonNullable<typeof second>);
    expect(next.map((item) => item.messageId)).toEqual(['m1', 'm3']);
  });

  it('retry bumps the attempt counter and keeps the entry at the head', () => {
    const queue = [entry({ messageId: 'm1', attempt: 0 }), entry({ messageId: 'm2' })];
    const head = peekPendingIntent(queue);
    expect(head).toBeDefined();
    const { queue: next, outcome } = markPendingIntentRetried(queue, head as NonNullable<typeof head>);
    expect(outcome).toBe('requeued');
    expect(next[0]?.messageId).toBe('m1');
    expect(next[0]?.attempt).toBe(1);
    expect(next).toHaveLength(2);
  });

  it('abandons the intent once the retry budget is exhausted', () => {
    const queue = [entry({ messageId: 'm1', attempt: MAX_PENDING_DISPATCH_RETRIES - 1 })];
    const head = peekPendingIntent(queue);
    expect(head).toBeDefined();
    const { queue: next, outcome } = markPendingIntentRetried(queue, head as NonNullable<typeof head>);
    expect(outcome).toBe('abandoned');
    expect(next).toHaveLength(0);
  });

  it('exactly MAX_PENDING_DISPATCH_RETRIES retries are allowed before abandon', () => {
    let queue = [entry({ messageId: 'm1', attempt: 0 })];
    const outcomes: string[] = [];
    for (let retry = 0; retry < MAX_PENDING_DISPATCH_RETRIES + 2; retry += 1) {
      const head = peekPendingIntent(queue);
      if (!head) break;
      const result = markPendingIntentRetried(queue, head);
      queue = result.queue;
      outcomes.push(result.outcome);
    }
    expect(outcomes).toHaveLength(MAX_PENDING_DISPATCH_RETRIES);
    expect(outcomes.slice(0, -1).every((outcome) => outcome === 'requeued')).toBe(true);
    expect(outcomes[outcomes.length - 1]).toBe('abandoned');
    expect(queue).toHaveLength(0);
  });
});
