import type { TranscriptBlock } from '@shared/transcript';

/**
 * #1819 pending-approval reminder — pure aggregation helpers.
 *
 * Data surface (honest boundary, no new endpoint): the workbench keeps each
 * conversation's transcript client-side. Grouped runs nest request blocks
 * inside `run_step_group.children`, so the aggregation recurses into those
 * groups. There is no Hub endpoint that lists pending approvals across
 * sessions (verified: listTaskApprovals is per-task; team approvals are per
 * team-run; Hub notifications never carry approval types), so the badge/
 * count/toast covers the ACTIVE conversation only. Cross-session attention
 * (rail badge / status-strip counts / sidebar live dots) is derived in
 * workbenchAttentionModel.ts from the shell-provided run/approval/thread
 * model arrays instead of a backend aggregation endpoint.
 */

/**
 * Whether a transcript block represents an approval request still awaiting a
 * decision. `permission_request` blocks are always pending; the legacy
 * `approval` block kind is pending only when its EvidenceRefStatus is
 * 'pending'. This matches what the UI treats as waiting approvals.
 */
export function isPendingApprovalBlock(block: TranscriptBlock): boolean {
  if (block.kind === 'permission_request') return true;
  return block.kind === 'approval' && block.status === 'pending';
}

function collectPendingApprovalBlocks(blocks: TranscriptBlock[]): TranscriptBlock[] {
  const out: TranscriptBlock[] = [];
  for (const block of blocks) {
    if (isPendingApprovalBlock(block)) {
      out.push(block);
    } else if (block.kind === 'run_step_group') {
      out.push(...collectPendingApprovalBlocks(block.children));
    }
  }
  return out;
}

/** Number of pending approval requests in the transcript (groups included). */
export function countPendingApprovals(blocks: TranscriptBlock[]): number {
  return collectPendingApprovalBlocks(blocks).length;
}

/** Block id of the first pending approval request (group order preserved). */
export function firstPendingApprovalBlockId(blocks: TranscriptBlock[]): string | undefined {
  return collectPendingApprovalBlocks(blocks)[0]?.id;
}
