import type { EventEnvelope } from '@shared/events';

export interface OutputChunk {
  offset: number;
  text: string;
}

export interface RunOutput {
  stdout: OutputChunk[];
  stderr: OutputChunk[];
}

export interface RunView {
  runId: string;
  status: 'queued' | 'running' | 'finished' | 'failed' | 'unknown';
  threadId?: string;
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface ProjectView {
  projectId: string;
  name?: string;
  path?: string;
  status?: string;
  updatedAt?: string;
}

export interface ThreadView {
  threadId: string;
  projectId?: string;
  title?: string;
  status?: string;
  updatedAt?: string;
}

export interface ItemView {
  itemId: string;
  threadId?: string;
  runId?: string;
  type?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkbenchState {
  events: EventEnvelope[];
  seenEventIds: Record<string, true>;
  lastSeq: number;
  projectsById: Record<string, ProjectView>;
  threadsById: Record<string, ThreadView>;
  itemsById: Record<string, ItemView>;
  runsById: Record<string, RunView>;
  outputByRunId: Record<string, RunOutput>;
  errors: Array<{ code: string; message: string; traceId?: string }>;
}

export function createWorkbenchState(): WorkbenchState {
  return {
    events: [],
    seenEventIds: {},
    lastSeq: 0,
    projectsById: {},
    threadsById: {},
    itemsById: {},
    runsById: {},
    outputByRunId: {},
    errors: [],
  };
}

export function reduceWorkbenchEvent(state: WorkbenchState, event: EventEnvelope): WorkbenchState {
  if (state.seenEventIds[event.id]) {
    return state;
  }

  const next: WorkbenchState = {
    ...state,
    events: [...state.events, event],
    seenEventIds: { ...state.seenEventIds, [event.id]: true },
    lastSeq: Math.max(state.lastSeq, event.seq),
  };

  switch (event.type) {
    case 'project.created':
    case 'project.updated':
      return {
        ...next,
        projectsById: upsertProject(state.projectsById, event),
      };
    case 'thread.created':
    case 'thread.updated':
    case 'thread.forked':
      return {
        ...next,
        threadsById: upsertThread(state.threadsById, event),
      };
    case 'item.created':
    case 'item.updated':
    case 'message.created':
    case 'message.delta':
      return {
        ...next,
        itemsById: upsertItem(state.itemsById, event),
      };
    case 'run.queued':
    case 'run.started':
    case 'run.status.changed':
    case 'run.finished':
    case 'run.failed':
      return {
        ...next,
        runsById: upsertRun(state.runsById, event),
      };
    case 'run.output':
      return {
        ...next,
        outputByRunId: appendOutput(state.outputByRunId, payloadString(event, 'runId'), {
          stream: streamName(event),
          chunks: [{ offset: payloadNumber(event, 'offset'), text: payloadString(event, 'text') }],
        }),
      };
    case 'run.output.batch':
      return {
        ...next,
        outputByRunId: appendOutput(state.outputByRunId, payloadString(event, 'runId'), {
          stream: streamName(event),
          chunks: payloadChunks(event),
        }),
      };
    case 'error':
      return {
        ...next,
        errors: [
          ...state.errors,
          {
            code: payloadString(event, 'code') || 'event_error',
            message: payloadString(event, 'message') || 'Event stream error',
            traceId: optionalPayloadString(event, 'traceId'),
          },
        ],
      };
    default:
      return next;
  }
}

function upsertProject(projectsById: WorkbenchState['projectsById'], event: EventEnvelope) {
  const projectId = idFromPayloadOrScope(event, 'projectId');
  if (!projectId) return projectsById;

  const current = projectsById[projectId];
  return {
    ...projectsById,
    [projectId]: {
      projectId,
      name: optionalPayloadString(event, 'name') ?? current?.name,
      path: optionalPayloadString(event, 'path') ?? current?.path,
      status: optionalPayloadString(event, 'status') ?? current?.status,
      updatedAt: optionalPayloadString(event, 'updatedAt') ?? event.sentAt ?? current?.updatedAt,
    },
  };
}

function upsertThread(threadsById: WorkbenchState['threadsById'], event: EventEnvelope) {
  const threadId = idFromPayloadOrScope(event, 'threadId');
  if (!threadId) return threadsById;

  const current = threadsById[threadId];
  return {
    ...threadsById,
    [threadId]: {
      threadId,
      projectId: idFromPayloadOrScope(event, 'projectId') || current?.projectId,
      title: optionalPayloadString(event, 'title') ?? current?.title,
      status: optionalPayloadString(event, 'status') ?? current?.status,
      updatedAt: optionalPayloadString(event, 'updatedAt') ?? event.sentAt ?? current?.updatedAt,
    },
  };
}

function upsertItem(itemsById: WorkbenchState['itemsById'], event: EventEnvelope) {
  const itemId = idFromPayloadOrScope(event, 'itemId') || idFromPayloadOrScope(event, 'messageId');
  if (!itemId) return itemsById;

  const current = itemsById[itemId];
  return {
    ...itemsById,
    [itemId]: {
      itemId,
      threadId: idFromPayloadOrScope(event, 'threadId') || current?.threadId,
      runId: idFromPayloadOrScope(event, 'runId') || current?.runId,
      type: optionalPayloadString(event, 'type') ?? current?.type ?? event.type,
      status: optionalPayloadString(event, 'status') ?? current?.status,
      createdAt: optionalPayloadString(event, 'createdAt') ?? current?.createdAt,
      updatedAt: optionalPayloadString(event, 'updatedAt') ?? event.sentAt ?? current?.updatedAt,
    },
  };
}

function upsertRun(runsById: WorkbenchState['runsById'], event: EventEnvelope) {
  const runId = idFromPayloadOrScope(event, 'runId');
  if (!runId) return runsById;

  const current = runsById[runId];
  return {
    ...runsById,
    [runId]: {
      runId,
      status: runStatus(event),
      threadId: idFromPayloadOrScope(event, 'threadId') || current?.threadId,
      createdAt: optionalPayloadString(event, 'createdAt') ?? current?.createdAt,
      startedAt:
        optionalPayloadString(event, 'startedAt') ??
        (event.type === 'run.started' ? event.sentAt : current?.startedAt),
      finishedAt:
        optionalPayloadString(event, 'finishedAt') ??
        (event.type === 'run.finished' || event.type === 'run.failed'
          ? event.sentAt
          : current?.finishedAt),
    },
  };
}

function runStatus(event: EventEnvelope): RunView['status'] {
  if (event.type === 'run.queued') return 'queued';
  if (event.type === 'run.started') return 'running';
  if (event.type === 'run.finished') return 'finished';
  if (event.type === 'run.failed') return 'failed';
  const status = optionalPayloadString(event, 'status');
  if (status === 'queued' || status === 'running' || status === 'finished' || status === 'failed') {
    return status;
  }
  return 'unknown';
}

function idFromPayloadOrScope(event: EventEnvelope, key: string): string {
  return optionalPayloadString(event, key) ?? optionalScopeString(event, key) ?? '';
}

function appendOutput(
  outputByRunId: WorkbenchState['outputByRunId'],
  runId: string,
  batch: { stream: 'stdout' | 'stderr'; chunks: OutputChunk[] },
): WorkbenchState['outputByRunId'] {
  if (!runId) return outputByRunId;
  const current = outputByRunId[runId] ?? { stdout: [], stderr: [] };
  const existingOffsets = new Set(current[batch.stream].map((chunk) => chunk.offset));
  const merged = [
    ...current[batch.stream],
    ...batch.chunks.filter((chunk) => !existingOffsets.has(chunk.offset)),
  ].sort((a, b) => a.offset - b.offset);

  return {
    ...outputByRunId,
    [runId]: {
      ...current,
      [batch.stream]: merged,
    },
  };
}

function payloadString(event: EventEnvelope, key: string): string {
  return optionalPayloadString(event, key) ?? '';
}

function optionalPayloadString(event: EventEnvelope, key: string): string | undefined {
  const value = event.payload[key];
  return typeof value === 'string' ? value : undefined;
}

function optionalScopeString(event: EventEnvelope, key: string): string | undefined {
  const value = event.scope[key];
  return typeof value === 'string' ? value : undefined;
}

function payloadNumber(event: EventEnvelope, key: string): number {
  const value = event.payload[key];
  return typeof value === 'number' ? value : 0;
}

function streamName(event: EventEnvelope): 'stdout' | 'stderr' {
  return event.payload.stream === 'stderr' ? 'stderr' : 'stdout';
}

function payloadChunks(event: EventEnvelope): OutputChunk[] {
  const value = event.payload.chunks;
  if (!Array.isArray(value)) return [];

  return value.flatMap((chunk) => {
    if (!chunk || typeof chunk !== 'object') return [];
    const record = chunk as Record<string, unknown>;
    if (typeof record.offset !== 'number' || typeof record.text !== 'string') return [];
    return [{ offset: record.offset, text: record.text }];
  });
}
