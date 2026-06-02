import { describe, it, expect } from 'vitest';
import { isDiff, extractDiffs, isObj } from './diff';
import type { DiffInput } from './diff';

function makeDiff(overrides: Partial<DiffInput> = {}): DiffInput {
  return {
    file: 'src/app.ts',
    patch: '@@ -1 +1 @@\n-old\n+new\n',
    additions: 1,
    deletions: 1,
    status: 'modified',
    ...overrides,
  };
}

// ── isDiff ─────────────────────────────────────────────────────────────

describe('isDiff', () => {
  it('validates a complete diff object with status', () => {
    expect(isDiff(makeDiff())).toBe(true);
  });

  it('validates a diff object without status', () => {
    const { status, ...rest } = makeDiff();
    expect(isDiff(rest)).toBe(true);
  });

  it('rejects a diff with an invalid status', () => {
    expect(isDiff(makeDiff({ status: 'unknown' as DiffInput['status'] }))).toBe(false);
  });

  it('rejects a diff missing "file"', () => {
    const { file, ...rest } = makeDiff();
    expect(isDiff(rest)).toBe(false);
  });

  it('rejects a diff missing "patch"', () => {
    const { patch, ...rest } = makeDiff();
    expect(isDiff(rest)).toBe(false);
  });

  it('rejects a diff missing "additions"', () => {
    const { additions, ...rest } = makeDiff();
    expect(isDiff(rest)).toBe(false);
  });

  it('rejects a diff missing "deletions"', () => {
    const { deletions, ...rest } = makeDiff();
    expect(isDiff(rest)).toBe(false);
  });

  it('rejects null', () => {
    expect(isDiff(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isDiff(undefined)).toBe(false);
  });

  it('rejects non-objects (string, number, array)', () => {
    expect(isDiff('hello')).toBe(false);
    expect(isDiff(42)).toBe(false);
    expect(isDiff([])).toBe(false);
  });

  it('rejects an object with the wrong field types', () => {
    expect(isDiff({ file: 123, patch: 'x', additions: 1, deletions: 1 })).toBe(false);
    expect(isDiff({ file: 'f', patch: 456, additions: 1, deletions: 1 })).toBe(false);
  });
});

// ── extractDiffs ──────────────────────────────────────────────────────

describe('extractDiffs', () => {
  const item = makeDiff();

  it('returns empty array for null', () => {
    expect(extractDiffs(null)).toEqual([]);
  });

  it('returns empty array for undefined', () => {
    expect(extractDiffs(undefined)).toEqual([]);
  });

  it('returns empty array for an empty array', () => {
    expect(extractDiffs([])).toEqual([]);
  });

  it('extracts from a single valid diff object', () => {
    const result = extractDiffs(item);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(item);
  });

  it('extracts from an array where every element is a valid diff', () => {
    const result = extractDiffs([item, item]);
    expect(result).toHaveLength(2);
  });

  it('extracts from a keyed object whose values are diffs', () => {
    const result = extractDiffs({ a: item, b: item });
    expect(result).toHaveLength(2);
  });

  it('filters out invalid entries from a mixed array', () => {
    const invalid = { file: 'bad.ts', extra: 'nope' };
    const result = extractDiffs([item, invalid]);
    expect(result).toHaveLength(1);
  });

  it('returns empty array for a non-object primitive', () => {
    expect(extractDiffs(42)).toEqual([]);
    expect(extractDiffs('string')).toEqual([]);
    expect(extractDiffs(true)).toEqual([]);
  });

  it('returns empty array for a keyed object with no valid diffs', () => {
    expect(extractDiffs({ x: { foo: 1 }, y: { bar: 2 } })).toEqual([]);
  });

  it('returns empty array for an array with no valid diffs', () => {
    expect(extractDiffs([{ a: 1 }, { b: 2 }])).toEqual([]);
  });
});

// ── isObj ─────────────────────────────────────────────────────────────

describe('isObj', () => {
  it('returns true for a plain object', () => {
    expect(isObj({ key: 'value' })).toBe(true);
  });

  it('returns true for an empty object', () => {
    expect(isObj({})).toBe(true);
  });

  it('returns false for null', () => {
    expect(isObj(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isObj(undefined)).toBe(false);
  });

  it('returns false for arrays', () => {
    expect(isObj([1, 2, 3])).toBe(false);
    expect(isObj([])).toBe(false);
  });

  it('returns false for primitives', () => {
    expect(isObj(42)).toBe(false);
    expect(isObj('hello')).toBe(false);
    expect(isObj(true)).toBe(false);
  });
});
