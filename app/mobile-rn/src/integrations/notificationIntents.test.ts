import { describe, expect, it } from 'vitest';

import { parseNotificationIntent } from './notificationIntents';

describe('AgentHub mobile notification intents', () => {
  it('maps thread notification data to a thread navigation target', () => {
    expect(
      parseNotificationIntent({
        intent: 'thread',
        threadId: 'thread-delicious233',
      }),
    ).toEqual({
      kind: 'navigate',
      payload: {
        kind: 'thread',
        threadId: 'thread-delicious233',
      },
      target: {
        screen: 'thread',
        threadId: 'thread-delicious233',
      },
    });
  });

  it('maps run notification data to a run navigation target', () => {
    expect(
      parseNotificationIntent({
        type: 'run',
        runId: 'run-tokendance-preview',
        threadId: 'thread-delicious233',
      }),
    ).toEqual({
      kind: 'navigate',
      payload: {
        kind: 'run',
        runId: 'run-tokendance-preview',
        threadId: 'thread-delicious233',
      },
      target: {
        screen: 'run',
        runId: 'run-tokendance-preview',
        threadId: 'thread-delicious233',
      },
    });
  });

  it('maps approval notification data to an approval navigation target', () => {
    expect(
      parseNotificationIntent({
        kind: 'approval',
        approvalId: 'approval-token-dance',
        runId: 'run-tokendance-preview',
        threadId: 'thread-delicious233',
      }),
    ).toEqual({
      kind: 'navigate',
      payload: {
        kind: 'approval',
        approvalId: 'approval-token-dance',
        runId: 'run-tokendance-preview',
        threadId: 'thread-delicious233',
      },
      target: {
        screen: 'approval',
        approvalId: 'approval-token-dance',
        runId: 'run-tokendance-preview',
        threadId: 'thread-delicious233',
      },
    });
  });

  it('maps activity notification data to an activity navigation target', () => {
    expect(
      parseNotificationIntent({
        screen: 'activity',
        activityId: 'activity-token-dance',
        runId: 'run-tokendance-preview',
      }),
    ).toEqual({
      kind: 'navigate',
      payload: {
        kind: 'activity',
        activityId: 'activity-token-dance',
        runId: 'run-tokendance-preview',
      },
      target: {
        screen: 'activity',
        activityId: 'activity-token-dance',
        runId: 'run-tokendance-preview',
      },
    });
  });

  it('ignores missing and unknown notification intent data', () => {
    expect(parseNotificationIntent(undefined)).toEqual({
      kind: 'ignore',
      reason: 'missing_data',
    });
    expect(parseNotificationIntent({ intent: 'tokenDanceStatus' })).toEqual({
      kind: 'ignore',
      reason: 'unknown_intent',
    });
  });

  it('returns typed errors for malformed known notification intents', () => {
    expect(parseNotificationIntent({ intent: 'thread' })).toEqual({
      kind: 'error',
      reason: 'missing_thread_id',
    });
    expect(parseNotificationIntent({ intent: 'run', runId: '   ' })).toEqual({
      kind: 'error',
      reason: 'missing_run_id',
    });
    expect(parseNotificationIntent({ intent: 'approval', approvalId: 233 })).toEqual({
      kind: 'error',
      reason: 'missing_approval_id',
    });
  });

  it('does not throw for malformed notification data from the native bridge', () => {
    expect(() => parseNotificationIntent('TokenDance')).not.toThrow();
    expect(() => parseNotificationIntent(null)).not.toThrow();
    expect(() => parseNotificationIntent({ intent: ['thread'], threadId: 'thread-delicious233' })).not.toThrow();
  });
});
