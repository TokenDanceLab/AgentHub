import type {
  AgentTaskApproval,
  AgentTaskApprovalList,
  AgentTaskArtifact,
  AgentTaskArtifactList,
} from '@/api/hubClient';
import type { HubRuntimeEventTranscriptInput } from '@shared/transcript';

export function mergeHubTaskContractEvents(
  runtimeEvents: HubRuntimeEventTranscriptInput[],
  approvals: AgentTaskApprovalList | undefined,
  artifacts: AgentTaskArtifactList | undefined,
): HubRuntimeEventTranscriptInput[] {
  let merged = runtimeEvents;
  if (approvals) {
    for (const approval of approvals.approvals) {
      merged = appendHubRuntimeEvent(merged, taskApprovalToRuntimeEvent(approval, approvals), 400);
    }
  }
  if (artifacts) {
    for (const artifact of artifacts.artifacts) {
      merged = appendHubRuntimeEvent(merged, taskArtifactToRuntimeEvent(artifact, artifacts), 400);
    }
  }
  return merged;
}

function taskApprovalToRuntimeEvent(
  approval: AgentTaskApproval,
  list: AgentTaskApprovalList,
): HubRuntimeEventTranscriptInput {
  const status = normalizedStatus(approval.status);
  const decided = status && !['pending', 'requested', 'running'].includes(status);
  const toolName = approval.tool_name || 'permission';
  return {
    id: approval.source_event_id || approval.approval_id,
    task_id: approval.task_id || list.task_id,
    ...(approval.edge_run_id || list.edge_run_id ? { edge_run_id: approval.edge_run_id || list.edge_run_id } : {}),
    ...(approval.session_id || list.session_id ? { session_id: approval.session_id || list.session_id } : {}),
    ...(approval.event_seq != null ? { event_seq: approval.event_seq } : {}),
    event_type: decided ? 'run.agent.permission_decided' : 'run.agent.permission_requested',
    payload: {
      approvalId: approval.approval_id,
      requestId: approval.request_id || approval.approval_id,
      toolName,
      ...(approval.tool_use_id ? { toolUseId: approval.tool_use_id } : {}),
      ...(approval.status ? { status: approval.status } : {}),
      ...(approval.reason ? { reason: approval.reason } : {}),
      ...(decided ? { decision: taskApprovalDecision(status) } : {}),
      ...(approval.decided_by ? { decidedBy: approval.decided_by } : {}),
      agent_task_id: approval.task_id || list.task_id,
      ...(approval.edge_run_id || list.edge_run_id ? { edge_run_id: approval.edge_run_id || list.edge_run_id } : {}),
    },
    ...(approval.created_at || approval.decided_at ? { created_at: approval.created_at || approval.decided_at } : {}),
  };
}

function taskArtifactToRuntimeEvent(
  artifact: AgentTaskArtifact,
  list: AgentTaskArtifactList,
): HubRuntimeEventTranscriptInput {
  const artifactId = artifact.artifact_id || artifact.source_event_id || artifact.path || artifact.name || 'artifact';
  const patch = artifact.diff || artifact.patch;
  const artifactKind = artifact.type || artifact.kind || artifact.status;
  const eventType = isTaskFileChangeArtifact(artifact) ? 'run.agent.file_change' : 'artifact.created';
  return {
    id: artifact.source_event_id || artifactId,
    task_id: artifact.task_id || list.task_id,
    ...(artifact.edge_run_id || list.edge_run_id ? { edge_run_id: artifact.edge_run_id || list.edge_run_id } : {}),
    ...(artifact.session_id || list.session_id ? { session_id: artifact.session_id || list.session_id } : {}),
    ...(artifact.event_seq != null ? { event_seq: artifact.event_seq } : {}),
    event_type: eventType,
    payload: {
      artifactId,
      ...(artifact.path || artifact.name ? { path: artifact.path || artifact.name } : {}),
      ...(artifact.name || artifact.path ? { title: artifact.name || artifact.path } : {}),
      ...(artifact.action ? { action: artifact.action } : {}),
      kind: artifactKind || artifact.action || 'artifact',
      ...(artifact.tool_name ? { toolName: artifact.tool_name } : {}),
      ...(artifact.mime_type ? { mimeType: artifact.mime_type } : {}),
      ...(artifact.size_bytes != null ? { sizeBytes: artifact.size_bytes } : {}),
      ...(patch ? { diff: patch } : {}),
      ...(artifact.edit_id ? { edit_id: artifact.edit_id } : {}),
      ...(artifact.review_status ? { review_status: artifact.review_status } : {}),
      ...(artifact.can_apply != null ? { can_apply: artifact.can_apply } : {}),
      ...(artifact.can_revert != null ? { can_revert: artifact.can_revert } : {}),
      agent_task_id: artifact.task_id || list.task_id,
      ...(artifact.edge_run_id || list.edge_run_id ? { edge_run_id: artifact.edge_run_id || list.edge_run_id } : {}),
    },
    ...(artifact.created_at ? { created_at: artifact.created_at } : {}),
  };
}

function isTaskFileChangeArtifact(artifact: AgentTaskArtifact): boolean {
  const kind = normalizedStatus(artifact.type || artifact.kind || artifact.status);
  return kind === 'file_change' || kind === 'diff' || Boolean(artifact.diff || artifact.patch || artifact.edit_id);
}

function taskApprovalDecision(status: string | undefined): 'allow' | 'deny' {
  return status === 'denied' || status === 'deny' || status === 'rejected' || status === 'failed'
    ? 'deny'
    : 'allow';
}

function normalizedStatus(status: string | undefined): string | undefined {
  return status?.trim().toLowerCase();
}

export function appendHubRuntimeEvent(
  current: HubRuntimeEventTranscriptInput[],
  incoming: HubRuntimeEventTranscriptInput,
  limit = 200,
): HubRuntimeEventTranscriptInput[] {
  const incomingKey = hubRuntimeEventKey(incoming);
  const replaced = current.filter((event) => hubRuntimeEventKey(event) !== incomingKey);
  return [...replaced, incoming].slice(-limit);
}

export function mergeHubRuntimeEvents(
  replayed: HubRuntimeEventTranscriptInput[] | undefined,
  live: HubRuntimeEventTranscriptInput[],
  limit = 400,
): HubRuntimeEventTranscriptInput[] {
  let merged = replayed ?? [];
  for (const event of live) {
    merged = appendHubRuntimeEvent(merged, event, limit);
  }
  return merged.slice(-limit);
}

function hubRuntimeEventKey(event: HubRuntimeEventTranscriptInput): string {
  // When an explicit ID is present, use it as the key for ID-based dedup.
  // Content hashing is reserved for events without IDs (composite-key fallback).
  if (event.id) {
    return event.id;
  }
  const identityKey = [
    event.task_id,
    event.edge_run_id,
    event.event_seq,
    event.event_type,
  ].filter((part) => part != null && String(part).trim()).join(':');

  // Content-based dedup: include a hash of the payload to catch duplicate
  // events that arrive with different IDs but identical content (common
  // with WebSocket reconnection replays or hub edge replay overlap).
  const payloadHash = event.payload != null ? hashPayload(event.payload) : '';
  return payloadHash ? `${identityKey}|${payloadHash}` : identityKey;
}

function hashPayload(payload: unknown): string {
  if (typeof payload === 'string') return hashString(payload);
  if (typeof payload === 'object' && payload !== null) {
    // Sort keys for deterministic hashing
    return hashString(JSON.stringify(payload, Object.keys(payload as Record<string, unknown>).sort()));
  }
  return hashString(JSON.stringify(payload));
}

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}
