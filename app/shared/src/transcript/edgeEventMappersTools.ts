/**
 * Edge event → transcript block mappers: tools / file changes.
 * Peel companion of edgeEventMappers (#1124). Pure only; zero behavior change.
 */

import type { EventEnvelope } from '../events';
import { normalize as normalizeDiff } from '../diff';
import type { EvidenceRefStatus, TranscriptBlock } from './types';
import {
  booleanField,
  cleanText,
  diffStat,
  pathFromContent,
  stringField,
} from './edgeEventFields';
import {
  agentAuthorFromEvent,
  blockBase,
  eventRunId,
  fileEvidence,
  normalizeEvidenceStatus,
  normalizeFileAction,
  runEvidence,
  toolEvidence,
} from './edgeEventEvidence';

/** Maximum serialized length for a string argument kept in the projection. */
const INPUT_STRING_LIMIT = 512;
/** Maximum number of scalar arguments kept in the projection. */
const INPUT_ENTRY_LIMIT = 12;

/**
 * Bounded scalar projection of a tool call's raw `input` arguments (#1998,
 * UX F8). Edge adapters emit the parsed tool arguments object on tool_call
 * events (e.g. the Codex goal tools carry `objective` / `status` there),
 * but transcripts must stay light: only flat string / number / boolean
 * entries survive, strings are capped, and at most a handful of entries are
 * kept. Returns undefined when nothing useful remains, so blocks without
 * scalar arguments keep their exact previous shape.
 */
export function scalarToolInputProjection(
  input: unknown,
): Record<string, string | number | boolean> | undefined {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const out: Record<string, string | number | boolean> = {};
  let count = 0;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (count >= INPUT_ENTRY_LIMIT) break;
    if (typeof value === 'string') {
      if (value.length === 0 || value.length > INPUT_STRING_LIMIT) continue;
      out[key] = value;
      count += 1;
      continue;
    }
    if (typeof value === 'boolean') {
      out[key] = value;
      count += 1;
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
      count += 1;
    }
  }
  return count > 0 ? out : undefined;
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

  const inputProjection = scalarToolInputProjection(event.payload.input);

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
    ...(inputProjection ? { input: inputProjection } : {}),
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
