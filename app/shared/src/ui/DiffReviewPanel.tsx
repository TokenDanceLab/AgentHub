/**
 * DiffReviewPanel public surface — side-by-side diff review with line/hunk accept-reject.
 * Residual pure-helper peel of DiffReviewPanel (#1151). Pure only; zero behavior change.
 *
 * Implementations live in companions (DiffReviewPanelTypes / DiffReviewPanelHelpers /
 * DiffReviewPanelParts); this file keeps the public orchestrator so consumers
 * importing from `./DiffReviewPanel` remain stable.
 */

import { useState, useMemo, useCallback, useEffect, useId } from 'react';
import { cx } from './cx';
import { languageFromPath } from './syntaxHighlight';
import styles from './DiffReviewPanel.module.css';
import {
  buildRowToHunkIndex,
  buildSideBySideRows,
  hunkStateKey,
  leftLineKey,
  rightLineKey,
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
  const [acceptedLines, setAcceptedLines] = useState<Set<string>>(new Set());
  const [rejectedLines, setRejectedLines] = useState<Set<string>>(new Set());
  // Hunk-level committed state: tracks hunks that have been applied/rejected via Edge API
  const [hunkStates, setHunkStates] = useState<Record<string, 'applied' | 'rejected'>>({});

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

  // Line key helpers
  const leftKey = useCallback((rowIndex: number) => leftLineKey(safeIndex, rowIndex), [safeIndex]);
  const rightKey = useCallback((rowIndex: number) => rightLineKey(safeIndex, rowIndex), [safeIndex]);

  // Hunk state key helper: "filePath:hunkIndex"
  const hunkKey = useCallback((filePath: string, hunkIndex: number) => hunkStateKey(filePath, hunkIndex), []);

  // Build hunk index mapping: maps row index to hunk index for the active file
  const rowToHunkIndex = useMemo(() => {
    if (!activeFile) return new Map<number, number>();
    return buildRowToHunkIndex(activeFile.hunks);
  }, [activeFile]);

  // Toggle accept for a line pair and commit hunk decision
  const toggleAccept = useCallback(
    (rowIndex: number) => {
      const lKey = leftKey(rowIndex);
      const rKey = rightKey(rowIndex);

      setAcceptedLines((prev) => {
        const next = new Set(prev);
        if (next.has(lKey) || next.has(rKey)) {
          next.delete(lKey);
          next.delete(rKey);
        } else {
          next.add(lKey);
          next.add(rKey);
        }
        return next;
      });
      setRejectedLines((prev) => {
        const next = new Set(prev);
        next.delete(lKey);
        next.delete(rKey);
        return next;
      });
    },
    [leftKey, rightKey],
  );

  // Commit hunk decision to Edge API
  const commitHunkDecision = useCallback(
    (filePath: string, hunkIndex: number, accepted: boolean) => {
      const key = hunkKey(filePath, hunkIndex);
      setHunkStates((prev) => ({ ...prev, [key]: accepted ? 'applied' : 'rejected' }));
      if (onApplyHunk && runId) {
        onApplyHunk({ filePath, hunkIndex, accepted });
      }
    },
    [onApplyHunk, runId, hunkKey],
  );

  // Toggle reject for a line pair
  const toggleReject = useCallback(
    (rowIndex: number) => {
      const lKey = leftKey(rowIndex);
      const rKey = rightKey(rowIndex);

      setRejectedLines((prev) => {
        const next = new Set(prev);
        if (next.has(lKey) || next.has(rKey)) {
          next.delete(lKey);
          next.delete(rKey);
        } else {
          next.add(lKey);
          next.add(rKey);
        }
        return next;
      });
      setAcceptedLines((prev) => {
        const next = new Set(prev);
        next.delete(lKey);
        next.delete(rKey);
        return next;
      });
    },
    [leftKey, rightKey],
  );

  // Accept all / reject all — also commits hunk decisions
  const handleAcceptAll = useCallback(() => {
    const allKeys = new Set<string>();
    sideBySideRows.forEach((_row, rowIndex) => {
      allKeys.add(leftKey(rowIndex));
      allKeys.add(rightKey(rowIndex));
    });
    setAcceptedLines(allKeys);
    setRejectedLines(new Set());

    // Commit hunk-level decisions
    if (activeFile) {
      const decisions: DiffHunkDecision[] = [];
      const newStates: Record<string, 'applied' | 'rejected'> = {};
      activeFile.hunks.forEach((_hunk, hunkIdx) => {
        const key = hunkKey(activeFile.filePath, hunkIdx);
        newStates[key] = 'applied';
        decisions.push({ filePath: activeFile.filePath, hunkIndex: hunkIdx, accepted: true });
      });
      setHunkStates((prev) => ({ ...prev, ...newStates }));
      if (onApplyAllHunks && decisions.length > 0) {
        onApplyAllHunks(decisions);
      }
    }

    onAcceptAll?.();
  }, [sideBySideRows, leftKey, rightKey, onAcceptAll, activeFile, onApplyAllHunks, hunkKey]);

  const handleRejectAll = useCallback(() => {
    const allKeys = new Set<string>();
    sideBySideRows.forEach((_row, rowIndex) => {
      allKeys.add(leftKey(rowIndex));
      allKeys.add(rightKey(rowIndex));
    });
    setRejectedLines(allKeys);
    setAcceptedLines(new Set());

    // Commit hunk-level decisions
    if (activeFile) {
      const decisions: DiffHunkDecision[] = [];
      const newStates: Record<string, 'applied' | 'rejected'> = {};
      activeFile.hunks.forEach((_hunk, hunkIdx) => {
        const key = hunkKey(activeFile.filePath, hunkIdx);
        newStates[key] = 'rejected';
        decisions.push({ filePath: activeFile.filePath, hunkIndex: hunkIdx, accepted: false });
      });
      setHunkStates((prev) => ({ ...prev, ...newStates }));
      if (onApplyAllHunks && decisions.length > 0) {
        onApplyAllHunks(decisions);
      }
    }

    onRejectAll?.();
  }, [sideBySideRows, leftKey, rightKey, onRejectAll, activeFile, onApplyAllHunks, hunkKey]);

  // Handle accept line click — toggle local state and commit hunk decision
  const handleAcceptClick = useCallback(
    (rowIndex: number) => {
      toggleAccept(rowIndex);
      // Commit hunk decision for the row's hunk
      if (activeFile) {
        const hunkIdx = rowToHunkIndex.get(rowIndex);
        if (hunkIdx != null) {
          commitHunkDecision(activeFile.filePath, hunkIdx, true);
        }
      }
    },
    [toggleAccept, activeFile, rowToHunkIndex, commitHunkDecision],
  );

  // Handle reject line click — toggle local state and commit hunk decision
  const handleRejectClick = useCallback(
    (rowIndex: number) => {
      toggleReject(rowIndex);
      // Commit hunk decision for the row's hunk
      if (activeFile) {
        const hunkIdx = rowToHunkIndex.get(rowIndex);
        if (hunkIdx != null) {
          commitHunkDecision(activeFile.filePath, hunkIdx, false);
        }
      }
    },
    [toggleReject, activeFile, rowToHunkIndex, commitHunkDecision],
  );

  const activeFilePath = activeFile?.filePath ?? '';
  const hunkKeyFor = useCallback(
    (hunkIndex: number) => hunkKey(activeFilePath, hunkIndex),
    [hunkKey, activeFilePath],
  );

  // ── Tabpanel id prefix (#1823) ───────────────────────────────────────
  // Shared by DiffReviewFileTabs (tab ids) and the diff content (panel),
  // keeping the tab/tabpanel association stable.
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
            acceptedLines={acceptedLines}
            rejectedLines={rejectedLines}
            lineKey={leftKey}
            rowToHunkIndex={rowToHunkIndex}
            hunkStates={hunkStates}
            hunkKeyFor={hunkKeyFor}
            appliedLabel={labels.applied}
            rejectedLabel={labels.rejected}
            acceptLineLabel={labels.acceptLine}
            rejectLineLabel={labels.rejectLine}
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
            acceptedLines={acceptedLines}
            rejectedLines={rejectedLines}
            lineKey={rightKey}
            rowToHunkIndex={rowToHunkIndex}
            hunkStates={hunkStates}
            hunkKeyFor={hunkKeyFor}
            appliedLabel={labels.applied}
            rejectedLabel={labels.rejected}
            acceptLineLabel={labels.acceptLine}
            rejectLineLabel={labels.rejectLine}
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
