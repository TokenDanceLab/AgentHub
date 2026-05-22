// Discriminated event types per api/events.md.
//
// Every event has a base envelope, and the payload type is narrowed by `type`.

// ── Base envelope ─────────────────────────────

export interface EventEnvelope {
  version: string;
  id: string;
  seq: number;
  type: string;
  scope: Record<string, unknown>;
  traceId?: string;
  sentAt: string;
  payload: Record<string, unknown>;
}

// ── Runner events ─────────────────────────────

export interface RunnerEvent extends EventEnvelope {
  type: 'runner.online' | 'runner.offline';
  payload: {
    runnerId: string;
    [key: string]: unknown;
  };
}

// ── Run lifecycle events ──────────────────────

export interface RunLifecycleEvent extends EventEnvelope {
  type: 'run.queued' | 'run.started' | 'run.finished' | 'run.failed';
  payload: {
    runId: string;
    status: string;
    createdAt?: string;
    startedAt?: string;
    finishedAt?: string;
    [key: string]: unknown;
  };
}

// ── Run output events ─────────────────────────

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

// ── Error event ───────────────────────────────

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
  | RunnerEvent
  | RunLifecycleEvent
  | RunOutputEvent
  | RunOutputBatchEvent
  | ErrorEvent
  | EventEnvelope;
