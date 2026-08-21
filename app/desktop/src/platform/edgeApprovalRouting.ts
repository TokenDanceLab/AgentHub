// Routing helper for local Edge permission approvals (#1816 W1).
//
// The shared approval card dispatches an ApprovalDecisionAction that carries
// the requestId (the permission request id) but no Edge runId. The run that
// owns the request is recorded on the permission_request transcript block as
// a `run` evidence ref (`run-<runId>`); this helper recovers it so the shell
// can call edgeClient.decidePermission({ runId, requestId, decision }).

import { rawRunIdFromEvidenceId } from '@shared/transcript';
import type { TranscriptBlock } from '@shared/transcript';

function runIdFromPermissionBlock(block: Extract<TranscriptBlock, { kind: 'permission_request' }>): string | undefined {
  const runRef = (block.evidenceRefs ?? []).find((ref) => ref.kind === 'run');
  if (!runRef) return undefined;
  return rawRunIdFromEvidenceId(runRef.id);
}

function scanBlocksForPermissionRunId(blocks: TranscriptBlock[], requestId: string): string | undefined {
  // Scan newest-first: the card the user just acted on sits at the tail.
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (!block) continue;
    if (block.kind === 'run_step_group') {
      const childRunId = scanBlocksForPermissionRunId(block.children, requestId);
      if (childRunId) return childRunId;
      continue;
    }
    if (block.kind !== 'permission_request' || block.requestId !== requestId) continue;
    const runId = runIdFromPermissionBlock(block);
    if (runId) return runId;
  }
  return undefined;
}

/**
 * Resolve the Edge runId that owns a pending permission request by locating
 * the matching `permission_request` block in the transcript and reading its
 * run evidence ref. Returns undefined when no block (or no run evidence)
 * matches — callers fall back to the transcript's current run id.
 */
export function resolveEdgePermissionRunId(
  transcript: TranscriptBlock[],
  requestId: string,
): string | undefined {
  return scanBlocksForPermissionRunId(transcript, requestId);
}
