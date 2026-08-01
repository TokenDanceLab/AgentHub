import { describe, expect, it } from 'vitest';
import { buildSideBySideRows } from './DiffReviewPanelHelpers';
import type { DiffHunk, DiffLine } from '../diff';

/** Build a hunk from a terse line spec (mirrors DiffReviewPanel.test.tsx). */
function makeHunk(header: string, lines: Array<Pick<DiffLine, 'type' | 'content'> & Partial<Pick<DiffLine, 'oldLineNumber' | 'newLineNumber'>>>): DiffHunk {
  return { header, lines };
}

const ctx = (content: string, oldLineNumber = 1, newLineNumber = 1): DiffLine => ({
  type: 'context',
  oldLineNumber,
  newLineNumber,
  content,
});
const del = (content: string, oldLineNumber: number): DiffLine => ({
  type: 'deleted',
  oldLineNumber,
  content,
});
const add = (content: string, newLineNumber: number): DiffLine => ({
  type: 'added',
  newLineNumber,
  content,
});

describe('buildSideBySideRows — wordDiff fill (P6 Step 2)', () => {
  // ── modified pair: wordDiff is populated per column ───────────────────
  it('fills wordDiff on both cells of a modified (deleted+added) pair', () => {
    const hunk = makeHunk('@@ -1,4 +1,4 @@', [
      ctx('import React from "react";', 1, 1),
      del('const old = true;', 2),
      add('const updated = false;', 2),
      ctx('export default App;', 3, 3),
    ]);

    const rows = buildSideBySideRows(hunk);
    // context, modified, context
    expect(rows).toHaveLength(3);
    expect(rows[1]!.rowType).toBe('modified');

    const left = rows[1]!.left;
    const right = rows[1]!.right;
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(left!.wordDiff).toBeInstanceOf(Array);
    expect(right!.wordDiff).toBeInstanceOf(Array);
  });

  it('splits tokens per column: left has removed+context, right has added+context', () => {
    const oldLine = 'const old = true;';
    const newLine = 'const updated = false;';
    const hunk = makeHunk('@@ -1,2 +1,2 @@', [
      del(oldLine, 1),
      add(newLine, 1),
    ]);

    const [modifiedRow] = buildSideBySideRows(hunk);
    expect(modifiedRow!.rowType).toBe('modified');

    const left = modifiedRow!.left!;
    const right = modifiedRow!.right!;

    // Left column must not contain any 'added' tokens.
    expect(left.wordDiff!.every((t) => t.type !== 'added')).toBe(true);
    // Right column must not contain any 'removed' tokens.
    expect(right.wordDiff!.every((t) => t.type !== 'removed')).toBe(true);

    // Reconstruction contract (report §4.1): each column's tokens join back
    // to that column's `content`.
    expect(left.wordDiff!.map((t) => t.text).join('')).toBe(oldLine);
    expect(right.wordDiff!.map((t) => t.text).join('')).toBe(newLine);
  });

  // ── non-modified rows: wordDiff stays undefined ───────────────────────
  it('leaves wordDiff undefined on context / deleted / added rows', () => {
    const hunk = makeHunk('@@ -1,4 +1,4 @@', [
      ctx('unchanged', 1, 1),
      del('gone', 2),
      add('here', 2),
      ctx('same', 3, 3),
    ]);

    const rows = buildSideBySideRows(hunk);
    // context, modified, context  (deleted+added collapse into one modified row)
    expect(rows).toHaveLength(3);

    // context row cells: no wordDiff
    const contextRow = rows[0]!;
    expect(contextRow.rowType).toBe('context');
    expect(contextRow.left!.wordDiff).toBeUndefined();
    expect(contextRow.right!.wordDiff).toBeUndefined();

    // trailing context row: no wordDiff
    const trailing = rows[2]!;
    expect(trailing.rowType).toBe('context');
    expect(trailing.left!.wordDiff).toBeUndefined();
    expect(trailing.right!.wordDiff).toBeUndefined();
  });

  it('leaves wordDiff undefined on a pure-deleted row (no adjacent added)', () => {
    const hunk = makeHunk('@@ -1,2 +0,0 @@', [
      del('only deleted A', 1),
      del('only deleted B', 2),
    ]);

    const rows = buildSideBySideRows(hunk);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.rowType === 'deleted')).toBe(true);
    for (const r of rows) {
      expect(r.left!.wordDiff).toBeUndefined();
      expect(r.right).toBeNull();
    }
  });

  it('leaves wordDiff undefined on a pure-added row (no adjacent deleted)', () => {
    const hunk = makeHunk('@@ -0,0 +1,2 @@', [
      add('only added A', 1),
      add('only added B', 2),
    ]);

    const rows = buildSideBySideRows(hunk);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.rowType === 'added')).toBe(true);
    for (const r of rows) {
      expect(r.right!.wordDiff).toBeUndefined();
      expect(r.left).toBeNull();
    }
  });

  // ── size guard: oversized modified pair skips wordDiff ───────────────
  it('skips wordDiff when the modified pair exceeds the size guard', () => {
    const huge = 'a'.repeat(2001);
    const hunk = makeHunk('@@ -1,2 +1,2 @@', [
      del(huge, 1),
      add('short', 1),
    ]);

    const [modifiedRow] = buildSideBySideRows(hunk);
    expect(modifiedRow!.rowType).toBe('modified');
    // Guard fires -> wordDiff left undefined (Step 3 renderer falls back
    // to whole-line Prism highlight).
    expect(modifiedRow!.left!.wordDiff).toBeUndefined();
    expect(modifiedRow!.right!.wordDiff).toBeUndefined();
    // Content is still wired correctly regardless of word-diff skip.
    expect(modifiedRow!.left!.content).toBe(huge);
    expect(modifiedRow!.right!.content).toBe('short');
  });
});
