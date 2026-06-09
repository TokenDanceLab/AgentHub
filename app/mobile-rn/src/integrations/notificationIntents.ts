export type NotificationIntentKind = 'thread' | 'run' | 'approval' | 'activity';

export interface ThreadNotificationIntentPayload {
  kind: 'thread';
  threadId: string;
}

export interface RunNotificationIntentPayload {
  kind: 'run';
  runId: string;
  threadId?: string;
}

export interface ApprovalNotificationIntentPayload {
  kind: 'approval';
  approvalId: string;
  runId?: string;
  threadId?: string;
}

export interface ActivityNotificationIntentPayload {
  kind: 'activity';
  activityId?: string;
  runId?: string;
  threadId?: string;
}

export type NotificationIntentPayload =
  | ThreadNotificationIntentPayload
  | RunNotificationIntentPayload
  | ApprovalNotificationIntentPayload
  | ActivityNotificationIntentPayload;

export type MobileNavigationTarget =
  | {
      screen: 'thread';
      threadId: string;
    }
  | {
      screen: 'run';
      runId: string;
      threadId?: string;
    }
  | {
      screen: 'approval';
      approvalId: string;
      runId?: string;
      threadId?: string;
    }
  | {
      screen: 'activity';
      activityId?: string;
      runId?: string;
      threadId?: string;
    };

export type NotificationNavigationTarget = MobileNavigationTarget;

export type NotificationIntentIgnoreReason = 'missing_data' | 'unknown_intent';

export type NotificationIntentErrorReason =
  | 'invalid_data'
  | 'missing_thread_id'
  | 'missing_run_id'
  | 'missing_approval_id';

export type NotificationIntentParseResult =
  | {
      kind: 'navigate';
      payload: NotificationIntentPayload;
      target: NotificationNavigationTarget;
    }
  | {
      kind: 'ignore';
      reason: NotificationIntentIgnoreReason;
    }
  | {
      kind: 'error';
      reason: NotificationIntentErrorReason;
    };

type NotificationDataRecord = Record<string, unknown>;

const intentFields = ['intent', 'type', 'kind', 'screen', 'target'] as const;

export function parseNotificationIntent(data: unknown): NotificationIntentParseResult {
  const payload = parseNotificationIntentPayload(data);
  if (payload.kind !== 'payload') {
    return payload;
  }

  return {
    kind: 'navigate',
    payload: payload.value,
    target: mapNotificationIntentToNavigationTarget(payload.value),
  };
}

export function parseNotificationIntentPayload(
  data: unknown,
):
  | {
      kind: 'payload';
      value: NotificationIntentPayload;
    }
  | {
      kind: 'ignore';
      reason: NotificationIntentIgnoreReason;
    }
  | {
      kind: 'error';
      reason: NotificationIntentErrorReason;
    } {
  if (data == null) {
    return { kind: 'ignore', reason: 'missing_data' };
  }
  if (!isNotificationDataRecord(data)) {
    return { kind: 'error', reason: 'invalid_data' };
  }

  const intent = readIntentKind(data);
  if (intent == null) {
    return { kind: 'ignore', reason: 'unknown_intent' };
  }

  if (intent === 'thread') {
    const threadId = readString(data.threadId);
    if (threadId == null) {
      return { kind: 'error', reason: 'missing_thread_id' };
    }
    return {
      kind: 'payload',
      value: {
        kind: 'thread',
        threadId,
      },
    };
  }

  if (intent === 'run') {
    const runId = readString(data.runId);
    if (runId == null) {
      return { kind: 'error', reason: 'missing_run_id' };
    }
    return {
      kind: 'payload',
      value: {
        kind: 'run',
        runId,
        ...optionalId('threadId', data.threadId),
      },
    };
  }

  if (intent === 'approval') {
    const approvalId = readString(data.approvalId);
    if (approvalId == null) {
      return { kind: 'error', reason: 'missing_approval_id' };
    }
    return {
      kind: 'payload',
      value: {
        kind: 'approval',
        approvalId,
        ...optionalId('runId', data.runId),
        ...optionalId('threadId', data.threadId),
      },
    };
  }

  return {
    kind: 'payload',
    value: {
      kind: 'activity',
      ...optionalId('activityId', data.activityId),
      ...optionalId('runId', data.runId),
      ...optionalId('threadId', data.threadId),
    },
  };
}

export function mapNotificationIntentToNavigationTarget(
  payload: NotificationIntentPayload,
): NotificationNavigationTarget {
  if (payload.kind === 'thread') {
    return {
      screen: 'thread',
      threadId: payload.threadId,
    };
  }

  if (payload.kind === 'run') {
    return {
      screen: 'run',
      runId: payload.runId,
      ...optionalId('threadId', payload.threadId),
    };
  }

  if (payload.kind === 'approval') {
    return {
      screen: 'approval',
      approvalId: payload.approvalId,
      ...optionalId('runId', payload.runId),
      ...optionalId('threadId', payload.threadId),
    };
  }

  return {
    screen: 'activity',
    ...optionalId('activityId', payload.activityId),
    ...optionalId('runId', payload.runId),
    ...optionalId('threadId', payload.threadId),
  };
}

function isNotificationDataRecord(data: unknown): data is NotificationDataRecord {
  return typeof data === 'object' && data !== null && !Array.isArray(data);
}

function readIntentKind(data: NotificationDataRecord): NotificationIntentKind | undefined {
  for (const field of intentFields) {
    const intent = normalizeIntent(data[field]);
    if (intent != null) {
      return intent;
    }
  }
  return undefined;
}

function normalizeIntent(value: unknown): NotificationIntentKind | undefined {
  const intent = readString(value)?.toLowerCase();
  if (intent === 'thread' || intent === 'threads') {
    return 'thread';
  }
  if (intent === 'run' || intent === 'runs') {
    return 'run';
  }
  if (intent === 'approval' || intent === 'approvals' || intent === 'approval_required') {
    return 'approval';
  }
  if (intent === 'activity' || intent === 'activities') {
    return 'activity';
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalId<Key extends string>(key: Key, value: unknown): Partial<Record<Key, string>> {
  const id = readString(value);
  return id == null ? {} : { [key]: id } as Record<Key, string>;
}
