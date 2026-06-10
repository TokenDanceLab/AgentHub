import { useState, useMemo, useCallback, useEffect } from 'react';
import { Check, X } from 'lucide-react';
import type { DiffFile, DiffHunk, DiffLine } from '../diff';
import { highlightLine, languageFromPath } from './syntaxHighlight';
import styles from './DiffReviewPanel.module.css';

// ── Side-by-side row types ──────────────────────────────────────────────

interface SideBySideCell {
  lineNumber?: number;
  content: string;
}

interface SideBySideRow {
  left: SideBySideCell | null;
  right: SideBySideCell | null;
  /** The semantic change type of this row pair */
  rowType: 'added' | 'deleted' | 'modified' | 'context';
  /** Original line index in the hunk for left content */
  leftLineIndex?: number;
  /** Original line index in the hunk for right content */
  rightLineIndex?: number;
}

// ── Build side-by-side rows from a hunk ────────────────────────────────

function makeCell(lineNumber: number | undefined, content: string): SideBySideCell {
  const cell: SideBySideCell = { content };
  if (lineNumber != null) cell.lineNumber = lineNumber;
  return cell;
}

function makeRow(
  left: SideBySideCell | null,
  right: SideBySideCell | null,
  rowType: SideBySideRow['rowType'],
  leftLineIndex?: number,
  rightLineIndex?: number,
): SideBySideRow {
  const row: SideBySideRow = { left, right, rowType };
  if (leftLineIndex != null) row.leftLineIndex = leftLineIndex;
  if (rightLineIndex != null) row.rightLineIndex = rightLineIndex;
  return row;
}

function buildSideBySideRows(hunk: DiffHunk): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  const lines = hunk.lines;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line) break;

    if (line.type === 'context') {
      rows.push(makeRow(
        makeCell(line.oldLineNumber, line.content),
        makeCell(line.newLineNumber, line.content),
        'context',
        i,
        i,
      ));
      i++;
    } else if (
      line.type === 'deleted' &&
      i + 1 < lines.length &&
      lines[i + 1]?.type === 'added'
    ) {
      // Pair consecutive deleted + added as "modified"
      const addedLine = lines[i + 1]!;
      rows.push(makeRow(
        makeCell(line.oldLineNumber, line.content),
        makeCell(addedLine.newLineNumber, addedLine.content),
        'modified',
        i,
        i + 1,
      ));
      i += 2;
    } else if (line.type === 'deleted') {
      rows.push(makeRow(
        makeCell(line.oldLineNumber, line.content),
        null,
        'deleted',
        i,
      ));
      i++;
    } else if (line.type === 'added') {
      rows.push(makeRow(
        null,
        makeCell(line.newLineNumber, line.content),
        'added',
        undefined,
        i,
      ));
      i++;
    } else {
      i++;
    }
  }

  return rows;
}

// ── Row style resolver ─────────────────────────────────────────────────

function rowStyleClass(rowType: SideBySideRow['rowType']): string {
  switch (rowType) {
    case 'added':
      return styles.diffRowAdded ?? '';
    case 'deleted':
      return styles.diffRowDeleted ?? '';
    case 'modified':
      return styles.diffRowModified ?? '';
    case 'context':
      return styles.diffRowContext ?? '';
  }
}

// ── File action badge ──────────────────────────────────────────────────

function fileActionLabel(action: string): string {
  if (action === 'added' || action === 'created') return 'A';
  if (action === 'deleted') return 'D';
  return 'M';
}

function fileActionClass(action: string): string {
  if (action === 'added' || action === 'created') return styles.fileTabBadgeAdded ?? '';
  if (action === 'deleted') return styles.fileTabBadgeDeleted ?? '';
  return styles.fileTabBadgeModified ?? '';
}

// ── Props ──────────────────────────────────────────────────────────────

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

const DEFAULT_LABELS: Required<DiffReviewLabels> = {
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

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

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
  const leftKey = useCallback((rowIndex: number) => `L-${safeIndex}-${rowIndex}`, [safeIndex]);
  const rightKey = useCallback((rowIndex: number) => `R-${safeIndex}-${rowIndex}`, [safeIndex]);

  // Hunk state key helper: "filePath:hunkIndex"
  const hunkKey = useCallback((filePath: string, hunkIndex: number) => `${filePath}:${hunkIndex}`, []);

  // Build hunk index mapping: maps row index to hunk index for the active file
  const rowToHunkIndex = useMemo(() => {
    if (!activeFile) return new Map<number, number>();
    const map = new Map<number, number>();
    let rowIndex = 0;
    activeFile.hunks.forEach((hunk, hunkIdx) => {
      const rows = buildSideBySideRows(hunk);
      for (let i = 0; i < rows.length; i++) {
        map.set(rowIndex + i, hunkIdx);
      }
      rowIndex += rows.length;
    });
    return map;
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
      <div className={cx(styles.fileTabs, fileTabsClassName)} role="tablist">
        {files.map((file, idx) => (
          <button
            key={file.filePath}
            className={cx(
              styles.fileTab,
              fileTabClassName,
              idx === safeIndex && styles.fileTabActive,
              idx === safeIndex && activeFileTabClassName,
            )}
            role="tab"
            aria-selected={idx === safeIndex}
            onClick={() => setActiveFileIndex(idx)}
          >
            <span
              className={`${styles.fileTabBadge} ${fileActionClass(file.status)}`}
            >
              {fileActionLabel(file.status)}
            </span>
            <span>{file.filePath}</span>
          </button>
        ))}
      </div>

      {/* ── Toolbar ──────────────────────────────── */}
      <div className={cx(styles.toolbar, toolbarClassName)}>
        <span className={styles.fileName}>{activeFile.filePath}</span>
        <div className={styles.stats}>
          <span className={styles.statsAdded}>+{activeFile.additions}</span>
          <span className={styles.statsDeleted}>-{activeFile.deletions}</span>
          {modifiedCount > 0 && (
            <span className={styles.statsModified}>~{modifiedCount}</span>
          )}
        </div>
        <div className={styles.toolbarActions}>
          <button
            className={`${styles.toolbarBtn} ${styles.acceptAllBtn}`}
            onClick={handleAcceptAll}
            aria-label={labels.acceptAll}
          >
            <Check size={12} />
            <span>{labels.acceptAll}</span>
          </button>
          <button
            className={`${styles.toolbarBtn} ${styles.rejectAllBtn}`}
            onClick={handleRejectAll}
            aria-label={labels.rejectAll}
          >
            <X size={12} />
            <span>{labels.rejectAll}</span>
          </button>
        </div>
      </div>

      {/* ── Side-by-side diff ─────────────────────── */}
      <div className={cx(styles.diffContent, diffContentClassName)}>
        <div className={styles.sideBySide}>
          {/* ── Left column (old) ─────────────────── */}
          <div className={`${styles.column} ${styles.columnLeft}`}>
            <div className={styles.columnHeader}>
              <span>{labels.original}</span>
              <span>{activeFile.filePath}</span>
            </div>
            {sideBySideRows.map((row, rowIndex) => {
              const rowState = rejectedLines.has(leftKey(rowIndex))
                ? 'rejected'
                : acceptedLines.has(leftKey(rowIndex))
                  ? 'accepted'
                  : 'default';
              const rowClass = cx(
                styles.diffRow,
                diffRowClassName,
                rowStyleClass(row.rowType),
                !row.left && styles.diffRowEmpty,
                rowState === 'accepted' && styles.diffRowAccepted,
                rowState === 'rejected' && styles.diffRowRejected,
              );

              // Check if this is the first row of a new hunk with a committed state
              const hunkIdx = rowToHunkIndex.get(rowIndex);
              const hunkState = activeFile && hunkIdx != null
                ? hunkStates[hunkKey(activeFile.filePath, hunkIdx)]
                : undefined;
              const prevHunkIdx = rowIndex > 0 ? rowToHunkIndex.get(rowIndex - 1) : undefined;
              const isFirstRowOfHunk = hunkIdx != null && hunkIdx !== prevHunkIdx;

              return (
                <div key={rowIndex} className={rowClass}>
                  {isFirstRowOfHunk && hunkState && (
                    <span className={cx(styles.hunkBadge, hunkState === 'applied' ? styles.hunkBadgeApplied : styles.hunkBadgeRejected)}>
                      {hunkState === 'applied' ? labels.applied : labels.rejected}
                    </span>
                  )}
                  <span className={styles.lineNum}>
                    {row.left?.lineNumber != null ? row.left.lineNumber : ''}
                  </span>
                  <span
                    className={styles.lineContent}
                    dangerouslySetInnerHTML={{
                      __html: highlightLine(row.left?.content ?? ' ', activeLang),
                    }}
                  />
                  {row.rowType !== 'context' && (
                    <div className={styles.lineActions}>
                      <button
                        className={cx(
                          styles.lineActionBtn,
                          styles.lineAcceptBtn,
                          lineActionBtnClassName,
                          rowState === 'accepted' && styles.lineAcceptBtnActive,
                        )}
                        onClick={() => handleAcceptClick(rowIndex)}
                        aria-label={labels.acceptLine}
                        title={labels.acceptLine}
                      >
                        <Check size={11} />
                      </button>
                      <button
                        className={cx(
                          styles.lineActionBtn,
                          styles.lineRejectBtn,
                          lineActionBtnClassName,
                          rowState === 'rejected' && styles.lineRejectBtnActive,
                        )}
                        onClick={() => handleRejectClick(rowIndex)}
                        aria-label={labels.rejectLine}
                        title={labels.rejectLine}
                      >
                        <X size={11} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Right column (new) ────────────────── */}
          <div className={styles.column}>
            <div className={styles.columnHeader}>
              <span>{labels.modified}</span>
              <span>{activeFile.filePath}</span>
            </div>
            {sideBySideRows.map((row, rowIndex) => {
              const rowState = rejectedLines.has(rightKey(rowIndex))
                ? 'rejected'
                : acceptedLines.has(rightKey(rowIndex))
                  ? 'accepted'
                  : 'default';
              const rowClass = cx(
                styles.diffRow,
                diffRowClassName,
                rowStyleClass(row.rowType),
                !row.right && styles.diffRowEmpty,
                rowState === 'accepted' && styles.diffRowAccepted,
                rowState === 'rejected' && styles.diffRowRejected,
              );

              // Check if this is the first row of a new hunk with a committed state
              const hunkIdx = rowToHunkIndex.get(rowIndex);
              const hunkState = activeFile && hunkIdx != null
                ? hunkStates[hunkKey(activeFile.filePath, hunkIdx)]
                : undefined;
              const prevHunkIdx = rowIndex > 0 ? rowToHunkIndex.get(rowIndex - 1) : undefined;
              const isFirstRowOfHunk = hunkIdx != null && hunkIdx !== prevHunkIdx;

              return (
                <div key={rowIndex} className={rowClass}>
                  {isFirstRowOfHunk && hunkState && (
                    <span className={cx(styles.hunkBadge, hunkState === 'applied' ? styles.hunkBadgeApplied : styles.hunkBadgeRejected)}>
                      {hunkState === 'applied' ? labels.applied : labels.rejected}
                    </span>
                  )}
                  <span className={styles.lineNum}>
                    {row.right?.lineNumber != null ? row.right.lineNumber : ''}
                  </span>
                  <span
                    className={styles.lineContent}
                    dangerouslySetInnerHTML={{
                      __html: highlightLine(row.right?.content ?? ' ', activeLang),
                    }}
                  />
                  {row.rowType !== 'context' && (
                    <div className={styles.lineActions}>
                      <button
                        className={cx(
                          styles.lineActionBtn,
                          styles.lineAcceptBtn,
                          lineActionBtnClassName,
                          rowState === 'accepted' && styles.lineAcceptBtnActive,
                        )}
                        onClick={() => handleAcceptClick(rowIndex)}
                        aria-label={labels.acceptLine}
                        title={labels.acceptLine}
                      >
                        <Check size={11} />
                      </button>
                      <button
                        className={cx(
                          styles.lineActionBtn,
                          styles.lineRejectBtn,
                          lineActionBtnClassName,
                          rowState === 'rejected' && styles.lineRejectBtnActive,
                        )}
                        onClick={() => handleRejectClick(rowIndex)}
                        aria-label={labels.rejectLine}
                        title={labels.rejectLine}
                      >
                        <X size={11} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
