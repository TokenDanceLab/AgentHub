/**
 * Edge event → transcript block mappers: permission request / decision.
 * Peel companion of edgeEventMappers (#1124). Pure only; zero behavior change.
 */

import type { EventEnvelope } from '../events';
import type { EvidenceRefStatus, TranscriptBlock } from './types';
import {
  cleanText,
  stringField,
} from './edgeEventFields';
import {
  EDGE_AUTHOR,
  approvalEvidence,
  approvalHubContext,
  blockBase,
  eventRunId,
  normalizeApprovalRisk,
  runEvidence,
} from './edgeEventEvidence';

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
