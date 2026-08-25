/**
 * Edge event → transcript block mappers: run lifecycle / text / thinking.
 * Peel companion of edgeEventMappers (#1124). Pure only; zero behavior change.
 */

import type { EventEnvelope } from '../events';
import type { EvidenceRefStatus, TranscriptBlock } from './types';
import { isRuntimeDiagnosticText } from './runtimeDiagnostics';
import {
  cleanText,
  durationLabel,
  errorPayloadMessage,
  isRecord,
  numberField,
  stringField,
} from './edgeEventFields';
import {
  EDGE_AUTHOR,
  agentAuthorFromEvent,
  blockBase,
  eventRunId,
  eventRunWorkDir,
  normalizeEvidenceStatus,
  runEvidence,
} from './edgeEventEvidence';
import type { CheckpointTranscriptBlock } from './types';

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
    ...blockBase(event, EDGE_AUTHOR, runEvidence(runId, status, eventRunWorkDir(event))),
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
    ...blockBase(event, EDGE_AUTHOR, runEvidence(runId, status, eventRunWorkDir(event))),
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
    ...blockBase(event, EDGE_AUTHOR, runEvidence(runId, 'failed', eventRunWorkDir(event))),
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
    ...blockBase(event, EDGE_AUTHOR, runEvidence(runId, 'failed', eventRunWorkDir(event))),
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
    ...blockBase(event, EDGE_AUTHOR, runEvidence(runId, 'completed', eventRunWorkDir(event))),
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
    ...blockBase(event, EDGE_AUTHOR, runEvidence(runId ?? event.id, 'running', eventRunWorkDir(event))),
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
    ...blockBase(event, EDGE_AUTHOR, runEvidence(runId ?? event.id, 'running', eventRunWorkDir(event))),
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
    ...blockBase(event, agentAuthorFromEvent(event), runEvidence(runId ?? event.id, 'running', eventRunWorkDir(event))),
    kind: 'text',
    text,
  };
}

export function checkpointBlock(event: EventEnvelope): CheckpointTranscriptBlock | null {
  const runId = eventRunId(event);
  const checkpointId = stringField(event.payload.checkpointId);
  if (!runId || !checkpointId) {
    console.warn('normalizeEdgeEvents: run.checkpoint missing runId/checkpointId', { eventId: event.id });
    return null;
  }
  // The checkpoint ref doubles as run evidence: it carries the executor-
  // reported workDir so run-level review/applies can trust it (#1967/#1968).
  return {
    ...blockBase(event, EDGE_AUTHOR, runEvidence(runId, 'running', eventRunWorkDir(event))),
    kind: 'checkpoint',
    runId,
    checkpointId,
    fileCount: numberField(event.payload.fileCount) ?? 0,
    totalBytes: numberField(event.payload.totalBytes) ?? 0,
  };
}

export function thinkingBlock(event: EventEnvelope): TranscriptBlock | null {
  const content = cleanText(stringField(event.payload.content));
  if (!content) return null;
  const runId = eventRunId(event);
  const status = normalizeEvidenceStatus(stringField(event.payload.status) ?? 'running');

  return {
    ...blockBase(event, agentAuthorFromEvent(event), runEvidence(runId, status, eventRunWorkDir(event))),
    kind: 'thinking',
    content,
    isThinking: status === 'running',
  };
}
