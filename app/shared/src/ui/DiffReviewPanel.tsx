/**
 * DiffReviewPanel public surface — side-by-side diff review with hunk accept-reject.
 * Residual pure-helper peel of DiffReviewPanel (#1151).
 *
 * Implementations live in companions (DiffReviewPanelTypes / DiffReviewPanelHelpers /
 * DiffReviewPanelParts); this file keeps the public orchestrator so consumers
 * importing from `./DiffReviewPanel` remain stable.
 *
 * #1870: the review unit is a HUNK (the backend Edge apply contract is
 * hunk-indexed), not a single line. The panel therefore keeps hunk-level
 * state and drives a hunk write-back state machine:
 *   idle -> submitting -> applied/rejected | rolled-back-on-failure.
 */

import { useState, useMemo, useCallback, useEffect, useId } from 'react';
import { cx } from './cx';
import { languageFromPath } from './syntaxHighlight';
import styles from './DiffReviewPanel.module.css';
import {
  buildRowToHunkIndex,
  buildSideBySideRows,
  hunkStateKey,
} from './DiffReviewPanelHelpers';
import {
  DiffReviewFileTabs,
  DiffReviewSideColumn,
  DiffReviewToolbar,
} from './DiffReviewPanelParts';
import {
  DEFAULT_LABELS,
  type DiffHunkDecision,
  type DiffReviewPanelProps,
} from './DiffReviewPanelTypes';

// Re-export public types for consumers (index.ts / direct imports)
export type {
  DiffReviewFile,
  DiffReviewLabels,
  DiffHunkDecision,
  DiffReviewPanelProps,
} from './DiffReviewPanelTypes';

/** Committed + transient write-back state for one hunk. */
type HunkState = 'applied' | 'rejected' | 'submitting';

// ── DiffReviewPanel ────────────────────────────────────────────────────

export function DiffReviewPanel({
  files,
  runId,
  onAcceptAll,
  onRejectAll,
  onApplyHunk,
  onApplyAllHunks,
  labels: customLabels,
  focusedFilePath,
  className,
  fileTabsClassName,
  fileTabClassName,
  activeFileTabClassName,
  toolbarClassName,
  diffContentClassName,
  diffRowClassName,
  lineActionBtnClassName,
}: DiffReviewPanelProps) {
  const labels = { ...DEFAULT_LABELS, ...customLabels };

  const [activeFileIndex, setActiveFileIndex] = useState(0);
  // Hunk-level state: 'applied' | 'rejected' after write-back, 'submitting'
  // while an Edge apply is in flight. Line-level accept/reject is gone (#1870).
  const [hunkStates, setHunkStates] = useState<Record<string, HunkState>>({});

  // When focusedFilePath changes from outside, switch to matching tab
  useEffect(() => {
    if (!focusedFilePath) return;
    const idx = files.findIndex(
      (f) => f.filePath === focusedFilePath || f.filePath.endsWith(focusedFilePath),
    );
    if (idx >= 0) {
      setActiveFileIndex(idx);
    }
  }, [focusedFilePath, files]);

  // Clamp active index to valid range
  const safeIndex = Math.max(0, Math.min(activeFileIndex, files.length - 1));
  const activeFile = files[safeIndex];

  // Build side-by-side rows for the active file
  const sideBySideRows = useMemo(() => {
    if (!activeFile) return [];
    return activeFile.hunks.flatMap((hunk) => buildSideBySideRows(hunk));
  }, [activeFile]);

  // Detect language for syntax highlighting
  const activeLang = useMemo(
    () => (activeFile ? languageFromPath(activeFile.filePath) : ''),
    [activeFile],
  );

  // Compute modified lines count
  const modifiedCount = useMemo(() => {
    if (!activeFile) return 0;
    return sideBySideRows.filter((r) => r.rowType === 'modified').length;
  }, [sideBySideRows, activeFile]);

  // Hunk state key helper: "filePath:hunkIndex"
  const hunkKey = useCallback(
    (filePath: string, hunkIndex: number) => hunkStateKey(filePath, hunkIndex),
    [],
  );

  // Build hunk index mapping: maps row index to hunk index for the active file
  const rowToHunkIndex = useMemo(() => {
    if (!activeFile) return new Map<number, number>();
    return buildRowToHunkIndex(activeFile.hunks);
  }, [activeFile]);

  // Commit one hunk decision.
  //   - Without an Edge write-back port: toggle local review state (read-only).
  //   - With write-back: submitting -> applied/rejected, or roll back on failure.
  const commitHunkDecision = useCallback(
    async (filePath: string, hunkIndex: number, accepted: boolean) => {
      const key = hunkKey(filePath, hunkIndex);
      const target: HunkState = accepted ? 'applied' : 'rejected';
      const applyHunk = onApplyHunk;

      if (!applyHunk || !runId) {
        // Read-only review: no Edge write-back, just mark locally.
        setHunkStates((prev) => ({ ...prev, [key]: target }));
        return;
      }

      setHunkStates((prev) => ({ ...prev, [key]: 'submitting' }));
      try {
        await applyHunk({ filePath, hunkIndex, accepted });
        setHunkStates((prev) => ({ ...prev, [key]: target }));
      } catch {
        setHunkStates((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    },
    [hunkKey, onApplyHunk, runId],
  );

  // Batch commit every hunk with the same decision.
  const commitAllHunks = useCallback(
    async (accepted: boolean) => {
      if (!activeFile) return;
      const decisions: DiffHunkDecision[] = activeFile.hunks.map((_hunk, hunkIdx) => ({
        filePath: activeFile.filePath,
        hunkIndex: hunkIdx,
        accepted,
      }));
      if (decisions.length === 0) return;

      const target: HunkState = accepted ? 'applied' : 'rejected';
      const keys = decisions.map((d) => hunkKey(d.filePath, d.hunkIndex));
      const applyAllHunks = onApplyAllHunks;

      if (!applyAllHunks || !runId) {
        setHunkStates((prev) => {
          const next = { ...prev };
          for (const key of keys) next[key] = target;
          return next;
        });
        return;
      }

      setHunkStates((prev) => {
        const next = { ...prev };
        for (const key of keys) next[key] = 'submitting';
        return next;
      });
      try {
        await applyAllHunks(decisions);
        setHunkStates((prev) => {
          const next = { ...prev };
          for (const key of keys) next[key] = target;
          return next;
        });
      } catch {
        setHunkStates((prev) => {
          const next = { ...prev };
          for (const key of keys) delete next[key];
          return next;
        });
      }
    },
    [activeFile, hunkKey, onApplyAllHunks, runId],
  );

  const handleAcceptAll = useCallback(() => {
    void commitAllHunks(true);
    onAcceptAll?.();
  }, [commitAllHunks, onAcceptAll]);

  const handleRejectAll = useCallback(() => {
    void commitAllHunks(false);
    onRejectAll?.();
  }, [commitAllHunks, onRejectAll]);

  const handleAcceptClick = useCallback(
    (rowIndex: number) => {
      if (!activeFile) return;
      const hunkIdx = rowToHunkIndex.get(rowIndex);
      if (hunkIdx == null) return;
      const key = hunkKey(activeFile.filePath, hunkIdx);
      const state = hunkStates[key];
      if (state === 'submitting' || state === 'applied') return;
      void commitHunkDecision(activeFile.filePath, hunkIdx, true);
    },
    [activeFile, rowToHunkIndex, hunkKey, hunkStates, commitHunkDecision],
  );

  const handleRejectClick = useCallback(
    (rowIndex: number) => {
      if (!activeFile) return;
      const hunkIdx = rowToHunkIndex.get(rowIndex);
      if (hunkIdx == null) return;
      const key = hunkKey(activeFile.filePath, hunkIdx);
      const state = hunkStates[key];
      if (state === 'submitting' || state === 'rejected') return;
      void commitHunkDecision(activeFile.filePath, hunkIdx, false);
    },
    [activeFile, rowToHunkIndex, hunkKey, hunkStates, commitHunkDecision],
  );

  const activeFilePath = activeFile?.filePath ?? '';
  const hunkKeyFor = useCallback(
    (hunkIndex: number) => hunkKey(activeFilePath, hunkIndex),
    [hunkKey, activeFilePath],
  );

  // ── Tabpanel id prefix (#1823) ───────────────────────────────────────
  const tabsId = useId();

  // ── Empty state ──────────────────────────────────────────────────────

  if (files.length === 0 || !activeFile) {
    return (
      <div className={cx(styles.root, className)} data-testid="diff-review-panel">
        <div className={styles.empty}>{labels.empty}</div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className={cx(styles.root, className)} data-testid="diff-review-panel">
      {/* ── File tabs ─────────────────────────────── */}
      <DiffReviewFileTabs
        files={files}
        safeIndex={safeIndex}
        tabsId={tabsId}
        fileTabsClassName={fileTabsClassName}
        fileTabClassName={fileTabClassName}
        activeFileTabClassName={activeFileTabClassName}
        onSelectFile={setActiveFileIndex}
      />

      {/* ── Toolbar ──────────────────────────────── */}
      <DiffReviewToolbar
        filePath={activeFile.filePath}
        additions={activeFile.additions}
        deletions={activeFile.deletions}
        modifiedCount={modifiedCount}
        acceptAllLabel={labels.acceptAll}
        rejectAllLabel={labels.rejectAll}
        toolbarClassName={toolbarClassName}
        onAcceptAll={handleAcceptAll}
        onRejectAll={handleRejectAll}
      />

      {/* ── Side-by-side diff ─────────────────────── */}
      <div
        className={cx(styles.diffContent, diffContentClassName)}
        role="tabpanel"
        id={`${tabsId}-panel`}
        aria-labelledby={`${tabsId}-tab-${safeIndex}`}
      >
        <div className={styles.sideBySide}>
          {/* ── Left column (old) ─────────────────── */}
          <DiffReviewSideColumn
            side="left"
            headerLabel={labels.original}
            filePath={activeFile.filePath}
            rows={sideBySideRows}
            activeLang={activeLang}
            rowToHunkIndex={rowToHunkIndex}
            hunkStates={hunkStates}
            hunkKeyFor={hunkKeyFor}
            appliedLabel={labels.applied}
            rejectedLabel={labels.rejected}
            submittingLabel={labels.submitting}
            acceptHunkLabel={labels.acceptHunk}
            rejectHunkLabel={labels.rejectHunk}
            diffRowClassName={diffRowClassName}
            lineActionBtnClassName={lineActionBtnClassName}
            columnClassName={styles.columnLeft}
            onAcceptClick={handleAcceptClick}
            onRejectClick={handleRejectClick}
          />

          {/* ── Right column (new) ────────────────── */}
          <DiffReviewSideColumn
            side="right"
            headerLabel={labels.modified}
            filePath={activeFile.filePath}
            rows={sideBySideRows}
            activeLang={activeLang}
            rowToHunkIndex={rowToHunkIndex}
            hunkStates={hunkStates}
            hunkKeyFor={hunkKeyFor}
            appliedLabel={labels.applied}
            rejectedLabel={labels.rejected}
            submittingLabel={labels.submitting}
            acceptHunkLabel={labels.acceptHunk}
            rejectHunkLabel={labels.rejectHunk}
            diffRowClassName={diffRowClassName}
            lineActionBtnClassName={lineActionBtnClassName}
            onAcceptClick={handleAcceptClick}
            onRejectClick={handleRejectClick}
          />
        </div>
      </div>
    </div>
  );
}
