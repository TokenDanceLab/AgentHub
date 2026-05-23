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
  type: 'run.queued' | 'run.started' | 'run.finished' | 'run.failed' | 'run.cancelled';
  payload: {
    runId: string;
    status: string;
    error?: string;
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

// ── Agent events (run.agent.*) ────────────────

export interface AgentTextDeltaEvent extends EventEnvelope {
  type: 'run.agent.text_delta';
  payload: {
    runId: string;
    content: string;
    offset: number;
    [key: string]: unknown;
  };
}

export interface AgentTextBlockEvent extends EventEnvelope {
  type: 'run.agent.text_block';
  payload: {
    runId: string;
    content: string;
    contentType?: 'markdown' | 'text' | 'code';
    language?: string;
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
    callId: string;
    toolName: string;
    input: Record<string, unknown>;
    status: 'pending' | 'started' | 'in_progress' | 'running' | 'completed' | 'failed';
    [key: string]: unknown;
  };
}

export interface AgentToolResultEvent extends EventEnvelope {
  type: 'run.agent.tool_result';
  payload: {
    runId: string;
    callId: string;
    toolName: string;
    content: unknown;
    [key: string]: unknown;
  };
}

export interface AgentFileChangeEvent extends EventEnvelope {
  type: 'run.agent.file_change';
  payload: {
    runId: string;
    callId: string;
    toolName: string;
    content: string;
    isError: boolean;
    [key: string]: unknown;
  };
}

export interface AgentSessionInitEvent extends EventEnvelope {
  type: 'run.agent.session_init';
  payload: {
    runId: string;
    model?: string;
    tools?: string[];
    permissionMode?: string;
    [key: string]: unknown;
  };
}

export interface AgentResultEvent extends EventEnvelope {
  type: 'run.agent.result';
  payload: {
    runId: string;
    success: boolean;
    error?: string;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      input?: number;
      output?: number;
      total?: number;
      [key: string]: unknown;
    };
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
  | AgentTextDeltaEvent
  | AgentTextBlockEvent
  | AgentThinkingEvent
  | AgentToolCallEvent
  | AgentToolResultEvent
  | AgentFileChangeEvent
  | AgentSessionInitEvent
  | AgentResultEvent
  | ErrorEvent
  | EventEnvelope;
