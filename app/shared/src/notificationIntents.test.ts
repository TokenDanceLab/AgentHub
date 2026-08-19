// real_tested=true
import { describe, expect, it } from 'vitest';
import {
  mapNotificationIntentToNavigationTarget,
  parseNotificationIntent,
  parseNotificationIntentPayload,
} from './notificationIntents';

describe('parseNotificationIntentPayload', () => {
  describe('nullish / invalid data', () => {
    it('ignores null as missing_data', () => {
      expect(parseNotificationIntentPayload(null)).toEqual({
        kind: 'ignore',
        reason: 'missing_data',
      });
    });

    it('ignores undefined as missing_data', () => {
      expect(parseNotificationIntentPayload(undefined)).toEqual({
        kind: 'ignore',
        reason: 'missing_data',
      });
    });

    it('rejects strings as invalid_data', () => {
      expect(parseNotificationIntentPayload('thread')).toEqual({
        kind: 'error',
        reason: 'invalid_data',
      });
    });

    it('rejects numbers as invalid_data', () => {
      expect(parseNotificationIntentPayload(42)).toEqual({
        kind: 'error',
        reason: 'invalid_data',
      });
    });

    it('rejects booleans as invalid_data', () => {
      expect(parseNotificationIntentPayload(true)).toEqual({
        kind: 'error',
        reason: 'invalid_data',
      });
    });

    it('rejects arrays as invalid_data', () => {
      expect(parseNotificationIntentPayload([{ intent: 'thread' }])).toEqual({
        kind: 'error',
        reason: 'invalid_data',
      });
    });
  });

  describe('intent detection', () => {
    it('ignores an empty record as unknown_intent', () => {
      expect(parseNotificationIntentPayload({})).toEqual({
        kind: 'ignore',
        reason: 'unknown_intent',
      });
    });

    it('ignores records whose intent value is not a recognized string', () => {
      expect(parseNotificationIntentPayload({ intent: 'message' })).toEqual({
        kind: 'ignore',
        reason: 'unknown_intent',
      });
    });

    it('ignores a non-string intent value', () => {
      expect(parseNotificationIntentPayload({ intent: 42 })).toEqual({
        kind: 'ignore',
        reason: 'unknown_intent',
      });
    });

    it('normalizes intent case-insensitively', () => {
      expect(parseNotificationIntentPayload({ intent: 'Thread', threadId: 't-1' })).toEqual({
        kind: 'payload',
        value: { kind: 'thread', threadId: 't-1' },
      });
    });

    it('trims whitespace around the intent value', () => {
      expect(parseNotificationIntentPayload({ intent: '  thread  ', threadId: 't-1' })).toEqual({
        kind: 'payload',
        value: { kind: 'thread', threadId: 't-1' },
      });
    });

    it('ignores an empty-string intent value', () => {
      expect(parseNotificationIntentPayload({ intent: '', threadId: 't-1' })).toEqual({
        kind: 'ignore',
        reason: 'unknown_intent',
      });
    });

    it('reads the intent from any of the fallback fields', () => {
      expect(parseNotificationIntentPayload({ type: 'thread', threadId: 't-1' })).toEqual({
        kind: 'payload',
        value: { kind: 'thread', threadId: 't-1' },
      });
      expect(parseNotificationIntentPayload({ kind: 'run', runId: 'r-1' })).toEqual({
        kind: 'payload',
        value: { kind: 'run', runId: 'r-1' },
      });
      expect(parseNotificationIntentPayload({ screen: 'approval', approvalId: 'a-1' })).toEqual({
        kind: 'payload',
        value: { kind: 'approval', approvalId: 'a-1' },
      });
      expect(parseNotificationIntentPayload({ target: 'activity' })).toEqual({
        kind: 'payload',
        value: { kind: 'activity' },
      });
    });

    it('prefers the earlier intent field when several are present', () => {
      expect(
        parseNotificationIntentPayload({
          intent: 'thread',
          type: 'run',
          kind: 'approval',
          screen: 'activity',
          threadId: 't-1',
        }),
      ).toEqual({
        kind: 'payload',
        value: { kind: 'thread', threadId: 't-1' },
      });
    });

    it('skips an invalid intent field and falls through to the next', () => {
      expect(
        parseNotificationIntentPayload({ intent: 'nonsense', type: 'run', runId: 'r-1' }),
      ).toEqual({
        kind: 'payload',
        value: { kind: 'run', runId: 'r-1' },
      });
    });

    it('ignores an empty-string value in one intent field in favor of the next', () => {
      expect(
        parseNotificationIntentPayload({ intent: '   ', kind: 'thread', threadId: 't-1' }),
      ).toEqual({
        kind: 'payload',
        value: { kind: 'thread', threadId: 't-1' },
      });
    });
  });

  describe('thread intent', () => {
    it('parses a thread payload with its threadId', () => {
      expect(parseNotificationIntentPayload({ intent: 'thread', threadId: 't-1' })).toEqual({
        kind: 'payload',
        value: { kind: 'thread', threadId: 't-1' },
      });
    });

    it('accepts the plural alias "threads"', () => {
      expect(parseNotificationIntentPayload({ intent: 'threads', threadId: 't-2' })).toEqual({
        kind: 'payload',
        value: { kind: 'thread', threadId: 't-2' },
      });
    });

    it('errors when threadId is missing', () => {
      expect(parseNotificationIntentPayload({ intent: 'thread' })).toEqual({
        kind: 'error',
        reason: 'missing_thread_id',
      });
    });

    it('errors when threadId is empty or whitespace-only', () => {
      expect(parseNotificationIntentPayload({ intent: 'thread', threadId: '' })).toEqual({
        kind: 'error',
        reason: 'missing_thread_id',
      });
      expect(parseNotificationIntentPayload({ intent: 'thread', threadId: '   ' })).toEqual({
        kind: 'error',
        reason: 'missing_thread_id',
      });
    });

    it('errors when threadId is a non-string value', () => {
      expect(parseNotificationIntentPayload({ intent: 'thread', threadId: 7 })).toEqual({
        kind: 'error',
        reason: 'missing_thread_id',
      });
    });

    it('trims the threadId value', () => {
      expect(parseNotificationIntentPayload({ intent: 'thread', threadId: '  t-1  ' })).toEqual({
        kind: 'payload',
        value: { kind: 'thread', threadId: 't-1' },
      });
    });

    it('drops unrelated extra fields from the payload', () => {
      expect(
        parseNotificationIntentPayload({
          intent: 'thread',
          threadId: 't-1',
          runId: 'r-1',
          approvalId: 'a-1',
        }),
      ).toEqual({
        kind: 'payload',
        value: { kind: 'thread', threadId: 't-1' },
      });
    });
  });

  describe('run intent', () => {
    it('parses a run payload with only its runId', () => {
      expect(parseNotificationIntentPayload({ intent: 'run', runId: 'r-1' })).toEqual({
        kind: 'payload',
        value: { kind: 'run', runId: 'r-1' },
      });
    });

    it('parses a run payload with an optional threadId', () => {
      expect(
        parseNotificationIntentPayload({ intent: 'run', runId: 'r-1', threadId: 't-1' }),
      ).toEqual({
        kind: 'payload',
        value: { kind: 'run', runId: 'r-1', threadId: 't-1' },
      });
    });

    it('accepts the plural alias "runs"', () => {
      expect(parseNotificationIntentPayload({ intent: 'runs', runId: 'r-2' })).toEqual({
        kind: 'payload',
        value: { kind: 'run', runId: 'r-2' },
      });
    });

    it('errors when runId is missing', () => {
      expect(parseNotificationIntentPayload({ intent: 'run' })).toEqual({
        kind: 'error',
        reason: 'missing_run_id',
      });
    });

    it('errors when runId is a non-string value', () => {
      expect(parseNotificationIntentPayload({ intent: 'run', runId: null })).toEqual({
        kind: 'error',
        reason: 'missing_run_id',
      });
    });

    it('omits threadId when it is empty or non-string', () => {
      expect(
        parseNotificationIntentPayload({ intent: 'run', runId: 'r-1', threadId: '' }),
      ).toEqual({
        kind: 'payload',
        value: { kind: 'run', runId: 'r-1' },
      });
      expect(
        parseNotificationIntentPayload({ intent: 'run', runId: 'r-1', threadId: 123 }),
      ).toEqual({
        kind: 'payload',
        value: { kind: 'run', runId: 'r-1' },
      });
    });
  });

  describe('approval intent', () => {
    it('parses an approval payload with only its approvalId', () => {
      expect(parseNotificationIntentPayload({ intent: 'approval', approvalId: 'a-1' })).toEqual({
        kind: 'payload',
        value: { kind: 'approval', approvalId: 'a-1' },
      });
    });

    it('parses an approval payload with optional runId and threadId', () => {
      expect(
        parseNotificationIntentPayload({
          intent: 'approval',
          approvalId: 'a-1',
          runId: 'r-1',
          threadId: 't-1',
        }),
      ).toEqual({
        kind: 'payload',
        value: { kind: 'approval', approvalId: 'a-1', runId: 'r-1', threadId: 't-1' },
      });
    });

    it('accepts the "approvals" alias', () => {
      expect(parseNotificationIntentPayload({ intent: 'approvals', approvalId: 'a-2' })).toEqual({
        kind: 'payload',
        value: { kind: 'approval', approvalId: 'a-2' },
      });
    });

    it('accepts the "approval_required" alias', () => {
      expect(
        parseNotificationIntentPayload({ intent: 'approval_required', approvalId: 'a-3' }),
      ).toEqual({
        kind: 'payload',
        value: { kind: 'approval', approvalId: 'a-3' },
      });
    });

    it('errors when approvalId is missing', () => {
      expect(parseNotificationIntentPayload({ intent: 'approval' })).toEqual({
        kind: 'error',
        reason: 'missing_approval_id',
      });
    });

    it('errors when approvalId is whitespace-only', () => {
      expect(parseNotificationIntentPayload({ intent: 'approval', approvalId: '  ' })).toEqual({
        kind: 'error',
        reason: 'missing_approval_id',
      });
    });

    it('omits optional ids that are empty or non-string', () => {
      expect(
        parseNotificationIntentPayload({
          intent: 'approval',
          approvalId: 'a-1',
          runId: undefined,
          threadId: '',
        }),
      ).toEqual({
        kind: 'payload',
        value: { kind: 'approval', approvalId: 'a-1' },
      });
    });
  });

  describe('activity intent', () => {
    it('parses an empty activity payload (no required fields)', () => {
      expect(parseNotificationIntentPayload({ intent: 'activity' })).toEqual({
        kind: 'payload',
        value: { kind: 'activity' },
      });
    });

    it('parses an activity payload with all optional ids', () => {
      expect(
        parseNotificationIntentPayload({
          intent: 'activity',
          activityId: 'act-1',
          runId: 'r-1',
          threadId: 't-1',
        }),
      ).toEqual({
        kind: 'payload',
        value: {
          kind: 'activity',
          activityId: 'act-1',
          runId: 'r-1',
          threadId: 't-1',
        },
      });
    });

    it('accepts the "activities" alias', () => {
      expect(parseNotificationIntentPayload({ intent: 'activities', runId: 'r-1' })).toEqual({
        kind: 'payload',
        value: { kind: 'activity', runId: 'r-1' },
      });
    });

    it('omits optional ids that are empty or non-string', () => {
      expect(
        parseNotificationIntentPayload({
          intent: 'activity',
          activityId: '',
          runId: null,
          threadId: '   ',
        }),
      ).toEqual({
        kind: 'payload',
        value: { kind: 'activity' },
      });
    });
  });
});

describe('mapNotificationIntentToNavigationTarget', () => {
  it('maps a thread payload to the thread screen', () => {
    expect(mapNotificationIntentToNavigationTarget({ kind: 'thread', threadId: 't-1' })).toEqual({
      screen: 'thread',
      threadId: 't-1',
    });
  });

  it('maps a run payload to the tasks screen with source run', () => {
    expect(mapNotificationIntentToNavigationTarget({ kind: 'run', runId: 'r-1' })).toEqual({
      screen: 'tasks',
      source: 'run',
      runId: 'r-1',
    });
  });

  it('maps a run payload with a threadId', () => {
    expect(
      mapNotificationIntentToNavigationTarget({ kind: 'run', runId: 'r-1', threadId: 't-1' }),
    ).toEqual({
      screen: 'tasks',
      source: 'run',
      runId: 'r-1',
      threadId: 't-1',
    });
  });

  it('maps an approval payload to the tasks screen with source approval', () => {
    expect(mapNotificationIntentToNavigationTarget({ kind: 'approval', approvalId: 'a-1' })).toEqual(
      {
        screen: 'tasks',
        source: 'approval',
        approvalId: 'a-1',
      },
    );
  });

  it('maps an approval payload with runId and threadId', () => {
    expect(
      mapNotificationIntentToNavigationTarget({
        kind: 'approval',
        approvalId: 'a-1',
        runId: 'r-1',
        threadId: 't-1',
      }),
    ).toEqual({
      screen: 'tasks',
      source: 'approval',
      approvalId: 'a-1',
      runId: 'r-1',
      threadId: 't-1',
    });
  });

  it('maps an activity payload to the tasks screen with source activity', () => {
    expect(mapNotificationIntentToNavigationTarget({ kind: 'activity' })).toEqual({
      screen: 'tasks',
      source: 'activity',
    });
  });

  it('maps an activity payload with all optional ids', () => {
    expect(
      mapNotificationIntentToNavigationTarget({
        kind: 'activity',
        activityId: 'act-1',
        runId: 'r-1',
        threadId: 't-1',
      }),
    ).toEqual({
      screen: 'tasks',
      source: 'activity',
      activityId: 'act-1',
      runId: 'r-1',
      threadId: 't-1',
    });
  });
});

describe('parseNotificationIntent', () => {
  it('returns a navigate result with the parsed payload and mapped target', () => {
    expect(parseNotificationIntent({ intent: 'thread', threadId: 't-1' })).toEqual({
      kind: 'navigate',
      payload: { kind: 'thread', threadId: 't-1' },
      target: { screen: 'thread', threadId: 't-1' },
    });
  });

  it('maps a run intent through to the tasks screen', () => {
    expect(parseNotificationIntent({ intent: 'run', runId: 'r-1', threadId: 't-9' })).toEqual({
      kind: 'navigate',
      payload: { kind: 'run', runId: 'r-1', threadId: 't-9' },
      target: { screen: 'tasks', source: 'run', runId: 'r-1', threadId: 't-9' },
    });
  });

  it('passes an ignore outcome through unchanged', () => {
    expect(parseNotificationIntent(null)).toEqual({
      kind: 'ignore',
      reason: 'missing_data',
    });
  });

  it('passes an error outcome through unchanged', () => {
    expect(parseNotificationIntent({ intent: 'approval' })).toEqual({
      kind: 'error',
      reason: 'missing_approval_id',
    });
  });
});
