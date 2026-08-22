import type { RuntimeEvidenceSnapshot } from '@agenthub/workbench';
import {
  WORKBENCH_DEMO_FALLBACK_CONVERSATION_ID,
  isWorkbenchRealDataMode,
  resolveWorkbenchDataMode,
  resolveDemoWorkbenchTranscript,
} from '@shared/demo';
import {
  normalizeHubMessagesToTranscript,
  normalizeHubRuntimeEventsToTranscript,
  orderTranscriptBlocks,
  collectTranscriptEvidence,
  resolveCurrentTranscriptRunId,
  type HubMessageTranscriptInput,
  type HubRuntimeEventTranscriptInput,
  type TranscriptBlock,
} from '@shared/transcript';
import type { FileDiff } from '@shared/types/chat';
import { webHubEmptyTranscript } from './webPlatform';
import { errorMessage } from './webWorkbenchError';

export function resolveWebRuntimeEvidence(transcript: TranscriptBlock[]): RuntimeEvidenceSnapshot {
  const runId = resolveCurrentTranscriptRunId(transcript);
  const evidence = collectTranscriptEvidence(transcript);
  const fileChangeBlocks = transcript.filter((block): block is Extract<TranscriptBlock, { kind: 'file_change' }> =>
    block.kind === 'file_change'
  );
  const artifactBlocks = transcript.filter((block): block is Extract<TranscriptBlock, { kind: 'artifact' }> =>
    block.kind === 'artifact'
  );
  const previewBlocks = transcript.filter((block): block is Extract<TranscriptBlock, { kind: 'preview' }> =>
    block.kind === 'preview'
  );
  const artifacts = artifactBlocks.map((block) => ({
    id: block.artifactId ?? artifactIdFromEvidence(block.evidenceRefs?.find((ref) => ref.kind === 'artifact')?.id) ?? block.id,
    runId: artifactRunId(block, runId),
    threadId: block.threadId ?? '',
    kind: block.artifactKind ?? 'artifact',
    path: block.path ?? block.title,
    sizeBytes: 0,
    createdAt: block.createdAt ?? '',
  }));
  const diffs = fileChangeBlocks
    .filter((block) => block.patch || block.lines?.length || block.editId || block.reviewStatus)
    .map(fileChangeBlockToDiff);
  const previews = previewBlocks.map((block) => ({
    id: block.previewId,
    runId: previewRunId(block, runId),
    threadId: block.threadId ?? '',
    ...(block.url ? { url: block.url } : {}),
    status: previewStatus(block.status),
    createdAt: block.createdAt ?? '',
  }));
  return {
    ...(runId ? { runId } : {}),
    diffs,
    artifacts,
    previews,
    sources: {
      diff: diffs.length > 0 ? 'event' : 'none',
      artifacts: evidence.some((ref) => ref.kind === 'artifact') ? 'event' : 'none',
      previews: evidence.some((ref) => ref.kind === 'preview') ? 'event' : 'none',
    },
  };
}

function fileChangeBlockToDiff(block: Extract<TranscriptBlock, { kind: 'file_change' }>): FileDiff {
  return {
    filePath: block.path,
    status: fileDiffStatus(block.action),
    additions: block.additions ?? block.lines?.filter((line) => line.type === 'add').length ?? 0,
    deletions: block.deletions ?? block.lines?.filter((line) => line.type === 'del').length ?? 0,
    hunks: [{
      header: '@@ Hub task file change @@',
      lines: (block.lines ?? []).map((line) => ({
        type: line.type === 'add' ? 'added' : line.type === 'del' ? 'deleted' : 'context',
        content: line.content,
      })),
    }],
    ...(block.editId ? { editId: block.editId } : {}),
    ...(block.reviewStatus ? { reviewStatus: block.reviewStatus } : {}),
    ...(block.canApply != null ? { canApply: block.canApply } : {}),
    ...(block.canRevert != null ? { canRevert: block.canRevert } : {}),
  };
}

function fileDiffStatus(action: Extract<TranscriptBlock, { kind: 'file_change' }>['action']): FileDiff['status'] {
  if (action === 'created') return 'added';
  if (action === 'deleted') return 'deleted';
  return 'modified';
}

function artifactIdFromEvidence(id: string | undefined): string | undefined {
  if (!id?.startsWith('artifact-')) return undefined;
  return id.slice('artifact-'.length);
}

function artifactRunId(block: Extract<TranscriptBlock, { kind: 'artifact' }>, fallback: string | undefined): string {
  return block.evidenceRefs
    ?.find((ref) => ref.kind === 'run')
    ?.id
    .replace(/^run-/, '') ?? fallback ?? '';
}

function previewRunId(block: Extract<TranscriptBlock, { kind: 'preview' }>, fallback: string | undefined): string {
  return block.evidenceRefs
    ?.find((ref) => ref.kind === 'run')
    ?.id
    .replace(/^run-/, '') ?? fallback ?? '';
}

function previewStatus(status: string): 'starting' | 'ready' | 'stopped' {
  if (status === 'running' || status === 'pending') return 'starting';
  if (status === 'failed') return 'stopped';
  return 'ready';
}

export function resolveWebTaskContractStatusBlocks(
  taskId: string | undefined,
  approvalError: unknown,
  artifactError: unknown,
): TranscriptBlock[] {
  if (!taskId) return [];
  const blocks: TranscriptBlock[] = [];
  if (approvalError) {
    blocks.push(webTaskContractErrorBlock(
      'approvals',
      taskId,
      `Hub task approvals unavailable: ${errorMessage(approvalError, 'approval endpoint failed')}`,
    ));
  }
  if (artifactError) {
    blocks.push(webTaskContractErrorBlock(
      'artifacts',
      taskId,
      `Hub task artifacts unavailable: ${errorMessage(artifactError, 'artifact endpoint failed')}`,
    ));
  }
  return blocks;
}

function webTaskContractErrorBlock(channel: 'approvals' | 'artifacts', taskId: string, text: string): TranscriptBlock {
  return {
    id: `web-hub-taskctr-${channel}-${taskId}`,
    kind: 'text',
    author: { id: 'hub-taskctr', name: 'Hub task contract', role: 'system' },
    text,
    badgeLabel: 'Hub task error',
    badgeVariant: 'danger',
  };
}

export function resolveWebWorkbenchTranscript(
  hubReady: boolean,
  activeHubSessionId: string | null,
  messages: HubMessageTranscriptInput[] | undefined,
  liveRuntimeEvents: HubRuntimeEventTranscriptInput[],
  dataMode = resolveWorkbenchDataMode(import.meta.env.VITE_AGENTHUB_DATA_MODE),
  conversationId?: string,
  t?: (key: string) => string,
): TranscriptBlock[] {
  if (!hubReady) {
    return isWorkbenchRealDataMode(dataMode)
      ? webHubEmptyTranscript
      : resolveDemoWorkbenchTranscript(conversationId || WORKBENCH_DEMO_FALLBACK_CONVERSATION_ID);
  }
  if (activeHubSessionId) {
    return orderTranscriptBlocks([
      ...normalizeHubMessagesToTranscript(messages, t),
      ...normalizeHubRuntimeEventsToTranscript(liveRuntimeEvents),
    ]);
  }
  return isWorkbenchRealDataMode(dataMode)
    ? webHubEmptyTranscript
    : resolveDemoWorkbenchTranscript(conversationId || WORKBENCH_DEMO_FALLBACK_CONVERSATION_ID);
}

/**
 * Messages to feed the transcript projection (#1821 session-switch flash).
 * While the messages query shows `placeholderData`, the rows still belong to
 * the previous session — hide them until the new session's own rows arrive
 * instead of flashing stale messages.
 */
export function resolveWebTranscriptMessages(
  isPlaceholderData: boolean,
  messages: HubMessageTranscriptInput[] | undefined,
): HubMessageTranscriptInput[] | undefined {
  return isPlaceholderData ? undefined : messages;
}
