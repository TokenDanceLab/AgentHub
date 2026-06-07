import type { EventEnvelope } from '../events';
import { normalizeEdgeEventsToTranscript } from './normalizeEdgeEvents';
import type { TranscriptBlock } from './types';

export interface HubRuntimeEventTranscriptInput {
  id?: string;
  task_id?: string;
  edge_run_id?: string;
  session_id?: string;
  agent_instance_id?: string;
  event_seq?: number;
  event_type?: string;
  payload?: unknown;
  created_at?: string;
}

export function normalizeHubRuntimeEventsToTranscript(
  events: HubRuntimeEventTranscriptInput[] | undefined,
): TranscriptBlock[] {
  if (!events?.length) return [];
  return normalizeEdgeEventsToTranscript(
    events
      .map(hubRuntimeEventToEdgeEnvelope)
      .filter((event): event is EventEnvelope => Boolean(event)),
  );
}

export function hubRuntimeEventFromPayload(payload: unknown): HubRuntimeEventTranscriptInput | null {
  if (!isRecord(payload)) return null;
  const eventType = stringField(payload.event_type);
  if (!eventType) return null;
  const id = stringField(payload.id);
  const taskId = stringField(payload.task_id);
  const edgeRunId = stringField(payload.edge_run_id);
  const sessionId = stringField(payload.session_id);
  const agentInstanceId = stringField(payload.agent_instance_id);
  const eventSeq = numberField(payload.event_seq);
  const createdAt = stringField(payload.created_at);

  return {
    ...(id ? { id } : {}),
    ...(taskId ? { task_id: taskId } : {}),
    ...(edgeRunId ? { edge_run_id: edgeRunId } : {}),
    ...(sessionId ? { session_id: sessionId } : {}),
    ...(agentInstanceId ? { agent_instance_id: agentInstanceId } : {}),
    ...(eventSeq != null ? { event_seq: eventSeq } : {}),
    event_type: eventType,
    payload: payload.payload,
    ...(createdAt ? { created_at: createdAt } : {}),
  };
}

function hubRuntimeEventToEdgeEnvelope(event: HubRuntimeEventTranscriptInput): EventEnvelope | null {
  const eventType = stringField(event.event_type);
  if (!eventType) return null;

  const runId = stringField(event.edge_run_id);
  return {
    version: 'v1',
    id: `hub-runtime-${event.id ?? eventIdentity(event)}`,
    seq: event.event_seq ?? 0,
    type: eventType,
    scope: {
      ...(runId ? { runId } : {}),
      ...(event.session_id ? { conversationId: event.session_id } : {}),
      ...(event.task_id ? { taskId: event.task_id } : {}),
      ...(event.agent_instance_id ? { agentInstanceId: event.agent_instance_id } : {}),
    },
    sentAt: event.created_at ?? '',
    payload: runtimePayloadRecord(event.payload, runId),
  };
}

function runtimePayloadRecord(payload: unknown, runId: string | undefined): Record<string, unknown> {
  const parsed = parsePayloadRecord(payload);
  const record = parsed ?? { content: payload };
  return {
    ...(runId && record.runId == null ? { runId } : {}),
    ...record,
  };
}

function parsePayloadRecord(payload: unknown): Record<string, unknown> | null {
  if (isRecord(payload)) return payload;
  if (typeof payload !== 'string') return null;
  const trimmed = payload.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function eventIdentity(event: HubRuntimeEventTranscriptInput): string {
  return [
    event.task_id,
    event.edge_run_id,
    event.event_seq,
    event.event_type,
  ].filter((part) => part != null && String(part).trim()).join('-') || 'unknown';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
