// Pure-function contract for the client-side pending dispatch queue
// (#1965, UX F7; supersedes the CF22 badge-era semantics). The Hub message
// is already persisted before these rows exist; every operation is
// dispatch-only (never re-sends or edits the message) and only affects the
// NEXT dispatch, never the active run. Failed rows stay visible for manual
// action instead of disappearing silently.
import { describe, expect, it } from 'vitest';

import type { ComposerIntent, ComposerMention } from '@shared/composer';

import {
  describePendingIntent,
  enqueuePendingIntent,
  markPendingIntentDispatching,
  markPendingIntentFailed,
  markPendingIntentRetried,
  MAX_PENDING_DISPATCH_RETRIES,
  movePendingIntent,
  peekDispatchablePendingIntent,
  peekPendingIntent,
  PENDING_INTENT_PREVIEW_CHARS,
  removePendingIntent,
  retargetPendingIntent,
  retryPendingIntent,
  type PendingDispatchIntent,
} from './pendingIntents';

// ── Fixtures ──────────────────────────────────────────────────────────

function mention(id: string, role: 'context' | 'dispatch' = 'dispatch'): ComposerMention {
  return { id, label: `Agent ${id}`, dispatchRole: role };
}

function intent(text: string, mentions: ComposerMention[]): ComposerIntent {
  return {
    conversationId: 'team',
    text,
    mode: 'code',
    mentions,
    attachments: [],
    approvalMode: 'suggest',
  };
}

function entry(
  messageId: string,
  agentId = 'builder',
  overrides: Partial<PendingDispatchIntent<ComposerIntent>> = {},
): PendingDispatchIntent<ComposerIntent> {
  return {
    agentId,
    messageId,
    attempt: 0,
    status: 'queued',
    intent: intent(`text for ${messageId}`, [mention(agentId)]),
    ...overrides,
  };
}

// ── enqueue / peek / remove ───────────────────────────────────────────

describe('enqueuePendingIntent', () => {
  it('appends FIFO at the tail', () => {
    const queue = enqueuePendingIntent([entry('m-1')], entry('m-2'));
    expect(queue.map((item) => item.messageId)).toEqual(['m-1', 'm-2']);
  });

  it('ignores a duplicate persisted message id', () => {
    const queue = [entry('m-1')];
    const next = enqueuePendingIntent(queue, entry('m-1'));
    expect(next).toBe(queue);
  });
});

describe('peek helpers', () => {
  it('peekPendingIntent returns the head without mutating, failed rows included', () => {
    const queue = [entry('m-1', 'builder', { status: 'failed' }), entry('m-2')];
    expect(peekPendingIntent(queue)?.messageId).toBe('m-1');
    expect(queue).toHaveLength(2);
  });

  it('peekPendingIntent returns undefined for an empty queue', () => {
    expect(peekPendingIntent([])).toBeUndefined();
  });

  it('peekDispatchablePendingIntent skips failed rows but keeps retrying rows', () => {
    const queue = [
      entry('m-1', 'builder', { status: 'failed', failureReason: 'retry-exhausted' }),
      entry('m-2', 'builder', { status: 'retrying', attempt: 1 }),
      entry('m-3'),
    ];
    expect(peekDispatchablePendingIntent(queue)?.messageId).toBe('m-2');
  });

  it('failed rows never block later dispatchable work', () => {
    const queue = [entry('m-1', 'builder', { status: 'failed' }), entry('m-2')];
    expect(peekDispatchablePendingIntent(queue)?.messageId).toBe('m-2');
  });
});

describe('removePendingIntent', () => {
  it('removes only the dispatch intent, matched by message id', () => {
    const queue = [entry('m-1'), entry('m-2'), entry('m-3')];
    const next = removePendingIntent(queue, queue[1]!);
    expect(next.map((item) => item.messageId)).toEqual(['m-1', 'm-3']);
  });
});

// ── status transitions / retry budget ─────────────────────────────────

describe('markPendingIntentDispatching', () => {
  it('marks the row dispatching and clears any stale failure reason', () => {
    const queue = [entry('m-1', 'builder', { status: 'failed', failureReason: 'dispatch-error' })];
    const next = markPendingIntentDispatching(queue, queue[0]!);
    expect(next[0]).toMatchObject({ status: 'dispatching', failureReason: undefined });
  });
});

describe('markPendingIntentRetried', () => {
  it('requeues below the retry budget with an incremented attempt, head kept', () => {
    const queue = [entry('m-1'), entry('m-2')];
    const { queue: next, outcome } = markPendingIntentRetried(queue, queue[0]!);
    expect(outcome).toBe('requeued');
    expect(next[0]).toMatchObject({ messageId: 'm-1', attempt: 1, status: 'retrying', failureReason: undefined });
    expect(next).toHaveLength(2);
  });

  it('abandons at the retry budget but keeps the failed row visible', () => {
    const exhausted = entry('m-1', 'builder', { attempt: MAX_PENDING_DISPATCH_RETRIES - 1 });
    const { queue, outcome } = markPendingIntentRetried([exhausted], exhausted);
    expect(outcome).toBe('abandoned');
    // Contract: failed rows stay visible for manual retry — never dropped.
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      attempt: MAX_PENDING_DISPATCH_RETRIES,
      status: 'failed',
      failureReason: 'retry-exhausted',
    });
  });

  it('exactly MAX_PENDING_DISPATCH_RETRIES recoverable results then abandon', () => {
    let queue = [entry('m-1')];
    const outcomes: string[] = [];
    for (let retry = 0; retry < MAX_PENDING_DISPATCH_RETRIES + 2; retry += 1) {
      const head = peekDispatchablePendingIntent(queue);
      if (!head) break;
      const result = markPendingIntentRetried(queue, head);
      queue = result.queue;
      outcomes.push(result.outcome);
    }
    expect(outcomes).toHaveLength(MAX_PENDING_DISPATCH_RETRIES);
    expect(outcomes.slice(0, -1).every((outcome) => outcome === 'requeued')).toBe(true);
    expect(outcomes[outcomes.length - 1]).toBe('abandoned');
    // The abandoned row remains in the queue as a visible failed row.
    expect(queue).toHaveLength(1);
    expect(queue[0]?.status).toBe('failed');
  });
});

describe('markPendingIntentFailed', () => {
  it('keeps a non-recoverable dispatch error visible', () => {
    const next = markPendingIntentFailed([entry('m-1')], entry('m-1'));
    expect(next[0]).toMatchObject({ status: 'failed', failureReason: 'dispatch-error' });
  });
});

describe('retryPendingIntent', () => {
  it('resets only failed rows for a manual dispatch-only retry', () => {
    const queue = [
      entry('m-1', 'builder', { status: 'failed', failureReason: 'retry-exhausted', attempt: 3 }),
      entry('m-2'),
    ];
    const next = retryPendingIntent(queue, 'm-1');
    expect(next[0]).toMatchObject({ status: 'queued', attempt: 0, failureReason: undefined });
    // Healthy rows are untouched.
    expect(next[1]).toBe(queue[1]);
  });

  it('leaves non-failed rows unchanged', () => {
    const queue = [entry('m-1')];
    expect(retryPendingIntent(queue, 'm-1')).toBe(queue);
  });
});

// ── reorder (next-turn dispatch order) ────────────────────────────────

describe('movePendingIntent', () => {
  const three = () => [entry('m-1'), entry('m-2'), entry('m-3')];

  it('moves to the front (置顶)', () => {
    const next = movePendingIntent(three(), 'm-3', 'front');
    expect(next.map((item) => item.messageId)).toEqual(['m-3', 'm-1', 'm-2']);
  });

  it('moves up and down one slot', () => {
    expect(movePendingIntent(three(), 'm-3', 'up').map((item) => item.messageId))
      .toEqual(['m-1', 'm-3', 'm-2']);
    expect(movePendingIntent(three(), 'm-1', 'down').map((item) => item.messageId))
      .toEqual(['m-2', 'm-1', 'm-3']);
  });

  it('is a no-op at the list boundary', () => {
    const queue = three();
    expect(movePendingIntent(queue, 'm-1', 'up')).toBe(queue);
    expect(movePendingIntent(queue, 'm-3', 'down')).toBe(queue);
  });

  it('never reorders a dispatching row or swaps across one', () => {
    const queue = [
      entry('m-1', 'builder', { status: 'dispatching' }),
      entry('m-2'),
      entry('m-3'),
    ];
    // The in-flight row itself is immutable.
    expect(movePendingIntent(queue, 'm-1', 'down')).toBe(queue);
    // A queued row cannot jump across the in-flight row.
    expect(movePendingIntent(queue, 'm-3', 'front')).toBe(queue);
    expect(movePendingIntent(queue, 'm-2', 'up')).toBe(queue);
  });

  it('ignores unknown message ids', () => {
    const queue = three();
    expect(movePendingIntent(queue, 'missing', 'front')).toBe(queue);
  });
});

// ── retarget (next dispatch agent) ────────────────────────────────────

describe('retargetPendingIntent', () => {
  it('swaps the dispatch mention and agent id, keeping context mentions intact', () => {
    const queue = [{
      ...entry('m-1'),
      intent: intent('do it', [mention('docs', 'context'), mention('builder')]),
    }];
    const next = retargetPendingIntent(queue, 'm-1', mention('reviewer'));
    expect(next[0]?.agentId).toBe('reviewer');
    expect(next[0]?.intent.mentions.map((item) => `${item.id}:${item.dispatchRole}`))
      .toEqual(['docs:context', 'reviewer:dispatch']);
  });

  it('refuses context-role targets (context never dispatches)', () => {
    const queue = [entry('m-1')];
    expect(retargetPendingIntent(queue, 'm-1', mention('docs', 'context'))).toBe(queue);
  });

  it('ignores dispatching rows and same-agent retargets', () => {
    const dispatching = [entry('m-1', 'builder', { status: 'dispatching' })];
    expect(retargetPendingIntent(dispatching, 'm-1', mention('reviewer'))).toBe(dispatching);
    const same = [entry('m-1')];
    expect(retargetPendingIntent(same, 'm-1', mention('builder'))).toBe(same);
  });
});

// ── view model ────────────────────────────────────────────────────────

describe('describePendingIntent', () => {
  it('exposes order/target/text/status fields for the visible queue', () => {
    const view = describePendingIntent(entry('m-1', 'builder', { status: 'retrying', attempt: 2 }));
    expect(view).toMatchObject({
      messageId: 'm-1',
      agentId: 'builder',
      agentLabel: 'Agent builder',
      text: 'text for m-1',
      attempt: 2,
      status: 'retrying',
    });
  });

  it('truncates long previews with an ellipsis', () => {
    const long = '长'.repeat(PENDING_INTENT_PREVIEW_CHARS + 10);
    const view = describePendingIntent({
      ...entry('m-1'),
      intent: intent(long, [mention('builder')]),
    });
    expect(view.text.length).toBe(PENDING_INTENT_PREVIEW_CHARS + 1);
    expect(view.text.endsWith('…')).toBe(true);
  });

  it('falls back to the agent id when no dispatch mention label exists', () => {
    const view = describePendingIntent({
      ...entry('m-1', 'builder'),
      intent: intent('no mentions', []),
    });
    expect(view.agentLabel).toBe('builder');
  });

  it('propagates the failure reason for failed rows', () => {
    const view = describePendingIntent(
      entry('m-1', 'builder', { status: 'failed', failureReason: 'retry-exhausted' }),
    );
    expect(view.failureReason).toBe('retry-exhausted');
  });
});
