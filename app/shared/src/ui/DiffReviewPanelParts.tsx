/**
 * DiffReviewPanel presentational parts.
 * Peel companion of DiffReviewPanel (#1151). Pure only; zero behavior change.
 */

import React, { useCallback, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { cx } from './cx';
import { Tooltip } from './Tooltip';
import { highlightLine, highlightLineWithWordDiff } from './syntaxHighlight';
import {
  fileActionClass,
  fileActionLabel,
  rowStyleClass,
} from './DiffReviewPanelHelpers';
import type {
  DiffReviewFile,
  SideBySideCell,
  SideBySideRow,
  WordDiffToken,
} from './DiffReviewPanelTypes';
import styles from './DiffReviewPanel.module.css';

// ── File tabs ──────────────────────────────────────────────────────────

export function DiffReviewFileTabs({
  files,
  safeIndex,
  tabsId,
  fileTabsClassName,
  fileTabClassName,
  activeFileTabClassName,
  onSelectFile,
}: {
  files: DiffReviewFile[];
  safeIndex: number;
  /**
   * Id prefix shared with the tabpanel rendered by DiffReviewPanel
   * (`${tabsId}-tab-${idx}` / `${tabsId}-panel`). Optional — the parts
   * component keeps working standalone without tabpanel association (#1823).
   */
  tabsId?: string | undefined;
  fileTabsClassName?: string | undefined;
  fileTabClassName?: string | undefined;
  activeFileTabClassName?: string | undefined;
  onSelectFile: (idx: number) => void;
}) {
  // ── Roving tabindex (#1823) ──────────────────────────────────────────
  // One Tab stop for the strip; Arrow/Home/End move focus without changing
  // the selected file (activation stays on click/Enter, matching the #1835
  // TerminalPanel pattern).
  const tabsRef = useRef<HTMLDivElement>(null);
  const [rovingTabIndex, setRovingTabIndex] = useState<number | null>(null);

  const handleTabsKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const tabButtons = tabsRef.current
      ? Array.from(tabsRef.current.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      : [];
    if (tabButtons.length === 0) return;
    const activeIndex = tabButtons.findIndex((button) => button === document.activeElement);
    // Focus on a non-tab stop is not part of the roving strip — arrow keys
    // should not hijack it (#1835 review).
    if (activeIndex < 0) return;
    let nextIndex: number | null;
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (activeIndex + 1) % tabButtons.length;
        break;
      case 'ArrowLeft':
        nextIndex = (activeIndex - 1 + tabButtons.length) % tabButtons.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = tabButtons.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    tabButtons[nextIndex]?.focus();
    setRovingTabIndex(nextIndex);
  }, []);

  return (
    <div
      className={cx(styles.fileTabs, fileTabsClassName)}
      role="tablist"
      ref={tabsRef}
      onKeyDown={handleTabsKeyDown}
    >
      {files.map((file, idx) => {
        const isTabStop = idx === (rovingTabIndex ?? safeIndex);
        return (
          <button type="button"
            key={file.filePath}
            className={cx(
              styles.fileTab,
              fileTabClassName,
              idx === safeIndex && styles.fileTabActive,
              idx === safeIndex && activeFileTabClassName,
            )}
            role="tab"
            id={tabsId !== undefined ? `${tabsId}-tab-${idx}` : undefined}
            aria-controls={tabsId !== undefined ? `${tabsId}-panel` : undefined}
            aria-selected={idx === safeIndex}
            tabIndex={isTabStop ? 0 : -1}
            data-tab-index={idx}
            onClick={() => {
              // #1823: click activation selects the tab AND moves the roving
              // stop to it — otherwise Tab later returns to the stale stop.
              setRovingTabIndex(idx);
              onSelectFile(idx);
            }}
          >
            <span
              className={`${styles.fileTabBadge} ${fileActionClass(file.status)}`}
            >
              {fileActionLabel(file.status)}
            </span>
            <span>{file.filePath}</span>
          </button>
        );
      })}
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
        <button type="button"
          className={`${styles.toolbarBtn} ${styles.acceptAllBtn}`}
          onClick={onAcceptAll}
          aria-label={acceptAllLabel}
        >
          <Check size={12} />
          <span>{acceptAllLabel}</span>
        </button>
        <button type="button"
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

// ── Word-diff class mapper + line HTML (P6 Step 4) ───────────────────
// `wordClassFor` maps a word-diff token type to the scoped CSS module
// class consumed by the HAST injector (P6 Step 3, highlightLineWithWordDiff).
// `context` returns '' so context runs stay as bare text leaves — Prism
// syntax color passes through unchanged inside them (report §4.3).
// `?? ''` mirrors DiffReviewPanelHelpers.rowStyleClass's guard against a
// missing CSS module key (test env proxy never yields undefined here,
// but the guard keeps the contract explicit).
const wordClassFor = (t: WordDiffToken['type']): string =>
  t === 'added'
    ? (styles.wordAdded ?? '')
    : t === 'removed'
      ? (styles.wordRemoved ?? '')
      : '';

/**
 * Render the HTML for a diff cell's line content.
 *
 * Modified rows carrying a non-empty `cell.wordDiff` (filled by
 * `buildSideBySideRows` when the Step 1 size guard did NOT skip) go
 * through `highlightLineWithWordDiff` — Prism syntax color is preserved
 * AND per-word added/removed spans are layered on top via HAST injection.
 * Every other path (non-modified rows, modified rows where the size guard
 * returned null → `wordDiff` undefined, modified rows with an empty token
 * array, or a null cell) falls back to the existing whole-line
 * `highlightLine`, so behaviour is byte-identical to pre-P6 for those rows.
 */
function renderLineHtml(
  row: SideBySideRow,
  cell: SideBySideCell | null,
  lang: string,
): string {
  const wordDiff = cell?.wordDiff;
  if (row.rowType === 'modified' && cell && wordDiff && wordDiff.length > 0) {
    return highlightLineWithWordDiff(cell.content, lang, wordDiff, wordClassFor);
  }
  return highlightLine(cell?.content ?? ' ', lang);
}

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
                __html: renderLineHtml(row, cell, activeLang),
              }}
            />
            {row.rowType !== 'context' && (
              <div className={styles.lineActions}>
                <Tooltip label={acceptLineLabel}>
                  <button type="button"
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
                  <button type="button"
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
