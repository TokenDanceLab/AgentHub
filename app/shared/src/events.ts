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

export interface ProjectDeletedEvent extends EventEnvelope {
  type: 'project.deleted';
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

export interface ThreadDeletedEvent extends EventEnvelope {
  type: 'thread.deleted';
  payload: {
    threadId: string;
    [key: string]: unknown;
  };
}

export interface ThreadArchivedEvent extends EventEnvelope {
  type: 'thread.archived';
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

export interface ItemDeletedEvent extends EventEnvelope {
  type: 'item.deleted';
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

/**
 * Pre-run workdir checkpoint evidence (#1968). Emitted before run.started
 * when the executor resolved a workdir and captured a snapshot; absent for
 * runs without a workdir (honest absence — no checkpoint, no timeline card).
 */
export interface RunCheckpointEvent extends EventEnvelope {
  type: 'run.checkpoint';
  payload: {
    runId: string;
    checkpointId: string;
    fileCount: number;
    totalBytes: number;
    createdAt: string;
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

export interface RunCancelledEvent extends EventEnvelope {
  type: 'run.cancelled';
  payload: {
    runId: string;
    finishedAt?: string;
    reason?: string;
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

export interface PreviewStoppedEvent extends EventEnvelope {
  type: 'preview.stopped';
  payload: {
    previewId: string;
    runId?: string;
    threadId?: string;
    [key: string]: unknown;
  };
}

// ── Agent runtime events (P0) ──────────────────

export interface AgentTextDeltaEvent extends EventEnvelope {
  type: 'run.agent.text_delta';
  payload: {
    runId: string;
    content: string;
    [key: string]: unknown;
  };
}

export interface AgentTextBlockEvent extends EventEnvelope {
  type: 'run.agent.text_block';
  payload: {
    runId: string;
    content: string;
    [key: string]: unknown;
  };
}

export interface AgentThinkingEvent extends EventEnvelope {
  type: 'run.agent.thinking';
  payload: {
    runId: string;
    content: string;
    [key: string]: unknown;
  };
}

export interface AgentToolCallEvent extends EventEnvelope {
  type: 'run.agent.tool_call';
  payload: {
    runId: string;
    toolName?: string;
    toolInput?: Record<string, unknown>;
    toolUseId?: string;
    [key: string]: unknown;
  };
}

export interface AgentToolResultEvent extends EventEnvelope {
  type: 'run.agent.tool_result';
  payload: {
    runId: string;
    toolUseId?: string;
    content?: string;
    isError?: boolean;
    [key: string]: unknown;
  };
}

export interface AgentFileChangeEvent extends EventEnvelope {
  type: 'run.agent.file_change';
  payload: {
    runId: string;
    path?: string;
    action?: string;
    [key: string]: unknown;
  };
}

export interface AgentPermissionRequestedEvent extends EventEnvelope {
  type: 'run.agent.permission_requested';
  payload: {
    runId: string;
    requestId: string;
    kind?: string;
    summary?: string;
    [key: string]: unknown;
  };
}

export interface AgentPermissionDecidedEvent extends EventEnvelope {
  type: 'run.agent.permission_decided';
  payload: {
    runId: string;
    requestId: string;
    decision: 'allow' | 'deny';
    [key: string]: unknown;
  };
}

export interface AgentRouteDecisionEvent extends EventEnvelope {
  type: 'run.agent.route_decision';
  payload: {
    runId: string;
    action?: string;
    nextWorker?: string;
    reasoning?: string;
    [key: string]: unknown;
  };
}

export interface AgentResultEvent extends EventEnvelope {
  type: 'run.agent.result';
  payload: {
    runId: string;
    success: boolean;
    content?: string;
    error?: string;
    [key: string]: unknown;
  };
}

// ── Plan approval events (P1) ──────────────────

export interface PlanProposedEvent extends EventEnvelope {
  type: 'run.agent.plan_proposed';
  payload: {
    runId: string;
    planId: string;
    summary: string;
    steps?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
}

export interface PlanApprovedEvent extends EventEnvelope {
  type: 'run.agent.plan_approved';
  payload: {
    runId: string;
    planId: string;
    approvedBy?: string;
    [key: string]: unknown;
  };
}

export interface PlanRejectedEvent extends EventEnvelope {
  type: 'run.agent.plan_rejected';
  payload: {
    runId: string;
    planId: string;
    reason?: string;
    rejectedBy?: string;
    [key: string]: unknown;
  };
}

export interface PlanExpiredEvent extends EventEnvelope {
  type: 'run.agent.plan_expired';
  payload: {
    runId: string;
    planId: string;
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

// ── System / infrastructure events ──────────────

export interface SystemGapEvent extends EventEnvelope {
  type: 'system.gap';
  payload: {
    firstDroppedSeq: number;
    lastDroppedSeq: number;
    droppedCount: number;
  };
}

// ── Union ─────────────────────────────────────

export type AnyEvent =
  // IM / Project
  | ProjectCreatedEvent
  | ProjectUpdatedEvent
  | ProjectDeletedEvent
  | ThreadCreatedEvent
  | ThreadUpdatedEvent
  | ThreadDeletedEvent
  | ThreadArchivedEvent
  | MessageCreatedEvent
  | MessageDeltaEvent
  | ItemCreatedEvent
  | ItemUpdatedEvent
  | ItemDeletedEvent
  // Execution / Runner
  | RunnerOnlineEvent
  | RunnerOfflineEvent
  | RunQueuedEvent
  | RunCheckpointEvent
  | RunStartedEvent
  | RunStatusChangedEvent
  | RunOutputEvent
  | RunOutputBatchEvent
  | RunFinishedEvent
  | RunFailedEvent
  | RunCancelledEvent
  | ApprovalRequestedEvent
  | ApprovalDecidedEvent
  | ArtifactCreatedEvent
  | PreviewReadyEvent
  | PreviewStoppedEvent
  // Agent runtime
  | AgentTextDeltaEvent
  | AgentTextBlockEvent
  | AgentThinkingEvent
  | AgentToolCallEvent
  | AgentToolResultEvent
  | AgentFileChangeEvent
  | AgentPermissionRequestedEvent
  | AgentPermissionDecidedEvent
  | AgentRouteDecisionEvent
  | AgentResultEvent
  // Plan approval
  | PlanProposedEvent
  | PlanApprovedEvent
  | PlanRejectedEvent
  | PlanExpiredEvent
  // System / infrastructure
  | SystemGapEvent
  // Common
  | ErrorEvent
  // Fallback
  | EventEnvelope;
