/**
 * Edge event → transcript block mappers: artifacts / preview.
 * Peel companion of edgeEventMappers (#1124). Pure only; zero behavior change.
 */

import type { EventEnvelope } from '../events';
import type { TranscriptBlock } from './types';
import { stringField } from './edgeEventFields';
import {
  EDGE_AUTHOR,
  agentAuthorFromEvent,
  blockBase,
  eventRunId,
  normalizeEvidenceStatus,
  runEvidence,
} from './edgeEventEvidence';

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
