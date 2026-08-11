import type { EventEnvelope } from '../events';
import { normalizeEdgeEventsToTranscript } from './normalizeEdgeEvents';
import { orderTranscriptBlocks } from './order';
import type { TranscriptBlock } from './types';

export interface HubRuntimeEventTranscriptInput {
  id?: string;
  task_id?: string;
  edge_run_id?: string;
  edge_device_id?: string;
  adapter_id?: string;
  agent_label?: string;
  display_name?: string;
  runtime_id?: string;
  runtime_label?: string;
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
  return orderTranscriptBlocks([
    ...hubRuntimeSessionBlocks(events),
    ...edgeBlocks,
  ]);
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
  const agentLabel = stringField(payload.agent_label);
  const displayName = stringField(payload.display_name);
  const runtimeId = stringField(payload.runtime_id);
  const runtimeLabel = stringField(payload.runtime_label);
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
    ...(agentLabel ? { agent_label: agentLabel } : {}),
    ...(displayName ? { display_name: displayName } : {}),
    ...(runtimeId ? { runtime_id: runtimeId } : {}),
    ...(runtimeLabel ? { runtime_label: runtimeLabel } : {}),
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
  agentLabel?: string;
  runtimeLabel?: string;
  sessionId?: string;
  modeLabel?: string;
  targetLabel?: string;
  createdAt?: string;
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
    const nextAgentLabel = previous?.agentLabel ?? runtimeAgentLabel(event, payload);
    const nextRuntimeLabel = previous?.runtimeLabel ?? runtimeRuntimeLabel(event, payload);
    const nextModeLabel = previous?.modeLabel ?? runtimeModeLabel(event, payload);
    const nextTargetLabel = previous?.targetLabel ?? runtimeTargetLabel(event, payload);
    const nextCreatedAt = earliestTimestamp(previous?.createdAt, event.created_at);
    summaries.set(key, {
      key,
      ...(nextTaskId ? { taskId: nextTaskId } : {}),
      ...(nextEdgeRunId ? { edgeRunId: nextEdgeRunId } : {}),
      ...(deviceId ? { deviceId } : {}),
      ...(adapterId ? { adapterId } : {}),
      ...(nextAgentLabel ? { agentLabel: nextAgentLabel } : {}),
      ...(nextRuntimeLabel ? { runtimeLabel: nextRuntimeLabel } : {}),
      ...(nextSessionId ? { sessionId: nextSessionId } : {}),
      ...(nextModeLabel ? { modeLabel: nextModeLabel } : {}),
      ...(nextTargetLabel ? { targetLabel: nextTargetLabel } : {}),
      ...(nextCreatedAt ? { createdAt: nextCreatedAt } : {}),
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
    ...(summary.createdAt ? { createdAt: summary.createdAt } : {}),
    ...(summary.agentLabel ? { agentLabel: summary.agentLabel } : {}),
    ...(summary.runtimeLabel ? { runtimeLabel: summary.runtimeLabel } : {}),
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

function runtimeAgentLabel(
  event: HubRuntimeEventTranscriptInput,
  payload: Record<string, unknown> | null,
): string | undefined {
  return firstString(
    event.agent_label,
    event.display_name,
    payload?.agent_label,
    payload?.agentLabel,
    payload?.display_name,
    payload?.displayName,
    payload?.profile_label,
    payload?.profileLabel,
    payload?.agent_name,
    payload?.agentName,
  );
}

function runtimeRuntimeLabel(
  event: HubRuntimeEventTranscriptInput,
  payload: Record<string, unknown> | null,
): string | undefined {
  return firstString(
    event.runtime_label,
    event.runtime_id,
    payload?.runtime_label,
    payload?.runtimeLabel,
    payload?.runtime_id,
    payload?.runtimeId,
    payload?.adapter_label,
    payload?.adapterLabel,
    payload?.adapter_id,
    payload?.adapterId,
    event.adapter_id,
  );
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
    // Use -1 sentinel when event_seq is missing so these events sort ahead
    // of real seq=0 events instead of colliding with them. Previously `?? 0`
    // made a missing seq indistinguishable from a true seq=0, which could
    // mis-order Hub-persisted events that never carried a sequence number.
    seq: event.event_seq ?? -1,
    type: eventType,
    scope: {
      ...(runId ? { runId } : {}),
      ...(event.session_id ? { conversationId: event.session_id } : {}),
      ...(event.task_id ? { taskId: event.task_id } : {}),
      ...(event.agent_instance_id ? { agentInstanceId: event.agent_instance_id } : {}),
      ...(event.edge_device_id ? { deviceId: event.edge_device_id } : {}),
    },
    sentAt: event.created_at ?? '',
    payload: runtimePayloadRecord(event.payload, runId, event),
  };
}

function earliestTimestamp(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) return right;
  if (!right) return left;
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (!Number.isFinite(leftMs)) return right;
  if (!Number.isFinite(rightMs)) return left;
  return rightMs < leftMs ? right : left;
}

function runtimePayloadRecord(
  payload: unknown,
  runId: string | undefined,
  event: HubRuntimeEventTranscriptInput,
): Record<string, unknown> {
  const parsed = parsePayloadRecord(payload);
  const record = parsed ?? { content: payload };
  const agentId = stringField(event.agent_instance_id);
  const agentLabel = firstString(event.agent_label, event.display_name);
  return {
    ...(runId && record.runId == null ? { runId } : {}),
    ...(agentId && !hasAnyAgentId(record) ? { agentInstanceId: agentId } : {}),
    ...(agentLabel && !hasAnyAgentLabel(record) ? { agentLabel } : {}),
    ...record,
  };
}

function hasAnyAgentId(record: Record<string, unknown>): boolean {
  return Boolean(firstString(
    record.agentId,
    record.agent_id,
    record.agentInstanceId,
    record.agent_instance_id,
    record.workerId,
    record.worker_id,
  ));
}

function hasAnyAgentLabel(record: Record<string, unknown>): boolean {
  return Boolean(firstString(
    record.agentName,
    record.agent_name,
    record.agentLabel,
    record.agent_label,
    record.displayName,
    record.display_name,
    record.workerName,
    record.worker_name,
    record.worker,
    record.agent,
  ));
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
