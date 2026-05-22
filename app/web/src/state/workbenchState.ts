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
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface WorkbenchState {
  events: EventEnvelope[];
  seenEventIds: Record<string, true>;
  lastSeq: number;
  runsById: Record<string, RunView>;
  outputByRunId: Record<string, RunOutput>;
  errors: Array<{ code: string; message: string; traceId?: string }>;
}

export function createWorkbenchState(): WorkbenchState {
  return {
    events: [],
    seenEventIds: {},
    lastSeq: 0,
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
    case 'run.queued':
    case 'run.started':
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

function upsertRun(runsById: WorkbenchState['runsById'], event: EventEnvelope) {
  const runId = payloadString(event, 'runId');
  if (!runId) return runsById;

  const current = runsById[runId];
  return {
    ...runsById,
    [runId]: {
      runId,
      status: runStatus(event),
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
