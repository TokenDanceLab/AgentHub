/**
 * DiffReviewPanel types / defaults.
 * Peel companion of DiffReviewPanel (#1151). Pure only; zero behavior change.
 */

import type { DiffHunk } from '../diff';

// ── Side-by-side row types ──────────────────────────────────────────────

/**
 * A single word-diff token (P6 Step 2).
 *
 * Lifted here from `diffWordTokens.ts` so it lives beside the diff-row types
 * that consume it (`SideBySideCell.wordDiff`). `diffWordTokens.ts` re-exports
 * it for backward compatibility with its existing callers/tests.
 *
 *  - `context` = unchanged run, shared by both old and new
 *  - `removed` = exists only in old
 *  - `added`   = exists only in new
 */
export interface WordDiffToken {
  type: 'added' | 'removed' | 'context';
  text: string;
}

export interface SideBySideCell {
  lineNumber?: number;
  content: string;
  /**
   * Word-diff tokens for a modified row pair (P6 Step 2). Filled only on the
   * `modified` rowType by `buildSideBySideRows`; `undefined` on
   * added/deleted/context cells and when the size guard skips word-diff.
   *
   * Per-column split (report §4.1): the left cell holds `removed`+`context`
   * tokens (joining reproduces `content`); the right cell holds
   * `added`+`context`. `null` is permitted because `produceWordDiffTokens`
   * may return null under its size guard.
   *
   * Consumed by the renderer via `highlightLineWithWordDiff`
   * (prismRegistry.ts HAST word-diff injector, P6 Step 3).
   */
  wordDiff?: WordDiffToken[] | null;
}

export interface SideBySideRow {
  left: SideBySideCell | null;
  right: SideBySideCell | null;
  /** The semantic change type of this row pair */
  rowType: 'added' | 'deleted' | 'modified' | 'context';
  /** Original line index in the hunk for left content */
  leftLineIndex?: number;
  /** Original line index in the hunk for right content */
  rightLineIndex?: number;
}

// ── Public props ────────────────────────────────────────────────────────

export interface DiffReviewFile {
  filePath: string;
  status: 'added' | 'deleted' | 'modified' | 'untracked';
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface DiffReviewLabels {
  empty?: string;
  original?: string;
  modified?: string;
  acceptAll?: string;
  rejectAll?: string;
  acceptHunk?: string;
  rejectHunk?: string;
  applied?: string;
  rejected?: string;
  submitting?: string;
  /**
   * Run-level toolbar (#1967): title for the whole-run change aggregate,
   * batch accept/reject across every file's hunks, and an optional
   * host-interpolated summary line (e.g. "3 files · +12 −5").
   */
  runTitle?: string;
  runSummary?: string;
  acceptRun?: string;
  rejectRun?: string;
}

export interface DiffHunkDecision {
  filePath: string;
  hunkIndex: number;
  accepted: boolean;
}

export interface DiffReviewPanelProps {
  files: DiffReviewFile[];
  /** Edge run ID — required for applying hunks via Edge API. */
  runId?: string;
  onAcceptAll?: () => void;
  onRejectAll?: () => void;
  /** Called when a single hunk is accepted or rejected. Implementor calls Edge POST /v1/runs/:id/apply. */
  onApplyHunk?: (decision: DiffHunkDecision) => void | Promise<void>;
  /** Called when all hunks are accepted or rejected in batch. */
  onApplyAllHunks?: (decisions: DiffHunkDecision[]) => void | Promise<void>;
  /**
   * Run-level review (#1967): render the whole-run summary toolbar above
   * the file tabs. Accept/reject-run commits every hunk of every file
   * through the SAME hunk state machine + `onApplyAllHunks` port as the
   * per-file batch — no second review state system.
   */
  runLevel?: boolean;
  /** Notified after a run-level accept (batch commit already dispatched). */
  onAcceptRun?: () => void;
  /** Notified after a run-level reject (batch commit already dispatched). */
  onRejectRun?: () => void;
  labels?: DiffReviewLabels;
  /** When set, the panel will switch to the tab matching this file path. */
  focusedFilePath?: string;
  className?: string;
  fileTabsClassName?: string;
  fileTabClassName?: string;
  activeFileTabClassName?: string;
  toolbarClassName?: string;
  diffContentClassName?: string;
  diffRowClassName?: string;
  lineActionBtnClassName?: string;
}

export const DEFAULT_LABELS: Required<DiffReviewLabels> = {
  empty: 'No changes to review',
  original: 'Original',
  modified: 'Modified',
  acceptAll: 'Accept All',
  rejectAll: 'Reject All',
  acceptHunk: 'Accept hunk',
  rejectHunk: 'Reject hunk',
  applied: 'Applied',
  rejected: 'Rejected',
  submitting: 'Submitting...',
  runTitle: 'All changes in this run',
  runSummary: '',
  acceptRun: 'Accept run',
  rejectRun: 'Reject run',
};
