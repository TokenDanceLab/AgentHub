import type { EventEnvelope } from '../events';
import { normalize as normalizeDiff } from '../diff';
import type { EvidenceRefStatus, TranscriptBlock } from './types';
import { isRuntimeDiagnosticText } from './runtimeDiagnostics';
import {
  booleanField,
  cleanText,
  diffStat,
  durationLabel,
  errorPayloadMessage,
  formatCost,
  isRecord,
  numberField,
  pathFromContent,
  stringField,
} from './edgeEventFields';
import {
  EDGE_AUTHOR,
  agentAuthorFromEvent,
  approvalEvidence,
  approvalHubContext,
  blockBase,
  eventRunId,
  fileEvidence,
  normalizeApprovalRisk,
  normalizeEvidenceStatus,
  normalizeFileAction,
  runEvidence,
  toolEvidence,
} from './edgeEventEvidence';

export function runTextBlock(
  event: EventEnvelope,
  action: string,
  status: EvidenceRefStatus,
): TranscriptBlock | null {
  const runId = eventRunId(event);
  if (!runId) {
    console.warn('normalizeEdgeEvents: run lifecycle event missing runId', { type: event.type, eventId: event.id });
    return null;
  }

  return {
    ...blockBase(event, EDGE_AUTHOR, runEvidence(runId, status)),
    kind: 'text',
    text: `Run ${runId} ${action}`,
  };
}

export function runStatusBlock(event: EventEnvelope): TranscriptBlock | null {
  const runId = eventRunId(event);
  const statusText = stringField(event.payload.status);
  if (!runId || !statusText) {
    console.warn('normalizeEdgeEvents: run.status.changed missing required field', { runId: runId ?? '(missing)', statusText: statusText ?? '(missing)', eventId: event.id });
    return null;
  }
  const status = normalizeEvidenceStatus(statusText);

  return {
    ...blockBase(event, EDGE_AUTHOR, runEvidence(runId, status)),
    kind: 'text',
    text: `Run ${runId} ${statusText}`,
  };
}

export function runFailedBlock(event: EventEnvelope): TranscriptBlock | null {
  const runId = eventRunId(event);
  if (!runId) {
    console.warn('normalizeEdgeEvents: run.failed missing runId', { eventId: event.id });
    return null;
  }
  const reason =
    stringField(event.payload.reason) ??
    stringField(event.payload.error) ??
    stringField(event.payload.message) ??
    errorPayloadMessage(event.payload.error);

  return {
    ...blockBase(event, EDGE_AUTHOR, runEvidence(runId, 'failed')),
    kind: 'failure',
    title: `Run ${runId} failed`,
    runId,
    ...(reason ? { reason } : {}),
  };
}

export function runCancelledBlock(event: EventEnvelope): TranscriptBlock | null {
  const runId = eventRunId(event);
  if (!runId) {
    console.warn('normalizeEdgeEvents: run.cancelled missing runId', { eventId: event.id });
    return null;
  }
  const reason =
    stringField(event.payload.reason) ??
    stringField(event.payload.error) ??
    stringField(event.payload.message) ??
    errorPayloadMessage(event.payload.error);

  return {
    ...blockBase(event, EDGE_AUTHOR, runEvidence(runId, 'failed')),
    kind: 'failure',
    title: `Run ${runId} cancelled`,
    runId,
    ...(reason ? { reason } : {}),
  };
}

export function runFinishedBlock(event: EventEnvelope): TranscriptBlock | null {
  const runId = eventRunId(event);
  if (!runId) {
    console.warn('normalizeEdgeEvents: run.finished missing runId', { eventId: event.id });
    return null;
  }
  const duration =
    stringField(event.payload.duration) ??
    durationLabel(numberField(event.payload.durationMs));

  return {
    ...blockBase(event, EDGE_AUTHOR, runEvidence(runId, 'completed')),
    kind: 'finished',
    title: `Run ${runId} finished`,
    runId,
    ...(duration ? { duration } : {}),
  };
}

export function outputTextBlock(event: EventEnvelope): TranscriptBlock | null {
  const text = cleanText(stringField(event.payload.text));
  if (!text) return null;
  if (isRuntimeDiagnosticText(text)) return null;
  const runId = eventRunId(event);
  if (!runId) {
    console.warn('normalizeEdgeEvents: run.output missing runId, using event.id as fallback evidenceRef', { eventId: event.id });
  }

  return {
    ...blockBase(event, EDGE_AUTHOR, runEvidence(runId ?? event.id, 'running')),
    kind: 'text',
    text,
  };
}

export function outputBatchTextBlock(event: EventEnvelope): TranscriptBlock | null {
  const chunks = event.payload.chunks;
  if (!Array.isArray(chunks)) return null;

  const text = cleanText(
    chunks
      .map((chunk) => {
        if (!isRecord(chunk)) return '';
        return stringField(chunk.text) ?? '';
      })
      .join(''),
  );
  if (!text) return null;
  if (isRuntimeDiagnosticText(text)) return null;
  const runId = eventRunId(event);
  if (!runId) {
    console.warn('normalizeEdgeEvents: run.output.batch missing runId, using event.id as fallback evidenceRef', { eventId: event.id });
  }

  return {
    ...blockBase(event, EDGE_AUTHOR, runEvidence(runId ?? event.id, 'running')),
    kind: 'text',
    text,
  };
}

export function agentTextBlock(event: EventEnvelope): TranscriptBlock | null {
  const text = cleanText(stringField(event.payload.content) ?? stringField(event.payload.text));
  if (!text) return null;
  if (isRuntimeDiagnosticText(text)) return null;
  const runId = eventRunId(event);
  if (!runId) {
    console.warn('normalizeEdgeEvents: agent text block missing runId, using event.id as fallback evidenceRef', { eventId: event.id });
  }

  return {
    ...blockBase(event, agentAuthorFromEvent(event), runEvidence(runId ?? event.id, 'running')),
    kind: 'text',
    text,
  };
}

export function thinkingBlock(event: EventEnvelope): TranscriptBlock | null {
  const content = cleanText(stringField(event.payload.content));
  if (!content) return null;
  const runId = eventRunId(event);
  const status = normalizeEvidenceStatus(stringField(event.payload.status) ?? 'running');

  return {
    ...blockBase(event, agentAuthorFromEvent(event), runEvidence(runId, status)),
    kind: 'thinking',
    content,
    isThinking: status === 'running',
  };
}

export function subagentBlock(event: EventEnvelope): TranscriptBlock | null {
  const runId = eventRunId(event);
  const taskRunId =
    stringField(event.payload.taskRunId) ??
    stringField(event.payload.taskId) ??
    stringField(event.payload.id);
  const title =
    stringField(event.payload.title) ??
    stringField(event.payload.task) ??
    stringField(event.payload.name);
  const worker =
    stringField(event.payload.worker) ??
    stringField(event.payload.workerName) ??
    stringField(event.payload.agent) ??
    stringField(event.payload.agentName);
  if (!title || !worker) return null;
  const status = normalizeEvidenceStatus(stringField(event.payload.status));
  const summary =
    cleanText(stringField(event.payload.summary)) ??
    cleanText(stringField(event.payload.content)) ??
    cleanText(stringField(event.payload.result));

  return {
    ...blockBase(event, agentAuthorFromEvent(event), runEvidence(runId, status)),
    kind: 'subagent',
    title,
    worker,
    status,
    ...(summary ? { summary } : {}),
    ...(taskRunId ? { runId: taskRunId } : {}),
  };
}

export function subtaskBlock(event: EventEnvelope): TranscriptBlock | null {
  const runId = eventRunId(event);
  const taskRunId =
    stringField(event.payload.taskRunId) ??
    stringField(event.payload.taskId) ??
    stringField(event.payload.id);
  const title =
    stringField(event.payload.title) ??
    stringField(event.payload.task) ??
    stringField(event.payload.name);
  if (!title) return null;
  const worker =
    stringField(event.payload.worker) ??
    stringField(event.payload.workerName) ??
    stringField(event.payload.agent) ??
    stringField(event.payload.agentName);
  const status = normalizeEvidenceStatus(stringField(event.payload.status));
  const summary =
    cleanText(stringField(event.payload.summary)) ??
    cleanText(stringField(event.payload.content)) ??
    cleanText(stringField(event.payload.result));

  return {
    ...blockBase(event, agentAuthorFromEvent(event), runEvidence(runId, status)),
    kind: 'subtask',
    title,
    status,
    ...(worker ? { worker } : {}),
    ...(summary ? { summary } : {}),
    ...(taskRunId ? { runId: taskRunId } : {}),
  };
}

export function childAgentBlock(event: EventEnvelope): TranscriptBlock | null {
  const runId = eventRunId(event);
  const childRunId =
    stringField(event.payload.childRunId) ??
    stringField(event.payload.childId) ??
    stringField(event.payload.id);
  const parentRunId = stringField(event.payload.parentRunId) ?? runId;
  const title =
    stringField(event.payload.title) ??
    stringField(event.payload.task) ??
    stringField(event.payload.name);
  const agent =
    stringField(event.payload.agent) ??
    stringField(event.payload.agentName) ??
    stringField(event.payload.worker) ??
    stringField(event.payload.workerName);
  if (!title || !agent) return null;
  const status = normalizeEvidenceStatus(stringField(event.payload.status));
  const summary =
    cleanText(stringField(event.payload.summary)) ??
    cleanText(stringField(event.payload.content)) ??
    cleanText(stringField(event.payload.result)) ??
    cleanText(stringField(event.payload.error));

  return {
    ...blockBase(event, agentAuthorFromEvent(event), runEvidence(runId, status)),
    kind: 'child_agent',
    title,
    agent,
    status,
    ...(summary ? { summary } : {}),
    ...(childRunId ? { runId: childRunId } : {}),
    ...(parentRunId ? { parentRunId } : {}),
  };
}

export function routeDecisionBlock(event: EventEnvelope): TranscriptBlock | null {
  const action = stringField(event.payload.action) ?? stringField(event.payload.kind);
  if (!action) return null;
  const runId = eventRunId(event);
  const summary =
    cleanText(stringField(event.payload.summary)) ??
    cleanText(stringField(event.payload.instructions)) ??
    cleanText(stringField(event.payload.reasoning)) ??
    cleanText(stringField(event.payload.blockedReason));
  const targetAgent =
    stringField(event.payload.targetAgent) ??
    stringField(event.payload.nextWorker) ??
    stringField(event.payload.worker);

  return {
    ...blockBase(event, agentAuthorFromEvent(event), runEvidence(runId, 'running')),
    kind: 'route_decision',
    action,
    ...(summary ? { summary } : {}),
    ...(targetAgent ? { targetAgent } : {}),
  };
}

export function contextUsageBlock(event: EventEnvelope): TranscriptBlock | null {
  const inputTokens = numberField(event.payload.inputTokens) ?? numberField(event.payload.input);
  const outputTokens = numberField(event.payload.outputTokens) ?? numberField(event.payload.output);
  if (inputTokens == null && outputTokens == null) return null;
  const runId = eventRunId(event);
  const contextLimit =
    numberField(event.payload.contextLimit) ??
    numberField(event.payload.limit);
  const totalTokens =
    numberField(event.payload.totalTokens) ??
    numberField(event.payload.total) ??
    ((inputTokens ?? 0) + (outputTokens ?? 0));
  const usagePercent =
    numberField(event.payload.usagePercent) ??
    (contextLimit ? (totalTokens / contextLimit) * 100 : undefined);
  const cachePercent =
    numberField(event.payload.cachePercent) ??
    numberField(event.payload.cacheHitPercent);
  const cost =
    stringField(event.payload.cost) ??
    stringField(event.payload.totalCost) ??
    formatCost(numberField(event.payload.cost) ?? numberField(event.payload.totalCost));
  const modelLabel =
    stringField(event.payload.modelLabel) ??
    stringField(event.payload.model) ??
    stringField(event.payload.provider);

  return {
    ...blockBase(event, agentAuthorFromEvent(event), runEvidence(runId, 'running')),
    kind: 'context_usage',
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    ...(usagePercent != null ? { usagePercent } : {}),
    ...(contextLimit != null ? { contextLimit } : {}),
    ...(cachePercent != null ? { cachePercent } : {}),
    ...(cost ? { cost } : {}),
    ...(modelLabel ? { modelLabel } : {}),
  };
}

export function toolCallBlock(event: EventEnvelope): TranscriptBlock | null {
  const toolName = stringField(event.payload.toolName) ?? stringField(event.payload.name);
  const callId = stringField(event.payload.callId) ?? stringField(event.payload.id);
  if (!toolName && !callId) {
    console.warn('normalizeEdgeEvents: tool_call missing both toolName and callId', { eventId: event.id });
    return null;
  }
  const status = normalizeEvidenceStatus(stringField(event.payload.status) ?? 'running');
  const runId = eventRunId(event);
  const label = toolName ?? callId ?? 'Tool call';
  const target =
    stringField(event.payload.target) ??
    stringField(event.payload.path) ??
    stringField(event.payload.command) ??
    stringField(event.payload.query);
  const summary =
    cleanText(stringField(event.payload.summary)) ??
    cleanText(stringField(event.payload.description)) ??
    cleanText(stringField(event.payload.reason));

  return {
    ...blockBase(event, agentAuthorFromEvent(event), [
      ...runEvidence(runId, status),
      ...toolEvidence(callId ?? label, label, status),
    ]),
    kind: 'tool_call',
    ...(callId ? { callId } : {}),
    toolName: label,
    status,
    ...(target ? { target } : {}),
    ...(summary ? { summary } : {}),
  };
}

export function toolResultBlock(event: EventEnvelope): TranscriptBlock | null {
  const callId = stringField(event.payload.callId) ?? stringField(event.payload.id);
  const toolName = stringField(event.payload.toolName) ?? stringField(event.payload.name) ?? callId;
  if (!toolName) return null;
  const isError = event.payload.isError === true || Boolean(stringField(event.payload.error));
  const status: EvidenceRefStatus = isError ? 'failed' : 'completed';
  const runId = eventRunId(event);
  const summary =
    cleanText(stringField(event.payload.summary)) ??
    cleanText(stringField(event.payload.content)) ??
    cleanText(stringField(event.payload.error));

  return {
    ...blockBase(event, agentAuthorFromEvent(event), [
      ...runEvidence(runId, status),
      ...toolEvidence(callId ?? toolName, `${toolName} result`, status),
    ]),
    kind: 'tool_result',
    ...(callId ? { callId } : {}),
    toolName,
    status,
    ...(summary ? { summary } : {}),
  };
}

export function fileChangeBlock(event: EventEnvelope): TranscriptBlock | null {
  const path = stringField(event.payload.path) ?? pathFromContent(stringField(event.payload.content));
  if (!path) return null;
  const runId = eventRunId(event);
  const evidence = [
    ...runEvidence(runId, 'running'),
    fileEvidence(path),
  ];
  const patch = cleanText(stringField(event.payload.diff));
  const action = normalizeFileAction(
    stringField(event.payload.kind) ??
    stringField(event.payload.action) ??
    stringField(event.payload.status),
  );
  const editId = stringField(event.payload.editId) ?? stringField(event.payload.edit_id);
  const reviewStatus = stringField(event.payload.reviewStatus) ?? stringField(event.payload.review_status);
  const canApply = booleanField(event.payload.canApply) ?? booleanField(event.payload.can_apply);
  const canRevert = booleanField(event.payload.canRevert) ?? booleanField(event.payload.can_revert);
  const metadata = {
    ...(editId ? { editId } : {}),
    ...(reviewStatus ? { reviewStatus } : {}),
    ...(canApply != null ? { canApply } : {}),
    ...(canRevert != null ? { canRevert } : {}),
  };

  if (patch) {
    const additions = diffStat(patch, '+');
    const deletions = diffStat(patch, '-');
    const parsed = normalizeDiff({
      file: path,
      patch,
      additions,
      deletions,
    });

    return {
      ...blockBase(event, agentAuthorFromEvent(event), evidence),
      kind: 'file_change',
      path,
      action,
      additions,
      deletions,
      lines: parsed.hunks.flatMap((hunk) => hunk.lines).map((line) => ({
        type: line.type === 'added' ? 'add' as const : line.type === 'deleted' ? 'del' as const : 'ctx' as const,
        content: line.content,
      })),
      patch,
      ...metadata,
    };
  }

  return {
    ...blockBase(event, agentAuthorFromEvent(event), evidence),
    kind: 'file_change',
    path,
    action,
    ...metadata,
  };
}

export function permissionRequestedBlock(event: EventEnvelope): TranscriptBlock | null {
  const requestId =
    stringField(event.payload.requestId) ??
    stringField(event.payload.approvalId);
  const approvalTitle = cleanText(stringField(event.payload.title));
  const toolName =
    stringField(event.payload.toolName) ??
    stringField(event.payload.kind) ??
    approvalTitle ??
    'permission';
  const runId = eventRunId(event);
  const reason =
    cleanText(stringField(event.payload.description)) ??
    cleanText(stringField(event.payload.reason)) ??
    cleanText(stringField(event.payload.summary)) ??
    cleanText(stringField(event.payload.command)) ??
    cleanText(stringField(event.payload.path));
  const risk = normalizeApprovalRisk(stringField(event.payload.risk) ?? stringField(event.payload.riskLevel));

  const baseBlock = requestId
    ? {
        ...blockBase(event, EDGE_AUTHOR, [
          ...runEvidence(runId, 'pending'),
          approvalEvidence(requestId, toolName, 'pending'),
        ]),
      }
    : {
        ...blockBase(event, EDGE_AUTHOR, [
          ...runEvidence(runId, 'pending'),
        ]),
      };

  return {
    ...baseBlock,
    kind: 'permission_request',
    requestId: requestId ?? event.id,
    title: approvalTitle ?? `Permission requested: ${toolName}`,
    status: 'pending',
    ...approvalHubContext(event),
    toolName,
    ...(risk ? { risk } : {}),
    ...(reason ? { reason } : {}),
  };
}

export function permissionDecidedBlock(event: EventEnvelope): TranscriptBlock | null {
  const requestId =
    stringField(event.payload.requestId) ??
    stringField(event.payload.approvalId);
  const decision = stringField(event.payload.decision) ?? 'decided';
  const status: EvidenceRefStatus = decision === 'deny' || decision === 'rejected' ? 'failed' : 'completed';
  const toolName = stringField(event.payload.toolName) ?? stringField(event.payload.kind) ?? 'permission';
  const runId = eventRunId(event);
  const reason =
    cleanText(stringField(event.payload.reason)) ??
    cleanText(stringField(event.payload.summary));

  const baseBlock = requestId
    ? {
        ...blockBase(event, EDGE_AUTHOR, [
          ...runEvidence(runId, status),
          approvalEvidence(requestId, toolName, status),
        ]),
      }
    : {
        ...blockBase(event, EDGE_AUTHOR, [
          ...runEvidence(runId, status),
        ]),
      };

  return {
    ...baseBlock,
    kind: 'permission_result',
    requestId: requestId ?? event.id,
    title: `Permission ${decision}: ${toolName}`,
    status,
    decision,
    ...approvalHubContext(event),
    toolName,
    ...(reason ? { reason } : {}),
  };
}

export function artifactCreatedBlock(event: EventEnvelope): TranscriptBlock | null {
  const artifactId = stringField(event.payload.artifactId) ?? event.id;
  const path = stringField(event.payload.path);
  const uri =
    stringField(event.payload.uri) ??
    stringField(event.payload.url) ??
    stringField(event.payload.href);
  const mimeType = stringField(event.payload.mimeType) ?? stringField(event.payload.mediaType);
  const artifactKind = stringField(event.payload.kind);
  const title =
    path ??
    stringField(event.payload.title) ??
    uri ??
    artifactKind ??
    artifactId;
  const runId = eventRunId(event);

  return {
    ...blockBase(event, agentAuthorFromEvent(event), [
      ...runEvidence(runId, 'running'),
      {
        id: `artifact-${artifactId}`,
        kind: 'artifact',
        label: title,
        status: 'completed',
        ...(path ? { path } : {}),
        ...(uri ? { uri } : {}),
        ...(mimeType ? { mimeType } : {}),
      },
    ]),
    kind: 'artifact',
    title,
    artifactId,
    ...(artifactKind ? { artifactKind } : {}),
    ...(event.scope.conversationId ? { threadId: event.scope.conversationId } : {}),
    ...(path ? { path } : {}),
    ...(uri ? { uri } : {}),
    ...(mimeType ? { mimeType } : {}),
  };
}

export function previewReadyBlock(event: EventEnvelope): TranscriptBlock | null {
  const previewId = stringField(event.payload.previewId) ?? stringField(event.payload.id);
  if (!previewId) return null;
  const runId = eventRunId(event);
  const url = stringField(event.payload.url);
  const status = normalizeEvidenceStatus(stringField(event.payload.status) ?? 'completed');

  return {
    ...blockBase(event, EDGE_AUTHOR, [
      ...runEvidence(runId, 'running'),
      {
        id: `preview-${previewId}`,
        kind: 'preview',
        label: url ?? previewId,
        status,
        ...(url ? { uri: url } : {}),
      },
    ]),
    kind: 'preview',
    previewId,
    ...(event.scope.conversationId ? { threadId: event.scope.conversationId } : {}),
    status,
    ...(url ? { url } : {}),
  };
}

export function previewStoppedBlock(event: EventEnvelope): TranscriptBlock | null {
  const previewId = stringField(event.payload.previewId) ?? stringField(event.payload.id);
  if (!previewId) return null;
  const runId = eventRunId(event);

  return {
    ...blockBase(event, EDGE_AUTHOR, [
      ...runEvidence(runId, 'running'),
      {
        id: `preview-${previewId}`,
        kind: 'preview',
        label: previewId,
        status: 'completed',
      },
    ]),
    kind: 'preview',
    previewId,
    ...(event.scope.conversationId ? { threadId: event.scope.conversationId } : {}),
    status: 'completed',
  };
}

export function agentResultBlock(event: EventEnvelope): TranscriptBlock | null {
  const runId = eventRunId(event);
  if (!runId) {
    console.warn('normalizeEdgeEvents: run.agent.result missing runId', { eventId: event.id });
    return null;
  }
  const success = event.payload.success !== false;
  const status: EvidenceRefStatus = success ? 'completed' : 'failed';
  const error = stringField(event.payload.error);
  const summary =
    cleanText(stringField(event.payload.summary)) ??
    cleanText(stringField(event.payload.content)) ??
    (success ? `Run ${runId} result received` : `Run ${runId} result failed${error ? `: ${error}` : ''}`);
  const duration = stringField(event.payload.duration) ?? durationLabel(numberField(event.payload.durationMs));
  const turns = numberField(event.payload.turns);

  return {
    ...blockBase(event, agentAuthorFromEvent(event), runEvidence(runId, status)),
    kind: 'result',
    success,
    summary,
    ...(duration ? { duration } : {}),
    ...(turns != null ? { turns } : {}),
  };
}
