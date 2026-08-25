import { parseUnifiedPatch, type DiffHunk } from '../diff';
import type { DiffReviewFile } from '../ui/DiffReviewPanelTypes';
import type {
  DiffTranscriptLine,
  FileChangeTranscriptBlock,
  TranscriptBlock,
} from './types';

/**
 * #1967 run-level aggregate review — pure transcript aggregation helpers.
 *
 * Data surface (honest boundary): the workbench keeps each conversation's
 * transcript client-side, and `file_change` blocks are the only transcript
 * surface that carries per-file change content (`patch` and/or `lines`).
 * There is no Hub endpoint that lists a run's aggregated diff (verified:
 * Hub team/task APIs expose events + approvals, not run-level files), so
 * the aggregate is derived from the ACTIVE conversation's transcript —
 * the same boundary workbenchApprovalSummary.ts documents for pending
 * approvals. Grouped runs nest blocks inside `run_step_group.children`,
 * so the collection recurses into those groups.
 *
 * The produced `DiffReviewFile[]` feeds the existing shared
 * `DiffReviewPanel` — no second review state system is introduced: the
 * panel's hunk accept/reject state machine stays the single review
 * contract (#1870).
 */

/** Map a transcript file-change action to the panel's file status. */
export function fileChangeActionToReviewStatus(
  action: FileChangeTranscriptBlock['action'],
): DiffReviewFile['status'] {
  if (action === 'created') return 'added';
  if (action === 'deleted') return 'deleted';
  return 'modified';
}

/** Count added (or deleted) lines across a set of hunks. */
export function countHunkLines(hunks: DiffHunk[], side: 'added' | 'deleted'): number {
  let count = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === side) count += 1;
    }
  }
  return count;
}

/**
 * Build hunks for one file-change block. A unified `patch` wins and is
 * parsed into real hunks; otherwise the block's pre-tokenized `lines`
 * become a single synthetic hunk (the same honest fallback the Web
 * task-contract projection uses); blocks with neither produce no hunks
 * (the file still shows up as a tab with stats only).
 */
export function fileChangeBlockHunks(block: FileChangeTranscriptBlock): DiffHunk[] {
  if (block.patch) {
    const parsed = parseUnifiedPatch(block.patch);
    if (parsed.hunks.length > 0) return parsed.hunks;
  }
  const lines = block.lines;
  if (!lines || lines.length === 0) return [];
  return [{
    header: '@@ transcript file change @@',
    lines: lines.map((line: DiffTranscriptLine) => ({
      type: line.type === 'add' ? 'added' : line.type === 'del' ? 'deleted' : 'context',
      content: line.content,
    })),
  }];
}

/** Project one transcript file-change block into a panel review file. */
export function fileChangeBlockToReviewFile(
  block: FileChangeTranscriptBlock,
): DiffReviewFile {
  const hunks = fileChangeBlockHunks(block);
  const additions = block.additions ?? countHunkLines(hunks, 'added');
  const deletions = block.deletions ?? countHunkLines(hunks, 'deleted');
  return {
    filePath: block.path,
    status: fileChangeActionToReviewStatus(block.action),
    additions,
    deletions,
    hunks,
  };
}

/**
 * Collect the review files of a run from the transcript, recursing into
 * `run_step_group` children. Later changes to the same path supersede
 * earlier ones (the latest state is what a reviewer decides on) while the
 * first-seen file order is preserved for stable tabs.
 */
export function collectRunReviewFiles(blocks: TranscriptBlock[]): DiffReviewFile[] {
  const byPath = new Map<string, DiffReviewFile>();
  const visit = (list: TranscriptBlock[]): void => {
    for (const block of list) {
      if (block.kind === 'file_change') {
        byPath.set(block.path, fileChangeBlockToReviewFile(block));
      } else if (block.kind === 'run_step_group') {
        visit(block.children);
      }
    }
  };
  visit(blocks);
  return Array.from(byPath.values());
}

export interface RunReviewSummary {
  fileCount: number;
  additions: number;
  deletions: number;
  hunkCount: number;
}

/** Aggregate stats over collected run review files. */
export function summarizeRunReviewFiles(files: DiffReviewFile[]): RunReviewSummary {
  let additions = 0;
  let deletions = 0;
  let hunkCount = 0;
  for (const file of files) {
    additions += file.additions;
    deletions += file.deletions;
    hunkCount += file.hunks.length;
  }
  return { fileCount: files.length, additions, deletions, hunkCount };
}
