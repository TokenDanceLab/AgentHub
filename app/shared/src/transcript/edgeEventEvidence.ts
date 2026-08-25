import type { EventEnvelope } from '../events';
import type { EvidenceRef, EvidenceRefStatus, TranscriptAuthor } from './types';
import { firstString, safeAuthorId, stringField } from './edgeEventFields';

export const AGENT_AUTHOR: TranscriptAuthor = { id: 'agent', name: 'Agent', role: 'agent' };
export const EDGE_AUTHOR: TranscriptAuthor = { id: 'edge', name: 'Edge', role: 'system' };

export function agentAuthorFromEvent(event: EventEnvelope): TranscriptAuthor {
  const explicitId = firstString(
    event.payload.agentId,
    event.payload.agent_id,
    event.payload.agentInstanceId,
    event.payload.agent_instance_id,
    event.payload.workerId,
    event.payload.worker_id,
    event.payload.runnerId,
    event.payload.runner_id,
    event.scope.agentId,
    event.scope.agent_id,
    event.scope.agentInstanceId,
    event.scope.agent_instance_id,
  );
  const label = firstString(
    event.payload.agentName,
    event.payload.agent_name,
    event.payload.agentLabel,
    event.payload.agent_label,
    event.payload.displayName,
    event.payload.display_name,
    event.payload.workerName,
    event.payload.worker_name,
    event.payload.worker,
    event.payload.agent,
    event.payload.runnerName,
    event.payload.runner_name,
    event.payload.adapterLabel,
    event.payload.adapter_label,
  );
  const id = explicitId ?? (label ? safeAuthorId(label, AGENT_AUTHOR.id) : AGENT_AUTHOR.id);

  return {
    id,
    name: label ?? explicitId ?? AGENT_AUTHOR.name,
    role: 'agent',
  };
}

export function blockBase(event: EventEnvelope, author: TranscriptAuthor, evidenceRefs: EvidenceRef[]) {
  return {
    id: `edge-event-${event.id}`,
    author,
    ...(event.sentAt ? { createdAt: event.sentAt } : {}),
    ...(evidenceRefs.length > 0 ? { evidenceRefs } : {}),
  };
}

export function runEvidence(
  runId: string | undefined,
  status: EvidenceRefStatus,
  workDir?: string | undefined,
): EvidenceRef[] {
  if (!runId) return [];
  return [{
    id: `run-${runId}`,
    kind: 'run' as const,
    label: `Run ${runId}`,
    status,
    // Executor-reported workspace (#1967); omitted when absent so callers
    // can distinguish "no trusted workDir" from an empty string.
    ...(workDir ? { workDir } : {}),
  }];
}

/**
 * Executor-reported workspace from a run event payload (#1967). Undefined
 * when Edge did not resolve a workDir — callers must keep review read-only.
 */
export function eventRunWorkDir(event: EventEnvelope): string | undefined {
  return stringField(event.payload.workDir);
}

export function toolEvidence(
  id: string | undefined,
  label: string,
  status: EvidenceRefStatus,
): EvidenceRef[] {
  if (!id) return [];
  return [{
    id: `tool-${id}`,
    kind: 'tool' as const,
    label,
    status,
  }];
}

export function approvalEvidence(
  id: string,
  label: string,
  status: EvidenceRefStatus,
): EvidenceRef {
  const normalizedLabel = label.trim();
  const evidenceLabel = normalizedLabel.toLowerCase().includes('approval')
    ? normalizedLabel
    : `${normalizedLabel} approval`;
  return {
    id: `approval-${id}`,
    kind: 'approval',
    label: evidenceLabel,
    status,
  };
}

export function approvalHubContext(event: EventEnvelope): {
  teamId?: string;
  teamRunId?: string;
  agentTaskId?: string;
  targetId?: string;
  edgeDeviceId?: string;
  correlationId?: string;
} {
  const teamId = stringField(event.payload.team_id) ?? stringField(event.payload.teamId);
  const teamRunId =
    stringField(event.payload.team_run_id) ??
    stringField(event.payload.teamRunId) ??
    stringField(event.payload.run_id) ??
    stringField(event.payload.runId);
  const agentTaskId =
    stringField(event.payload.agent_task_id) ??
    stringField(event.payload.agentTaskId) ??
    stringField(event.scope.taskId);
  const targetId =
    stringField(event.payload.target_id) ??
    stringField(event.payload.targetId) ??
    stringField(event.scope.targetId);
  const edgeDeviceId =
    stringField(event.payload.edge_device_id) ??
    stringField(event.payload.edgeDeviceId) ??
    stringField(event.scope.deviceId);
  const correlationId =
    stringField(event.payload.correlation_id) ??
    stringField(event.payload.correlationId);
  return {
    ...(teamId ? { teamId } : {}),
    ...(teamRunId ? { teamRunId } : {}),
    ...(agentTaskId ? { agentTaskId } : {}),
    ...(targetId ? { targetId } : {}),
    ...(edgeDeviceId ? { edgeDeviceId } : {}),
    ...(correlationId ? { correlationId } : {}),
  };
}

export function fileEvidence(path: string): EvidenceRef {
  return {
    id: `file-${path}`,
    kind: 'file',
    label: path,
    path,
  };
}

export function eventRunId(event: EventEnvelope): string | undefined {
  return stringField(event.payload.runId) ?? stringField(event.scope.runId);
}

export function normalizeEvidenceStatus(status: string | undefined): EvidenceRefStatus {
  switch (status?.trim()) {
    case 'pending':
    case 'queued':
      return 'pending';
    case 'running':
    case 'starting':
    case 'streaming':
    case 'draining':
      return 'running';
    case 'failed':
    case 'cancelled':
    case 'error':
    case 'denied':
    case 'rejected':
      return 'failed';
    case 'completed':
    case 'finished':
    case 'succeeded':
    case 'success':
    case 'approved':
    case 'ready':
      return 'completed';
    default:
      return 'running';
  }
}

export function normalizeApprovalRisk(
  risk: string | undefined,
): 'low' | 'medium' | 'high' | 'critical' | undefined {
  switch (risk?.trim().toLowerCase()) {
    case 'low':
    case '低风险':
      return 'low';
    case 'medium':
    case 'mid':
    case '中风险':
      return 'medium';
    case 'high':
    case '高风险':
      return 'high';
    case 'critical':
    case '关键风险':
      return 'critical';
    default:
      return undefined;
  }
}

export function normalizeFileAction(action: string | undefined): 'created' | 'modified' | 'deleted' {
  switch (action?.trim().toLowerCase()) {
    case 'created':
    case 'create':
    case 'added':
    case 'add':
      return 'created';
    case 'deleted':
    case 'delete':
    case 'removed':
    case 'remove':
      return 'deleted';
    default:
      return 'modified';
  }
}
