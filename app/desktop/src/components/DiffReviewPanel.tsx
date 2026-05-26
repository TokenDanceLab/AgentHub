// Side-by-side diff review panel — Codex-style accept/reject per line
import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';
import type { FileDiff, DiffHunk, DiffLine } from './ChatView.types';
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

function buildSideBySideRows(hunk: DiffHunk): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  const lines = hunk.lines;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line) break;

    if (line.type === 'context') {
      rows.push({
        left: { lineNumber: line.oldLineNumber, content: line.content },
        right: { lineNumber: line.newLineNumber, content: line.content },
        rowType: 'context',
        leftLineIndex: i,
        rightLineIndex: i,
      });
      i++;
    } else if (
      line.type === 'deleted' &&
      i + 1 < lines.length &&
      lines[i + 1]?.type === 'added'
    ) {
      // Pair consecutive deleted + added as "modified"
      const addedLine = lines[i + 1]!;
      rows.push({
        left: { lineNumber: line.oldLineNumber, content: line.content },
        right: { lineNumber: addedLine.newLineNumber, content: addedLine.content },
        rowType: 'modified',
        leftLineIndex: i,
        rightLineIndex: i + 1,
      });
      i += 2;
    } else if (line.type === 'deleted') {
      rows.push({
        left: { lineNumber: line.oldLineNumber, content: line.content },
        right: null,
        rowType: 'deleted',
        leftLineIndex: i,
      });
      i++;
    } else if (line.type === 'added') {
      rows.push({
        left: null,
        right: { lineNumber: line.newLineNumber, content: line.content },
        rowType: 'added',
        rightLineIndex: i,
      });
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
  status: 'added' | 'deleted' | 'modified';
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

interface Props {
  files: DiffReviewFile[];
  onAcceptAll?: () => void;
  onRejectAll?: () => void;
}

// ── DiffReviewPanel ────────────────────────────────────────────────────

export default function DiffReviewPanel({ files, onAcceptAll, onRejectAll }: Props) {
  const { t } = useTranslation();

  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const [acceptedLines, setAcceptedLines] = useState<Set<string>>(new Set());
  const [rejectedLines, setRejectedLines] = useState<Set<string>>(new Set());

  // Clamp active index to valid range
  const safeIndex = Math.max(0, Math.min(activeFileIndex, files.length - 1));
  const activeFile = files[safeIndex];

  // Build side-by-side rows for the active file
  const sideBySideRows = useMemo(() => {
    if (!activeFile) return [];
    return activeFile.hunks.flatMap((hunk) => buildSideBySideRows(hunk));
  }, [activeFile]);

  // Compute modified lines count
  const modifiedCount = useMemo(() => {
    if (!activeFile) return 0;
    return sideBySideRows.filter((r) => r.rowType === 'modified').length;
  }, [sideBySideRows, activeFile]);

  // Line key helpers
  const leftKey = useCallback((rowIndex: number) => `L-${safeIndex}-${rowIndex}`, [safeIndex]);
  const rightKey = useCallback((rowIndex: number) => `R-${safeIndex}-${rowIndex}`, [safeIndex]);

  // Toggle accept for a line pair
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

  // Accept all / reject all
  const handleAcceptAll = useCallback(() => {
    const allKeys = new Set<string>();
    sideBySideRows.forEach((_row, rowIndex) => {
      allKeys.add(leftKey(rowIndex));
      allKeys.add(rightKey(rowIndex));
    });
    setAcceptedLines(allKeys);
    setRejectedLines(new Set());
    onAcceptAll?.();
  }, [sideBySideRows, leftKey, rightKey, onAcceptAll]);

  const handleRejectAll = useCallback(() => {
    const allKeys = new Set<string>();
    sideBySideRows.forEach((_row, rowIndex) => {
      allKeys.add(leftKey(rowIndex));
      allKeys.add(rightKey(rowIndex));
    });
    setRejectedLines(allKeys);
    setAcceptedLines(new Set());
    onRejectAll?.();
  }, [sideBySideRows, leftKey, rightKey, onRejectAll]);

  // ── Empty state ──────────────────────────────────────────────────────

  if (files.length === 0 || !activeFile) {
    return (
      <div className={styles.root} data-testid="diff-review-panel">
        <div className={styles.empty}>{t('diffReview.empty')}</div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className={styles.root} data-testid="diff-review-panel">
      {/* ── File tabs ─────────────────────────────── */}
      <div className={styles.fileTabs} role="tablist">
        {files.map((file, idx) => (
          <button
            key={file.filePath}
            className={`${styles.fileTab} ${idx === safeIndex ? styles.fileTabActive : ''}`}
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
      <div className={styles.toolbar}>
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
            aria-label={t('diffReview.acceptAll')}
          >
            <Check size={12} />
            <span>{t('diffReview.acceptAll')}</span>
          </button>
          <button
            className={`${styles.toolbarBtn} ${styles.rejectAllBtn}`}
            onClick={handleRejectAll}
            aria-label={t('diffReview.rejectAll')}
          >
            <X size={12} />
            <span>{t('diffReview.rejectAll')}</span>
          </button>
        </div>
      </div>

      {/* ── Side-by-side diff ─────────────────────── */}
      <div className={styles.diffContent}>
        <div className={styles.sideBySide}>
          {/* ── Left column (old) ─────────────────── */}
          <div className={`${styles.column} ${styles.columnLeft}`}>
            <div className={styles.columnHeader}>
              <span>{t('diffReview.original')}</span>
              <span>{activeFile.filePath}</span>
            </div>
            {sideBySideRows.map((row, rowIndex) => {
              const rowState = rejectedLines.has(leftKey(rowIndex))
                ? 'rejected'
                : acceptedLines.has(leftKey(rowIndex))
                  ? 'accepted'
                  : 'default';
              const rowClass = [
                styles.diffRow,
                rowStyleClass(row.rowType),
                !row.left ? styles.diffRowEmpty : undefined,
                rowState === 'accepted' ? styles.diffRowAccepted : undefined,
                rowState === 'rejected' ? styles.diffRowRejected : undefined,
              ]
                .filter(Boolean)
                .join(' ');

              return (
                <div key={rowIndex} className={rowClass}>
                  <span className={styles.lineNum}>
                    {row.left?.lineNumber != null ? row.left.lineNumber : ''}
                  </span>
                  <span className={styles.lineContent}>
                    {row.left?.content ?? ' '}
                  </span>
                  {row.rowType !== 'context' && (
                    <div className={styles.lineActions}>
                      <button
                        className={`${styles.lineActionBtn} ${styles.lineAcceptBtn} ${rowState === 'accepted' ? styles.lineAcceptBtnActive : ''}`}
                        onClick={() => toggleAccept(rowIndex)}
                        aria-label={t('diffReview.acceptLine')}
                        title={t('diffReview.acceptLine')}
                      >
                        <Check size={11} />
                      </button>
                      <button
                        className={`${styles.lineActionBtn} ${styles.lineRejectBtn} ${rowState === 'rejected' ? styles.lineRejectBtnActive : ''}`}
                        onClick={() => toggleReject(rowIndex)}
                        aria-label={t('diffReview.rejectLine')}
                        title={t('diffReview.rejectLine')}
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
              <span>{t('diffReview.modified')}</span>
              <span>{activeFile.filePath}</span>
            </div>
            {sideBySideRows.map((row, rowIndex) => {
              const rowState = rejectedLines.has(rightKey(rowIndex))
                ? 'rejected'
                : acceptedLines.has(rightKey(rowIndex))
                  ? 'accepted'
                  : 'default';
              const rowClass = [
                styles.diffRow,
                rowStyleClass(row.rowType),
                !row.right ? styles.diffRowEmpty : undefined,
                rowState === 'accepted' ? styles.diffRowAccepted : undefined,
                rowState === 'rejected' ? styles.diffRowRejected : undefined,
              ]
                .filter(Boolean)
                .join(' ');

              return (
                <div key={rowIndex} className={rowClass}>
                  <span className={styles.lineNum}>
                    {row.right?.lineNumber != null ? row.right.lineNumber : ''}
                  </span>
                  <span className={styles.lineContent}>
                    {row.right?.content ?? ' '}
                  </span>
                  {row.rowType !== 'context' && (
                    <div className={styles.lineActions}>
                      <button
                        className={`${styles.lineActionBtn} ${styles.lineAcceptBtn} ${rowState === 'accepted' ? styles.lineAcceptBtnActive : ''}`}
                        onClick={() => toggleAccept(rowIndex)}
                        aria-label={t('diffReview.acceptLine')}
                        title={t('diffReview.acceptLine')}
                      >
                        <Check size={11} />
                      </button>
                      <button
                        className={`${styles.lineActionBtn} ${styles.lineRejectBtn} ${rowState === 'rejected' ? styles.lineRejectBtnActive : ''}`}
                        onClick={() => toggleReject(rowIndex)}
                        aria-label={t('diffReview.rejectLine')}
                        title={t('diffReview.rejectLine')}
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
