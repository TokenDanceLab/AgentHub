// Discriminated event types per api/events.md.
//
// Every event wraps a base envelope. The payload type is narrowed by `type`.
// Scope fields follow the event table: projectId, conversationId, threadId,
// runId, edgeId appear as relevant for each event family.

// ── Base envelope ─────────────────────────────

export interface EventScope {
  projectId?: string;
  conversationId?: string;
  threadId?: string;
  runId?: string;
  edgeId?: string;
  [key: string]: unknown;
}

export interface EventEnvelope {
  version: string;
  id: string;
  seq: number;
  type: string;
  scope: EventScope;
  traceId?: string;
  sentAt: string;
  payload: Record<string, unknown>;
}

// ── IM / Project events (P0) ──────────────────

export interface ProjectCreatedEvent extends EventEnvelope {
  type: 'project.created';
  payload: {
    projectId: string;
    name: string;
    [key: string]: unknown;
  };
}

export interface ProjectUpdatedEvent extends EventEnvelope {
  type: 'project.updated';
  payload: {
    projectId: string;
    [key: string]: unknown;
  };
}

export interface ThreadCreatedEvent extends EventEnvelope {
  type: 'thread.created';
  payload: {
    threadId: string;
    projectId: string;
    title?: string;
    [key: string]: unknown;
  };
}

export interface ThreadUpdatedEvent extends EventEnvelope {
  type: 'thread.updated';
  payload: {
    threadId: string;
    [key: string]: unknown;
  };
}

export interface MessageCreatedEvent extends EventEnvelope {
  type: 'message.created';
  payload: {
    messageId: string;
    threadId: string;
    role: 'user' | 'agent';
    content: string;
    [key: string]: unknown;
  };
}

export interface MessageDeltaEvent extends EventEnvelope {
  type: 'message.delta';
  payload: {
    messageId: string;
    threadId: string;
    delta: string;
    offset: number;
    [key: string]: unknown;
  };
}

export interface ItemCreatedEvent extends EventEnvelope {
  type: 'item.created';
  payload: {
    itemId: string;
    threadId: string;
    kind: string;
    [key: string]: unknown;
  };
}

export interface ItemUpdatedEvent extends EventEnvelope {
  type: 'item.updated';
  payload: {
    itemId: string;
    threadId: string;
    [key: string]: unknown;
  };
}

// ── Execution / Runner events (P0) ─────────────

export interface RunnerOnlineEvent extends EventEnvelope {
  type: 'runner.online';
  payload: {
    runnerId: string;
    name: string;
    capabilities?: string;
    [key: string]: unknown;
  };
}

export interface RunnerOfflineEvent extends EventEnvelope {
  type: 'runner.offline';
  payload: {
    runnerId: string;
    [key: string]: unknown;
  };
}

export interface RunQueuedEvent extends EventEnvelope {
  type: 'run.queued';
  payload: {
    runId: string;
    projectId: string;
    threadId: string;
    [key: string]: unknown;
  };
}

export interface RunStartedEvent extends EventEnvelope {
  type: 'run.started';
  payload: {
    runId: string;
    startedAt: string;
    [key: string]: unknown;
  };
}

export interface RunStatusChangedEvent extends EventEnvelope {
  type: 'run.status.changed';
  payload: {
    runId: string;
    status: string;
    [key: string]: unknown;
  };
}

export interface RunOutputEvent extends EventEnvelope {
  type: 'run.output';
  payload: {
    runId: string;
    stream: 'stdout' | 'stderr';
    offset: number;
    text: string;
    [key: string]: unknown;
  };
}

export interface RunOutputBatchEvent extends EventEnvelope {
  type: 'run.output.batch';
  payload: {
    runId: string;
    stream: 'stdout' | 'stderr';
    chunks: Array<{ offset: number; text: string }>;
    [key: string]: unknown;
  };
}

export interface RunFinishedEvent extends EventEnvelope {
  type: 'run.finished';
  payload: {
    runId: string;
    finishedAt: string;
    [key: string]: unknown;
  };
}

export interface RunFailedEvent extends EventEnvelope {
  type: 'run.failed';
  payload: {
    runId: string;
    reason: string;
    finishedAt: string;
    [key: string]: unknown;
  };
}

export interface ApprovalRequestedEvent extends EventEnvelope {
  type: 'approval.requested';
  payload: {
    approvalId: string;
    runId: string;
    threadId: string;
    kind: string;
    summary: string;
    [key: string]: unknown;
  };
}

export interface ApprovalDecidedEvent extends EventEnvelope {
  type: 'approval.decided';
  payload: {
    approvalId: string;
    runId: string;
    decision: 'approved' | 'rejected';
    [key: string]: unknown;
  };
}

export interface ArtifactCreatedEvent extends EventEnvelope {
  type: 'artifact.created';
  payload: {
    artifactId: string;
    runId: string;
    threadId: string;
    kind: string;
    path: string;
    [key: string]: unknown;
  };
}

export interface PreviewReadyEvent extends EventEnvelope {
  type: 'preview.ready';
  payload: {
    previewId: string;
    runId: string;
    url: string;
    [key: string]: unknown;
  };
}

export interface ErrorEvent extends EventEnvelope {
  type: 'error';
  payload: {
    code: string;
    message: string;
    traceId?: string;
    [key: string]: unknown;
  };
}

// ── Union ─────────────────────────────────────

export type AnyEvent =
  // IM / Project
  | ProjectCreatedEvent
  | ProjectUpdatedEvent
  | ThreadCreatedEvent
  | ThreadUpdatedEvent
  | MessageCreatedEvent
  | MessageDeltaEvent
  | ItemCreatedEvent
  | ItemUpdatedEvent
  // Execution / Runner
  | RunnerOnlineEvent
  | RunnerOfflineEvent
  | RunQueuedEvent
  | RunStartedEvent
  | RunStatusChangedEvent
  | RunOutputEvent
  | RunOutputBatchEvent
  | RunFinishedEvent
  | RunFailedEvent
  | ApprovalRequestedEvent
  | ApprovalDecidedEvent
  | ArtifactCreatedEvent
  | PreviewReadyEvent
  // Common
  | ErrorEvent
  // Fallback
  | EventEnvelope;
