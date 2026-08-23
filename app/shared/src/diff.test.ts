import { describe, it, expect } from 'vitest';
import {
  extractDiffs,
  isDiff,
  isObj,
  normalize,
  normalizeDiffs,
  parseUnifiedDiff,
  parseUnifiedPatch,
  text,
} from './diff';
import type { DiffInput, ReviewDiff } from './diff';

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

// ── parseUnifiedPatch ──────────────────────────────────────────────────

describe('parseUnifiedPatch', () => {
  const simplePatch = [
    '--- a/src/app.ts',
    '+++ b/src/app.ts',
    '@@ -1,3 +1,3 @@',
    ' keep',
    '-old line',
    '+new line',
    ' tail',
  ].join('\n');

  it('parses a single-hunk patch into before/after text and hunks', () => {
    const parsed = parseUnifiedPatch(simplePatch);
    expect(parsed.before).toBe('keep\nold line\ntail\n');
    expect(parsed.after).toBe('keep\nnew line\ntail\n');
    expect(parsed.hunks).toHaveLength(1);
    const lines = parsed.hunks[0]!.lines;
    expect(lines.map((line) => line.type)).toEqual(['context', 'deleted', 'added', 'context']);
    expect(parsed.hunks[0]!.header).toBe('@@ -1,3 +1,3 @@');

    const deleted = lines.find((line) => line.type === 'deleted');
    expect(deleted?.oldLineNumber).toBe(2);
    expect(deleted?.newLineNumber).toBeUndefined();
    const added = lines.find((line) => line.type === 'added');
    expect(added?.newLineNumber).toBe(2);
    expect(added?.oldLineNumber).toBeUndefined();
  });

  it('returns an empty result for an empty patch', () => {
    expect(parseUnifiedPatch('')).toEqual({ before: '', after: '', hunks: [] });
  });

  it('returns an empty result for a malformed patch', () => {
    expect(parseUnifiedPatch('this is not a patch')).toEqual({ before: '', after: '', hunks: [] });
  });

  it('strips the trailing newline flagged by the no-newline marker', () => {
    const patch = [
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1 +1 @@',
      '-old',
      '\\ No newline at end of file',
      '+new',
      '\\ No newline at end of file',
    ].join('\n');
    const parsed = parseUnifiedPatch(patch);
    expect(parsed.before).toBe('old');
    expect(parsed.after).toBe('new');
  });

  it('parses multi-hunk patches into separate hunks', () => {
    const patch = [
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      '@@ -5 +5 @@',
      '-c',
      '+d',
    ].join('\n');
    const parsed = parseUnifiedPatch(patch);
    expect(parsed.hunks).toHaveLength(2);
    expect(parsed.hunks[0]!.header).toBe('@@ -1,1 +1,1 @@');
    expect(parsed.hunks[1]!.header).toBe('@@ -5,1 +5,1 @@');
  });
});

// ── normalize ──────────────────────────────────────────────────────────

describe('normalize', () => {
  function review(overrides: Partial<ReviewDiff>): ReviewDiff {
    return { file: 'src/app.ts', additions: 0, deletions: 0, ...overrides };
  }

  it('parses a valid patch into structured hunks and preserves metadata', () => {
    const patch = ['--- a/f', '+++ b/f', '@@ -1 +1 @@', '-old', '+new'].join('\n');
    const view = normalize(review({ patch, additions: 1, deletions: 1, status: 'modified' }));
    expect(view.file).toBe('src/app.ts');
    expect(view.status).toBe('modified');
    expect(view.hunks).toHaveLength(1);
    expect(view.patch).toBe(patch);
  });

  it('keeps an invalid patch but yields empty hunks', () => {
    const view = normalize(review({ patch: 'garbage', additions: 0, deletions: 0 }));
    expect(view.patch).toBe('garbage');
    expect(view.hunks).toEqual([]);
  });

  it('builds a unified patch from legacy before/after text', () => {
    const view = normalize(review({ before: 'alpha\n', after: 'beta\n' }));
    expect(view.hunks.length).toBeGreaterThan(0);
    expect(text(view, 'deletions')).toContain('alpha');
    expect(text(view, 'additions')).toContain('beta');
  });

  it('returns empty hunks when neither patch nor text is present', () => {
    const view = normalize(review({}));
    expect(view.patch).toBe('');
    expect(view.hunks).toEqual([]);
  });

  it('omits the status field when the source diff has none', () => {
    const view = normalize(review({ before: 'a\n', after: 'b\n' }));
    expect(view.status).toBeUndefined();
  });
});

// ── text ───────────────────────────────────────────────────────────────

describe('text', () => {
  it('extracts only the requested side of a diff', () => {
    const patch = ['--- a/f', '+++ b/f', '@@ -1,2 +1,2 @@', ' same', '-gone', '+added'].join('\n');
    const view = normalize({ file: 'f', patch, additions: 1, deletions: 1 });
    expect(text(view, 'deletions')).toBe('same\ngone\n');
    expect(text(view, 'additions')).toBe('same\nadded\n');
  });
});

// ── normalizeDiffs ─────────────────────────────────────────────────────

describe('normalizeDiffs', () => {
  const valid = { filePath: 'a.ts', status: 'modified', additions: 1, deletions: 2, hunks: [] };

  it('returns an all-valid array unchanged and filters a mixed array', () => {
    expect(normalizeDiffs([valid])).toEqual([valid]);
    expect(normalizeDiffs([valid, { nope: true }, null])).toEqual([valid]);
  });

  it('wraps a single valid object and extracts from keyed objects', () => {
    expect(normalizeDiffs(valid)).toEqual([valid]);
    expect(normalizeDiffs({ one: valid, two: { bad: true } })).toEqual([valid]);
  });

  it('returns empty for primitives and arrays of invalid entries', () => {
    expect(normalizeDiffs('nope')).toEqual([]);
    expect(normalizeDiffs([{ bad: 1 }])).toEqual([]);
    expect(normalizeDiffs(null)).toEqual([]);
  });
});

// ── parseUnifiedDiff ───────────────────────────────────────────────────

describe('parseUnifiedDiff', () => {
  const gitDiff = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 111..222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,2 +1,2 @@',
    ' keep',
    '-old',
    '+new',
    'diff --git a/src/new.ts b/src/new.ts',
    'new file mode 100644',
    'index 000..333',
    '--- /dev/null',
    '+++ b/src/new.ts',
    '@@ -0,0 +1 @@',
    '+created',
    'diff --git a/src/gone.ts b/src/gone.ts',
    'deleted file mode 100644',
    'index 444..000',
    '--- a/src/gone.ts',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-removed',
  ].join('\n');

  it('parses a multi-file git diff into structured DiffFile entries', () => {
    const files = parseUnifiedDiff(gitDiff);
    expect(files.map((file) => file.filePath)).toEqual(['src/a.ts', 'src/new.ts', 'src/gone.ts']);

    const modified = files[0]!;
    expect(modified.status).toBe('modified');
    expect(modified.additions).toBe(1);
    expect(modified.deletions).toBe(1);

    const added = files[1]!;
    expect(added.status).toBe('added');
    expect(added.additions).toBe(1);
    expect(added.deletions).toBe(0);

    const deleted = files[2]!;
    expect(deleted.status).toBe('deleted');
    expect(deleted.additions).toBe(0);
    expect(deleted.deletions).toBe(1);
  });

  it('assigns line numbers per hunk side', () => {
    const files = parseUnifiedDiff(gitDiff);
    const lines = files[0]!.hunks[0]!.lines;
    expect(lines.find((line) => line.type === 'context')?.oldLineNumber).toBe(1);
    expect(lines.find((line) => line.type === 'added')?.newLineNumber).toBeDefined();
    expect(lines.find((line) => line.type === 'added')?.oldLineNumber).toBeUndefined();
    expect(lines.find((line) => line.type === 'deleted')?.oldLineNumber).toBeDefined();
    expect(lines.find((line) => line.type === 'deleted')?.newLineNumber).toBeUndefined();
  });

  it('forces modified status and the given path when filePath is supplied', () => {
    const files = parseUnifiedDiff(gitDiff, 'override.ts');
    expect(files[0]!.filePath).toBe('override.ts');
    expect(files[0]!.status).toBe('modified');
  });

  it('returns empty for empty input and a hunk-less unknown entry for non-diff text', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
    // The diff library's parsePatch is lenient: non-diff text parses to a
    // single header-less patch instead of throwing. The mapper surfaces it as
    // an empty unknown entry rather than crashing.
    expect(parseUnifiedDiff('not a diff at all')).toEqual([
      { filePath: 'unknown', status: 'modified', additions: 0, deletions: 0, hunks: [] },
    ]);
  });
});
