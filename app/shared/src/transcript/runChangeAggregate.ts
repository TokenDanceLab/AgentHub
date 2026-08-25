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
 * the aggregate is derived from the ACTIVE conversation's transcript. Edge
 * blocks carry a `kind=run` evidence ref; that ref is the grouping boundary.
 * We select one current/latest run and never merge different run refs. Legacy
 * blocks without run evidence use an explicit conversation-level fallback —
 * callers must not present that fallback as one run. Grouped runs nest blocks
 * inside `run_step_group.children`, so collection recurses into those groups.
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

export type RunReviewScope = 'run' | 'legacy' | 'none';

export interface RunReviewSelection {
  /** One evidence-backed run, a legacy conversation fallback, or no files. */
  scope: RunReviewScope;
  /** Exact `EvidenceRef.id` used as the single-run grouping key. */
  runEvidenceId?: string | undefined;
  files: DiffReviewFile[];
}

interface FileChangeFragment {
  block: FileChangeTranscriptBlock;
  sequence: number;
}

interface FileChangeAccumulator {
  edits: Map<string, Map<string, FileChangeFragment>>;
  latestBlock: FileChangeTranscriptBlock;
  lastSeen: number;
}

interface RunBucket {
  files: Map<string, FileChangeAccumulator>;
  lastSeen: number;
  status?: 'pending' | 'running' | 'completed' | 'failed' | undefined;
}

function runEvidence(block: TranscriptBlock) {
  return block.evidenceRefs?.find((ref) => ref.kind === 'run');
}

function fileChangeFingerprint(block: FileChangeTranscriptBlock): string {
  if (block.patch) return `patch:${block.patch}`;
  if (block.lines) return `lines:${JSON.stringify(block.lines)}`;
  return `metadata:${block.action}:${block.additions ?? ''}:${block.deletions ?? ''}`;
}

function addFileChange(
  files: Map<string, FileChangeAccumulator>,
  block: FileChangeTranscriptBlock,
  sequence: number,
): void {
  const accumulator = files.get(block.path) ?? {
    edits: new Map(),
    latestBlock: block,
    lastSeen: sequence,
  };
  const editKey = block.editId?.trim() ? `edit:${block.editId.trim()}` : `event:${block.id}`;
  const fragments = accumulator.edits.get(editKey) ?? new Map<string, FileChangeFragment>();
  const fingerprint = fileChangeFingerprint(block);
  const existing = fragments.get(fingerprint);
  fragments.set(fingerprint, { block, sequence: existing?.sequence ?? sequence });
  accumulator.edits.set(editKey, fragments);
  if (sequence >= accumulator.lastSeen) {
    accumulator.latestBlock = block;
    accumulator.lastSeen = sequence;
  }
  files.set(block.path, accumulator);
}

function accumulatedFileToReviewFile(accumulator: FileChangeAccumulator): DiffReviewFile {
  const fragments = Array.from(accumulator.edits.values())
    .flatMap((edit) => Array.from(edit.values()))
    .sort((a, b) => a.sequence - b.sequence);
  const uniqueHunks = new Map<string, DiffHunk>();
  for (const fragment of fragments) {
    for (const hunk of fileChangeBlockHunks(fragment.block)) {
      const fingerprint = JSON.stringify({ header: hunk.header, lines: hunk.lines });
      if (!uniqueHunks.has(fingerprint)) uniqueHunks.set(fingerprint, hunk);
    }
  }
  const hunks = Array.from(uniqueHunks.values());
  const latest = accumulator.latestBlock;
  return {
    filePath: latest.path,
    status: fileChangeActionToReviewStatus(latest.action),
    additions: hunks.length > 0
      ? countHunkLines(hunks, 'added')
      : (latest.additions ?? 0),
    deletions: hunks.length > 0
      ? countHunkLines(hunks, 'deleted')
      : (latest.deletions ?? 0),
    hunks,
  };
}

function materializeFiles(files: Map<string, FileChangeAccumulator>): DiffReviewFile[] {
  return Array.from(files.values()).map(accumulatedFileToReviewFile);
}

/**
 * Select one review scope from the transcript. Evidence-backed file changes
 * are grouped by run ref and NEVER combined across run ids. A still-active
 * run (pending/running final evidence status) wins; otherwise the latest run
 * carrying file changes wins. Only when no file change has run evidence do we
 * fall back to legacy conversation-level aggregation.
 */
export function selectRunReview(blocks: TranscriptBlock[]): RunReviewSelection {
  const runs = new Map<string, RunBucket>();
  const legacyFiles = new Map<string, FileChangeAccumulator>();
  let sequence = 0;

  const visit = (list: TranscriptBlock[]): void => {
    for (const block of list) {
      sequence += 1;
      const evidence = runEvidence(block);
      if (evidence) {
        const bucket: RunBucket = runs.get(evidence.id) ?? {
          files: new Map<string, FileChangeAccumulator>(),
          lastSeen: sequence,
        };
        bucket.lastSeen = sequence;
        bucket.status = evidence.status;
        runs.set(evidence.id, bucket);
      }

      if (block.kind === 'file_change') {
        if (evidence) {
          const bucket = runs.get(evidence.id)!;
          addFileChange(bucket.files, block, sequence);
        } else {
          addFileChange(legacyFiles, block, sequence);
        }
      } else if (block.kind === 'run_step_group') {
        visit(block.children);
      }
    }
  };
  visit(blocks);

  const runsWithFiles = Array.from(runs.entries()).filter(([, bucket]) => bucket.files.size > 0);
  const activeRuns = runsWithFiles.filter(([, bucket]) => (
    bucket.status === 'pending' || bucket.status === 'running'
  ));
  const candidates = activeRuns.length > 0 ? activeRuns : runsWithFiles;
  const selected = candidates.reduce<(typeof candidates)[number] | undefined>((latest, candidate) => (
    !latest || candidate[1].lastSeen > latest[1].lastSeen ? candidate : latest
  ), undefined);

  if (selected) {
    return {
      scope: 'run',
      runEvidenceId: selected[0],
      files: materializeFiles(selected[1].files),
    };
  }
  if (legacyFiles.size > 0) {
    return { scope: 'legacy', files: materializeFiles(legacyFiles) };
  }
  return { scope: 'none', files: [] };
}

/**
 * Collect files for the selected single-run/legacy scope. Prefer
 * `selectRunReview` when the caller must render the scope honestly.
 */
export function collectRunReviewFiles(blocks: TranscriptBlock[]): DiffReviewFile[] {
  return selectRunReview(blocks).files;
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
