/**
 * DiffReviewPanel presentational parts.
 * Peel companion of DiffReviewPanel (#1151). Pure only; zero behavior change.
 */

import { Check, X } from 'lucide-react';
import { cx } from './cx';
import { Tooltip } from './Tooltip';
import { highlightLine } from './syntaxHighlight';
import {
  fileActionClass,
  fileActionLabel,
  rowStyleClass,
} from './DiffReviewPanelHelpers';
import type {
  DiffReviewFile,
  SideBySideRow,
} from './DiffReviewPanelTypes';
import styles from './DiffReviewPanel.module.css';

// ── File tabs ──────────────────────────────────────────────────────────

export function DiffReviewFileTabs({
  files,
  safeIndex,
  fileTabsClassName,
  fileTabClassName,
  activeFileTabClassName,
  onSelectFile,
}: {
  files: DiffReviewFile[];
  safeIndex: number;
  fileTabsClassName?: string | undefined;
  fileTabClassName?: string | undefined;
  activeFileTabClassName?: string | undefined;
  onSelectFile: (idx: number) => void;
}) {
  return (
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
          onClick={() => onSelectFile(idx)}
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
  );
}

// ── Toolbar ────────────────────────────────────────────────────────────

export function DiffReviewToolbar({
  filePath,
  additions,
  deletions,
  modifiedCount,
  acceptAllLabel,
  rejectAllLabel,
  toolbarClassName,
  onAcceptAll,
  onRejectAll,
}: {
  filePath: string;
  additions: number;
  deletions: number;
  modifiedCount: number;
  acceptAllLabel: string;
  rejectAllLabel: string;
  toolbarClassName?: string | undefined;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}) {
  return (
    <div className={cx(styles.toolbar, toolbarClassName)}>
      <span className={styles.fileName}>{filePath}</span>
      <div className={styles.stats}>
        <span className={styles.statsAdded}>+{additions}</span>
        <span className={styles.statsDeleted}>-{deletions}</span>
        {modifiedCount > 0 && (
          <span className={styles.statsModified}>~{modifiedCount}</span>
        )}
      </div>
      <div className={styles.toolbarActions}>
        <button
          className={`${styles.toolbarBtn} ${styles.acceptAllBtn}`}
          onClick={onAcceptAll}
          aria-label={acceptAllLabel}
        >
          <Check size={12} />
          <span>{acceptAllLabel}</span>
        </button>
        <button
          className={`${styles.toolbarBtn} ${styles.rejectAllBtn}`}
          onClick={onRejectAll}
          aria-label={rejectAllLabel}
        >
          <X size={12} />
          <span>{rejectAllLabel}</span>
        </button>
      </div>
    </div>
  );
}

// ── Side column (left/old or right/new) ────────────────────────────────

export function DiffReviewSideColumn({
  side,
  headerLabel,
  filePath,
  rows,
  activeLang,
  acceptedLines,
  rejectedLines,
  lineKey,
  rowToHunkIndex,
  hunkStates,
  hunkKeyFor,
  appliedLabel,
  rejectedLabel,
  acceptLineLabel,
  rejectLineLabel,
  diffRowClassName,
  lineActionBtnClassName,
  columnClassName,
  onAcceptClick,
  onRejectClick,
}: {
  side: 'left' | 'right';
  headerLabel: string;
  filePath: string;
  rows: SideBySideRow[];
  activeLang: string;
  acceptedLines: Set<string>;
  rejectedLines: Set<string>;
  lineKey: (rowIndex: number) => string;
  rowToHunkIndex: Map<number, number>;
  hunkStates: Record<string, 'applied' | 'rejected'>;
  hunkKeyFor: (hunkIndex: number) => string;
  appliedLabel: string;
  rejectedLabel: string;
  acceptLineLabel: string;
  rejectLineLabel: string;
  diffRowClassName?: string | undefined;
  lineActionBtnClassName?: string | undefined;
  columnClassName?: string | undefined;
  onAcceptClick: (rowIndex: number) => void;
  onRejectClick: (rowIndex: number) => void;
}) {
  return (
    <div className={cx(styles.column, columnClassName)}>
      <div className={styles.columnHeader}>
        <span>{headerLabel}</span>
        <span>{filePath}</span>
      </div>
      {rows.map((row, rowIndex) => {
        const cell = side === 'left' ? row.left : row.right;
        const rowState = rejectedLines.has(lineKey(rowIndex))
          ? 'rejected'
          : acceptedLines.has(lineKey(rowIndex))
            ? 'accepted'
            : 'default';
        const rowClass = cx(
          styles.diffRow,
          diffRowClassName,
          rowStyleClass(row.rowType),
          !cell && styles.diffRowEmpty,
          rowState === 'accepted' && styles.diffRowAccepted,
          rowState === 'rejected' && styles.diffRowRejected,
        );

        // Check if this is the first row of a new hunk with a committed state
        const hunkIdx = rowToHunkIndex.get(rowIndex);
        const hunkState = hunkIdx != null
          ? hunkStates[hunkKeyFor(hunkIdx)]
          : undefined;
        const prevHunkIdx = rowIndex > 0 ? rowToHunkIndex.get(rowIndex - 1) : undefined;
        const isFirstRowOfHunk = hunkIdx != null && hunkIdx !== prevHunkIdx;

        return (
          <div key={rowIndex} className={rowClass}>
            {isFirstRowOfHunk && hunkState && (
              <span className={cx(styles.hunkBadge, hunkState === 'applied' ? styles.hunkBadgeApplied : styles.hunkBadgeRejected)}>
                {hunkState === 'applied' ? appliedLabel : rejectedLabel}
              </span>
            )}
            <span className={styles.lineNum}>
              {cell?.lineNumber != null ? cell.lineNumber : ''}
            </span>
            <span
              className={styles.lineContent}
              dangerouslySetInnerHTML={{
                __html: highlightLine(cell?.content ?? ' ', activeLang),
              }}
            />
            {row.rowType !== 'context' && (
              <div className={styles.lineActions}>
                <Tooltip label={acceptLineLabel}>
                  <button
                    className={cx(
                      styles.lineActionBtn,
                      styles.lineAcceptBtn,
                      lineActionBtnClassName,
                      rowState === 'accepted' && styles.lineAcceptBtnActive,
                    )}
                    onClick={() => onAcceptClick(rowIndex)}
                    aria-label={acceptLineLabel}
                  >
                    <Check size={11} />
                  </button>
                </Tooltip>
                <Tooltip label={rejectLineLabel}>
                  <button
                    className={cx(
                      styles.lineActionBtn,
                      styles.lineRejectBtn,
                      lineActionBtnClassName,
                      rowState === 'rejected' && styles.lineRejectBtnActive,
                    )}
                    onClick={() => onRejectClick(rowIndex)}
                    aria-label={rejectLineLabel}
                  >
                    <X size={11} />
                  </button>
                </Tooltip>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
