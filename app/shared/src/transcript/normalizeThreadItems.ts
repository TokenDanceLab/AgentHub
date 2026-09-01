import type { EvidenceRef, EvidenceRefStatus, TranscriptAuthor, TranscriptBlock } from './types';
import { isRuntimeDiagnosticText } from './runtimeDiagnostics';

export interface ThreadTranscriptItemInput {
  id?: string;
  itemId?: string;
  threadId?: string;
  kind?: string;
  type?: string;
  role?: string;
  senderName?: string;
  status?: string;
  content?: string;
  runId?: string;
  timestamp?: string;
  createdAt?: string;
  updatedAt?: string;
}

const MESSAGE_TYPES = new Set(['message', 'user_message', 'agent_message', 'assistant_message', 'text_message']);
const SKIPPED_TYPES = new Set(['run']);

export type NormalizeThreadTranslate = (key: string) => string;

export function normalizeThreadItemsToTranscript(
  items: ThreadTranscriptItemInput[] | undefined,
  translate?: NormalizeThreadTranslate,
): TranscriptBlock[] {
  if (!items?.length) return [];

  return items
    .map((item, index) => ({ block: normalizeThreadItem(item, translate), index, timestamp: timestampMs(item) }))
    .filter((entry): entry is { block: TranscriptBlock; index: number; timestamp: number } => Boolean(entry.block))
    .sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      return a.index - b.index;
    })
    .map((entry) => entry.block);
}

function normalizeThreadItem(item: ThreadTranscriptItemInput, translate?: NormalizeThreadTranslate): TranscriptBlock | null {
  const id = item.itemId ?? item.id;
  if (!id) return null;

  const content = item.content?.trim() ?? '';
  if (!content) return null;
  if (isRuntimeDiagnosticText(content)) return null;

  const author = normalizeAuthor(item.role, item.senderName, translate);
  if (!author) return null;

  const itemType = normalizeItemType(item.type ?? item.kind);
  const evidenceRefs = runEvidence(item.runId, item.status);
  const createdAt = item.createdAt ?? item.timestamp ?? item.updatedAt;
  const base = {
    id: `thread-item-${id}`,
    author,
    ...(createdAt ? { createdAt } : {}),
    ...(evidenceRefs.length > 0 ? { evidenceRefs } : {}),
  };

  if (itemType === 'diff') {
    const files = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return {
      ...base,
      kind: 'diff',
      title: files[0] ?? 'Diff',
      files,
    };
  }

  if (itemType === 'approval') {
    return {
      ...base,
      kind: 'approval',
      title: content,
      status: normalizeEvidenceStatus(item.status),
    };
  }

  if (itemType === 'artifact' || itemType === 'file') {
    return {
      ...base,
      kind: 'artifact',
      title: content,
    };
  }

  if (isSkippedType(itemType)) return null;
  if (itemType && !MESSAGE_TYPES.has(itemType)) return null;

  return {
    ...base,
    kind: 'text',
    text: content,
  };
}

function normalizeAuthor(role: string | undefined, senderName?: string, translate?: NormalizeThreadTranslate): TranscriptAuthor | null {
  switch (role?.trim()) {
    case 'user':
    case 'human':
      return { id: 'user', name: senderName?.trim() || translate?.('transcript.userFallback') || '用户', role: 'human' };
    case 'agent':
    case 'assistant':
      return { id: senderName?.trim() || 'agent', name: senderName?.trim() || 'Agent', role: 'agent' };
    case 'system':
      return { id: 'system', name: 'AgentHub', role: 'system' };
    default:
      // system messages (run queued, etc.) — skip
      return null;
  }
}

function normalizeItemType(type: string | undefined): string | undefined {
  return type?.trim().toLowerCase() || undefined;
}

function isSkippedType(itemType: string | undefined): boolean {
  return itemType ? SKIPPED_TYPES.has(itemType) : false;
}

function runEvidence(runId: string | undefined, status: string | undefined): EvidenceRef[] {
  const normalizedRunId = runId?.trim();
  if (!normalizedRunId) return [];
  return [{
    id: `run-${normalizedRunId}`,
    kind: 'run',
    label: `Run ${normalizedRunId}`,
    status: normalizeEvidenceStatus(status),
  }];
}

function normalizeEvidenceStatus(status: string | undefined): EvidenceRefStatus {
  switch (status?.trim()) {
    case 'pending':
    case 'queued':
      return 'pending';
    case 'running':
    case 'starting':
      return 'running';
    case 'failed':
    case 'cancelled':
      return 'failed';
    case 'completed':
    case 'finished':
    case 'approved':
    case 'rejected':
    default:
      return 'completed';
  }
}

function timestampMs(item: ThreadTranscriptItemInput): number {
  const parsed = Date.parse(item.createdAt ?? item.timestamp ?? item.updatedAt ?? '');
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}
