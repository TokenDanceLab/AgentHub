import type { EventEnvelope } from '../events';
import { normalizeEdgeEventsToTranscript } from './normalizeEdgeEvents';
import type { TranscriptBlock } from './types';

export interface HubRuntimeEventTranscriptInput {
  id?: string;
  task_id?: string;
  edge_run_id?: string;
  edge_device_id?: string;
  adapter_id?: string;
  evidence_mode?: string;
  runtime_mode?: string;
  target_label?: string;
  target_type?: string;
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
  const edgeBlocks = normalizeEdgeEventsToTranscript(
    events
      .map(hubRuntimeEventToEdgeEnvelope)
      .filter((event): event is EventEnvelope => Boolean(event)),
  );
  return [
    ...hubRuntimeSessionBlocks(events),
    ...edgeBlocks,
  ];
}

export function hubRuntimeEventFromPayload(payload: unknown): HubRuntimeEventTranscriptInput | null {
  if (!isRecord(payload)) return null;
  const eventType = stringField(payload.event_type);
  if (!eventType) return null;
  const id = stringField(payload.id);
  const taskId = stringField(payload.task_id);
  const edgeRunId = stringField(payload.edge_run_id);
  const edgeDeviceId = stringField(payload.edge_device_id);
  const adapterId = stringField(payload.adapter_id);
  const evidenceMode = stringField(payload.evidence_mode);
  const runtimeMode = stringField(payload.runtime_mode);
  const targetLabel = stringField(payload.target_label);
  const targetType = stringField(payload.target_type);
  const sessionId = stringField(payload.session_id);
  const agentInstanceId = stringField(payload.agent_instance_id);
  const eventSeq = numberField(payload.event_seq);
  const createdAt = stringField(payload.created_at);

  return {
    ...(id ? { id } : {}),
    ...(taskId ? { task_id: taskId } : {}),
    ...(edgeRunId ? { edge_run_id: edgeRunId } : {}),
    ...(edgeDeviceId ? { edge_device_id: edgeDeviceId } : {}),
    ...(adapterId ? { adapter_id: adapterId } : {}),
    ...(evidenceMode ? { evidence_mode: evidenceMode } : {}),
    ...(runtimeMode ? { runtime_mode: runtimeMode } : {}),
    ...(targetLabel ? { target_label: targetLabel } : {}),
    ...(targetType ? { target_type: targetType } : {}),
    ...(sessionId ? { session_id: sessionId } : {}),
    ...(agentInstanceId ? { agent_instance_id: agentInstanceId } : {}),
    ...(eventSeq != null ? { event_seq: eventSeq } : {}),
    event_type: eventType,
    payload: payload.payload,
    ...(createdAt ? { created_at: createdAt } : {}),
  };
}

interface HubRuntimeSessionSummary {
  key: string;
  taskId?: string;
  edgeRunId?: string;
  deviceId?: string;
  adapterId?: string;
  sessionId?: string;
  modeLabel?: string;
  targetLabel?: string;
  status: 'running' | 'completed' | 'failed';
}

function hubRuntimeSessionBlocks(events: HubRuntimeEventTranscriptInput[]): TranscriptBlock[] {
  const summaries = new Map<string, HubRuntimeSessionSummary>();

  for (const event of events) {
    if (!stringField(event.event_type)) continue;
    const taskId = stringField(event.task_id);
    const edgeRunId = stringField(event.edge_run_id);
    const sessionId = stringField(event.session_id);
    const key = [taskId ?? 'taskless', edgeRunId ?? sessionId ?? 'runless'].join(':');
    if (key === 'taskless:runless') continue;

    const payload = parsePayloadRecord(event.payload);
    const previous = summaries.get(key);
    const deviceId =
      previous?.deviceId ??
      stringField(event.edge_device_id) ??
      stringField(payload?.edge_device_id) ??
      stringField(payload?.device_id) ??
      stringField(payload?.deviceId);
    const adapterId =
      previous?.adapterId ??
      stringField(event.adapter_id) ??
      stringField(payload?.adapter_id) ??
      stringField(payload?.runtime_id) ??
      stringField(payload?.adapterId) ??
      stringField(payload?.runtimeId);
    const nextTaskId = previous?.taskId ?? taskId;
    const nextEdgeRunId = previous?.edgeRunId ?? edgeRunId;
    const nextSessionId = previous?.sessionId ?? sessionId;
    const nextModeLabel = previous?.modeLabel ?? runtimeModeLabel(event, payload);
    const nextTargetLabel = previous?.targetLabel ?? runtimeTargetLabel(event, payload);
    summaries.set(key, {
      key,
      ...(nextTaskId ? { taskId: nextTaskId } : {}),
      ...(nextEdgeRunId ? { edgeRunId: nextEdgeRunId } : {}),
      ...(deviceId ? { deviceId } : {}),
      ...(adapterId ? { adapterId } : {}),
      ...(nextSessionId ? { sessionId: nextSessionId } : {}),
      ...(nextModeLabel ? { modeLabel: nextModeLabel } : {}),
      ...(nextTargetLabel ? { targetLabel: nextTargetLabel } : {}),
      status: mergeSessionStatus(previous?.status, sessionStatus(event)),
    });
  }

  return [...summaries.values()].map((summary) => ({
    id: `hub-runtime-session-${safeId(summary.taskId ?? 'taskless')}-${safeId(summary.edgeRunId ?? summary.sessionId ?? 'runless')}`,
    kind: 'run_session',
    author: { id: 'hub-replay', name: 'Hub replay', role: 'system' },
    title: 'Hub task replay',
    status: summary.status,
    meta: sessionMeta(summary),
    ...(summary.edgeRunId ? { runId: summary.edgeRunId, edgeRunId: summary.edgeRunId } : {}),
    ...(summary.taskId ? { taskId: summary.taskId } : {}),
    ...(summary.deviceId ? { deviceId: summary.deviceId } : {}),
    ...(summary.adapterId ? { adapterId: summary.adapterId } : {}),
    sourceLabel: 'Hub replay',
    modeLabel: summary.modeLabel ?? 'Replay',
    targetLabel: summary.targetLabel ?? (summary.edgeRunId ? 'Edge run evidence' : 'Hub replay'),
    evidenceRefs: [
      ...(summary.edgeRunId ? [{
        id: `run-${summary.edgeRunId}`,
        kind: 'run' as const,
        label: `Run ${summary.edgeRunId}`,
        status: summary.status === 'failed' ? 'failed' as const : summary.status === 'completed' ? 'completed' as const : 'running' as const,
      }] : []),
    ],
  }));
}

function sessionStatus(event: HubRuntimeEventTranscriptInput): HubRuntimeSessionSummary['status'] {
  switch (stringField(event.event_type)) {
    case 'run.finished':
    case 'run.agent.result':
      return payloadFailed(event.payload) ? 'failed' : 'completed';
    case 'run.failed':
    case 'run.cancelled':
      return 'failed';
    default:
      return 'running';
  }
}

function mergeSessionStatus(
  previous: HubRuntimeSessionSummary['status'] | undefined,
  next: HubRuntimeSessionSummary['status'],
): HubRuntimeSessionSummary['status'] {
  if (!previous) return next;
  if (next === 'failed' || previous === 'failed') return 'failed';
  if (next === 'completed') return 'completed';
  return previous;
}

function payloadFailed(payload: unknown): boolean {
  const record = parsePayloadRecord(payload);
  return record?.success === false || Boolean(stringField(record?.error));
}

function sessionMeta(summary: HubRuntimeSessionSummary): string {
  const parts = [
    summary.taskId ? 'Hub task' : undefined,
    summary.edgeRunId ? 'Edge run' : undefined,
    summary.deviceId ? 'device evidence' : undefined,
    summary.adapterId ? 'adapter evidence' : undefined,
  ].filter(Boolean);
  return parts.join(' · ') || 'Hub runtime event replay';
}

function runtimeModeLabel(
  event: HubRuntimeEventTranscriptInput,
  payload: Record<string, unknown> | null,
): string | undefined {
  const mode = firstString(
    event.evidence_mode,
    event.runtime_mode,
    payload?.evidence_mode,
    payload?.runtime_mode,
    payload?.runtimeEvidenceMode,
  );
  if (!mode) return undefined;

  const normalized = normalizeModeToken(mode);
  if (normalized.includes('mock')) return 'Mock';
  if (normalized.includes('fixture')) return 'Fixture';
  if (['replay', 'unknown', 'unverified'].includes(normalized)) return 'Replay';
  if ([
    'real',
    'verified',
    'live',
    'real-tested',
    'real-verified',
    'verified-real',
    'live-runtime',
    'runtime-verified',
  ].includes(normalized)) {
    return 'Real';
  }
  return undefined;
}

function runtimeTargetLabel(
  event: HubRuntimeEventTranscriptInput,
  payload: Record<string, unknown> | null,
): string | undefined {
  return firstString(
    event.target_label,
    payload?.target_label,
    payload?.targetLabel,
    event.target_type,
    payload?.target_type,
    payload?.targetType,
    payload?.execution_target_type,
    payload?.executionTargetType,
  );
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const parsed = stringField(value);
    if (parsed) return parsed;
  }
  return undefined;
}

function normalizeModeToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function safeId(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, '-');
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
