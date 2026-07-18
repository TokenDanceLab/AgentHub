/**
 * DiffReviewPanel types / defaults.
 * Peel companion of DiffReviewPanel (#1151). Pure only; zero behavior change.
 */

import type { DiffHunk } from '../diff';

// ── Side-by-side row types ──────────────────────────────────────────────

export interface SideBySideCell {
  lineNumber?: number;
  content: string;
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
  acceptLine?: string;
  rejectLine?: string;
  applied?: string;
  rejected?: string;
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
  acceptLine: 'Accept line',
  rejectLine: 'Reject line',
  applied: 'Applied',
  rejected: 'Rejected',
};
