/**
 * DiffReviewPanel pure helpers.
 * Peel companion of DiffReviewPanel (#1151). Pure only; zero behavior change.
 */

import type { DiffHunk } from '../diff';
import type { SideBySideCell, SideBySideRow } from './DiffReviewPanelTypes';
import styles from './DiffReviewPanel.module.css';

// ── Build side-by-side rows from a hunk ────────────────────────────────

export function makeCell(lineNumber: number | undefined, content: string): SideBySideCell {
  const cell: SideBySideCell = { content };
  if (lineNumber != null) cell.lineNumber = lineNumber;
  return cell;
}

export function makeRow(
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

export function buildSideBySideRows(hunk: DiffHunk): SideBySideRow[] {
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

export function rowStyleClass(rowType: SideBySideRow['rowType']): string {
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

export function fileActionLabel(action: string): string {
  if (action === 'added' || action === 'created') return 'A';
  if (action === 'deleted') return 'D';
  return 'M';
}

export function fileActionClass(action: string): string {
  if (action === 'added' || action === 'created') return styles.fileTabBadgeAdded ?? '';
  if (action === 'deleted') return styles.fileTabBadgeDeleted ?? '';
  return styles.fileTabBadgeModified ?? '';
}

// ── Line / hunk key helpers ────────────────────────────────────────────

export function leftLineKey(fileIndex: number, rowIndex: number): string {
  return `L-${fileIndex}-${rowIndex}`;
}

export function rightLineKey(fileIndex: number, rowIndex: number): string {
  return `R-${fileIndex}-${rowIndex}`;
}

/** Hunk state key: "filePath:hunkIndex" */
export function hunkStateKey(filePath: string, hunkIndex: number): string {
  return `${filePath}:${hunkIndex}`;
}

/** Map each side-by-side row index to its source hunk index. */
export function buildRowToHunkIndex(hunks: DiffHunk[]): Map<number, number> {
  const map = new Map<number, number>();
  let rowIndex = 0;
  hunks.forEach((hunk, hunkIdx) => {
    const rows = buildSideBySideRows(hunk);
    for (let i = 0; i < rows.length; i++) {
      map.set(rowIndex + i, hunkIdx);
    }
    rowIndex += rows.length;
  });
  return map;
}
