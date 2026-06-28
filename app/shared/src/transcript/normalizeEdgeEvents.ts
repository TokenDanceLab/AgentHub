import type { EventEnvelope } from '../events';
import { normalize as normalizeDiff } from '../diff';
import type { EvidenceRef, EvidenceRefStatus, TranscriptAuthor, TranscriptBlock } from './types';
import { isRuntimeDiagnosticText } from './runtimeDiagnostics';

const AGENT_AUTHOR: TranscriptAuthor = { id: 'agent', name: 'Agent', role: 'agent' };
const EDGE_AUTHOR: TranscriptAuthor = { id: 'edge', name: 'Edge', role: 'system' };

function agentAuthorFromEvent(event: EventEnvelope): TranscriptAuthor {
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
  const id = explicitId ?? (label ? safeAuthorId(label) : AGENT_AUTHOR.id);

  return {
    id,
    name: label ?? explicitId ?? AGENT_AUTHOR.name,
    role: 'agent',
  };
}

export function normalizeEdgeEventsToTranscript(events: EventEnvelope[] | undefined): TranscriptBlock[] {
  if (!events?.length) return [];

  const blocks = events
    .map((event, index) => ({
      block: normalizeEdgeEvent(event),
      index,
      seq: event.seq,
      timestamp: timestampMs(event),
    }))
    .filter((entry): entry is {
      block: TranscriptBlock;
      index: number;
      seq: number;
      timestamp: number;
    } => Boolean(entry.block))
    .sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      if (a.seq !== b.seq) return a.seq - b.seq;
      return a.index - b.index;
    })
    .map((entry) => entry.block);

  // Post-process: merge consecutive text/thinking blocks from streaming deltas.
  // This prevents UI thrashing from many incremental text_delta/thinking events.
  // Merging only applies to blocks from the same author AND same run (via evidenceRefs).
  const merged = blocks.reduce((acc: TranscriptBlock[], block) => {
    const last = acc[acc.length - 1];
    if (!last) { acc.push(block); return acc; }

    const sameRun = evidenceRunId(last) === evidenceRunId(block);

    // Merge consecutive text blocks with same author + run (streaming text_delta → single text block)
    if (
      last.kind === 'text' &&
      block.kind === 'text' &&
      last.author.id === block.author.id &&
      sameRun
    ) {
      acc[acc.length - 1] = {
        ...last,
        text: last.text + block.text,
      };
      return acc;
    }

    // Merge consecutive thinking blocks with same author + run (streaming thinking → single thinking block)
    if (
      last.kind === 'thinking' &&
      block.kind === 'thinking' &&
      last.author.id === block.author.id &&
      sameRun
    ) {
      const mergedIsThinking = last.isThinking || block.isThinking
      acc[acc.length - 1] = {
        ...last,
        content: (last.content ?? '') + (block.content ?? ''),
        ...(mergedIsThinking ? { isThinking: true as const } : {}),
      };
      return acc;
    }

    acc.push(block);
    return acc;
  }, []);

  // Post-process: auto-transition thinking blocks to 'completed' when the next
  // non-thinking block arrives. This prevents thinking blocks from staying in
  // 'running' state forever when the model has already moved on to a text reply.
  for (let i = 0; i < merged.length; i++) {
    const block = merged[i]!;
    if (block.kind === 'thinking' && block.isThinking) {
      const nextBlock = merged[i + 1];
      if (!nextBlock || nextBlock.kind !== 'thinking') {
        // Mark as completed; update evidenceRef status too
        block.isThinking = false;
        if (block.evidenceRefs) {
          for (const ref of block.evidenceRefs) {
            ref.status = 'completed';
          }
        }
      }
    }
  }

  return merged;
}

/** Extract the first run evidence ref ID from a block's evidenceRefs, or empty string if none. */
function evidenceRunId(block: TranscriptBlock): string {
  const refs = block.evidenceRefs;
  if (!refs) return '';
  const runRef = refs.find((r) => r.kind === 'run');
  return runRef?.id ?? '';
}

// System-level run lifecycle events that should not appear as transcript blocks.
// These are status indicators, not conversational content.
const SKIPPED_EVENT_TYPES = new Set<string>([
  'run.queued',
  'run.started',
  'run.status.changed',
]);

function normalizeEdgeEvent(event: EventEnvelope): TranscriptBlock | null {
  if (SKIPPED_EVENT_TYPES.has(event.type)) return null;

  switch (event.type) {
    case 'run.queued':
      return runTextBlock(event, 'queued', 'pending');
    case 'run.started':
      return runTextBlock(event, 'started', 'running');
    case 'run.status.changed':
      return runStatusBlock(event);
    case 'run.output':
      return outputTextBlock(event);
    case 'run.output.batch':
      return outputBatchTextBlock(event);
    case 'run.agent.text_delta':
    case 'run.agent.text_block':
      return agentTextBlock(event);
    case 'run.agent.thinking':
      return thinkingBlock(event);
    case 'run.agent.subagent':
      return subagentBlock(event);
    case 'run.agent.subagent_task':
      return subtaskBlock(event);
    case 'run.agent.child_agent':
      return childAgentBlock(event);
    case 'run.agent.route_decision':
      return routeDecisionBlock(event);
    case 'run.agent.context_usage':
      return contextUsageBlock(event);
    case 'run.agent.tool_call':
      return toolCallBlock(event);
    case 'run.agent.tool_result':
      return toolResultBlock(event);
    case 'run.agent.file_change':
      return fileChangeBlock(event);
    case 'run.agent.permission_requested':
    case 'approval.requested':
      return permissionRequestedBlock(event);
    case 'run.agent.permission_decided':
    case 'approval.decided':
      return permissionDecidedBlock(event);
    case 'artifact.created':
      return artifactCreatedBlock(event);
    case 'preview.ready':
      return previewReadyBlock(event);
    case 'preview.stopped':
      return previewStoppedBlock(event);
    case 'run.agent.result':
      return agentResultBlock(event);
    case 'run.finished':
      return runFinishedBlock(event);
    case 'run.failed':
      return runFailedBlock(event);
    case 'run.cancelled':
      return runCancelledBlock(event);
    default:
      console.warn('normalizeEdgeEvents: unknown event type — silently dropped', {
        type: event.type,
        eventId: event.id,
      });
      return null;
  }
}

function runTextBlock(
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

function runStatusBlock(event: EventEnvelope): TranscriptBlock | null {
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

function runFailedBlock(event: EventEnvelope): TranscriptBlock | null {
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

function runCancelledBlock(event: EventEnvelope): TranscriptBlock | null {
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

function runFinishedBlock(event: EventEnvelope): TranscriptBlock | null {
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

function outputTextBlock(event: EventEnvelope): TranscriptBlock | null {
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

function outputBatchTextBlock(event: EventEnvelope): TranscriptBlock | null {
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

function agentTextBlock(event: EventEnvelope): TranscriptBlock | null {
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

function thinkingBlock(event: EventEnvelope): TranscriptBlock | null {
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

function subagentBlock(event: EventEnvelope): TranscriptBlock | null {
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

function subtaskBlock(event: EventEnvelope): TranscriptBlock | null {
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

function childAgentBlock(event: EventEnvelope): TranscriptBlock | null {
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

function routeDecisionBlock(event: EventEnvelope): TranscriptBlock | null {
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

function contextUsageBlock(event: EventEnvelope): TranscriptBlock | null {
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

function toolCallBlock(event: EventEnvelope): TranscriptBlock | null {
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

function toolResultBlock(event: EventEnvelope): TranscriptBlock | null {
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

function fileChangeBlock(event: EventEnvelope): TranscriptBlock | null {
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
        type: line.type === 'added' ? 'add' : line.type === 'deleted' ? 'del' : 'ctx',
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

function permissionRequestedBlock(event: EventEnvelope): TranscriptBlock | null {
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

function permissionDecidedBlock(event: EventEnvelope): TranscriptBlock | null {
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

function artifactCreatedBlock(event: EventEnvelope): TranscriptBlock | null {
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

function previewReadyBlock(event: EventEnvelope): TranscriptBlock | null {
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

function previewStoppedBlock(event: EventEnvelope): TranscriptBlock | null {
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

function agentResultBlock(event: EventEnvelope): TranscriptBlock | null {
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

function blockBase(event: EventEnvelope, author: TranscriptAuthor, evidenceRefs: EvidenceRef[]) {
  return {
    id: `edge-event-${event.id}`,
    author,
    ...(event.sentAt ? { createdAt: event.sentAt } : {}),
    ...(evidenceRefs.length > 0 ? { evidenceRefs } : {}),
  };
}

function runEvidence(runId: string | undefined, status: EvidenceRefStatus): EvidenceRef[] {
  if (!runId) return [];
  return [{
    id: `run-${runId}`,
    kind: 'run',
    label: `Run ${runId}`,
    status,
  }];
}

function toolEvidence(
  id: string | undefined,
  label: string,
  status: EvidenceRefStatus,
): EvidenceRef[] {
  if (!id) return [];
  return [{
    id: `tool-${id}`,
    kind: 'tool',
    label,
    status,
  }];
}

function approvalEvidence(
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

function approvalHubContext(event: EventEnvelope): {
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

function fileEvidence(path: string): EvidenceRef {
  return {
    id: `file-${path}`,
    kind: 'file',
    label: path,
    path,
  };
}

function eventRunId(event: EventEnvelope): string | undefined {
  return stringField(event.payload.runId) ?? stringField(event.scope.runId);
}

function normalizeEvidenceStatus(status: string | undefined): EvidenceRefStatus {
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

function normalizeApprovalRisk(
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

function normalizeFileAction(action: string | undefined): 'created' | 'modified' | 'deleted' {
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

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const parsed = stringField(value);
    if (parsed) return parsed;
  }
  return undefined;
}

function safeAuthorId(value: string): string {
  const id = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return id || AGENT_AUTHOR.id;
}

function numberField(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanField(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function formatCost(value: number | undefined): string | undefined {
  return value == null ? undefined : `$${value.toFixed(2)}`;
}

function durationLabel(durationMs: number | undefined): string | undefined {
  if (durationMs == null) return undefined;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m${remainingSeconds}s`;
}

function diffStat(patch: string, marker: '+' | '-'): number {
  return patch
    .split(/\r?\n/)
    .filter((line) => line.startsWith(marker) && !line.startsWith(`${marker}${marker}${marker}`))
    .length;
}

function cleanText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const text = value.trim();
  return text || undefined;
}

function pathFromContent(content: string | undefined): string | undefined {
  if (!content) return undefined;
  const match = content.match(/(?:^|\s)([A-Za-z]:[\\/][^\s]+|[\w./-]+\.[\w.-]+)/);
  return match?.[1];
}

function errorPayloadMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return (
    stringField(value.message) ??
    stringField(value.Message) ??
    stringField(value.reason) ??
    stringField(value.error)
  );
}

function timestampMs(event: EventEnvelope): number {
  const parsed = Date.parse(event.sentAt);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
