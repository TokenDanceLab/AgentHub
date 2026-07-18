/**
 * Edge event → transcript block mappers: agents / subtasks / route / context / result.
 * Peel companion of edgeEventMappers (#1124). Pure only; zero behavior change.
 */

import type { EventEnvelope } from '../events';
import type { EvidenceRefStatus, TranscriptBlock } from './types';
import {
  cleanText,
  durationLabel,
  formatCost,
  numberField,
  stringField,
} from './edgeEventFields';
import {
  agentAuthorFromEvent,
  blockBase,
  eventRunId,
  normalizeEvidenceStatus,
  runEvidence,
} from './edgeEventEvidence';

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
