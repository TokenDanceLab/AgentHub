import { describe, expect, it } from 'vitest';
import {
  produceWordDiffTokens,
  shouldSkipWordDiff,
  type WordDiffToken,
} from './diffWordTokens';

/** Helper: narrow non-null token array for assertion ergonomics. */
function tokens(oldS: string, newS: string): WordDiffToken[] {
  const result = produceWordDiffTokens(oldS, newS);
  if (result === null) throw new Error('expected tokens, got null (guard triggered)');
  return result;
}

describe('produceWordDiffTokens', () => {
  // ── English word-level diff ───────────────────────────────────────────
  it('maps an English word swap into added/removed/context tokens', () => {
    const t = tokens('hello world', 'hello earth');
    expect(t.some((x) => x.type === 'removed')).toBe(true);
    expect(t.some((x) => x.type === 'added')).toBe(true);
    expect(t.some((x) => x.type === 'context')).toBe(true);
    expect(t.filter((x) => x.type === 'removed').map((x) => x.text).join('')).toBe('world');
    expect(t.filter((x) => x.type === 'added').map((x) => x.text).join('')).toBe('earth');
    expect(t.filter((x) => x.type === 'context').map((x) => x.text).join('')).toContain('hello');
  });

  // ── CJK char-level fallback ───────────────────────────────────────────
  it('uses char-level diff for CJK-dominant lines (a context token proves per-char granularity)', () => {
    // diffWords would collapse the whole sentence to one token (no spaces)
    // and produce NO context. diffChars splits per char -> context 你好.
    const t = tokens('你好世界', '你好地球');
    const context = t.filter((x) => x.type === 'context');
    expect(context.length).toBe(1);
    expect(context[0]!.text).toBe('你好');
    expect(t.filter((x) => x.type === 'removed').map((x) => x.text).join('')).toBe('世界');
    expect(t.filter((x) => x.type === 'added').map((x) => x.text).join('')).toBe('地球');
  });

  it('keeps CJK diff correct when only trailing chars change', () => {
    const t = tokens('修改了一处', '修改了两处');
    expect(t.filter((x) => x.type === 'context').map((x) => x.text).join('')).toBe('修改了处');
    expect(t.filter((x) => x.type === 'removed').map((x) => x.text).join('')).toBe('一');
    expect(t.filter((x) => x.type === 'added').map((x) => x.text).join('')).toBe('两');
  });

  // ── Oversized line guard ──────────────────────────────────────────────
  it('skips word-diff when a line exceeds the char guard (>2000) and returns null', () => {
    expect(produceWordDiffTokens('a'.repeat(2001), 'b')).toBeNull();
    expect(produceWordDiffTokens('a', 'b'.repeat(2001))).toBeNull();
  });

  it('does NOT skip at the char boundary (exactly 2000 chars)', () => {
    const same = 'a'.repeat(2000);
    const t = produceWordDiffTokens(same, same);
    expect(t).not.toBeNull();
    expect(t!.every((x) => x.type === 'context')).toBe(true);
  });

  it('skips word-diff when a line exceeds the word guard (>500 words, under char limit)', () => {
    // 501 single-char words joined by spaces: 1001 chars (< 2000), 501 words
    const manyWords = Array.from({ length: 501 }, () => 'a').join(' ');
    expect(manyWords.length).toBeLessThan(2000);
    expect(produceWordDiffTokens(manyWords, 'b')).toBeNull();
  });

  it('exposes shouldSkipWordDiff as a pure guard predicate', () => {
    expect(shouldSkipWordDiff('a'.repeat(2001), 'b')).toBe(true);
    expect(shouldSkipWordDiff('a', 'b'.repeat(2001))).toBe(true);
    expect(shouldSkipWordDiff('a', 'b')).toBe(false);
  });

  // ── Empty / identical lines ───────────────────────────────────────────
  it('returns all-context tokens for identical lines', () => {
    const t = tokens('hello world', 'hello world');
    expect(t.every((x) => x.type === 'context')).toBe(true);
    expect(t.map((x) => x.text).join('')).toBe('hello world');
  });

  it('handles empty lines as all-context (or empty array)', () => {
    const t = produceWordDiffTokens('', '');
    expect(t).not.toBeNull();
    expect(t!.every((x) => x.type === 'context')).toBe(true);
    expect(t!.map((x) => x.text).join('')).toBe('');
  });

  // ── Pure added / pure removed ─────────────────────────────────────────
  it('returns all-added tokens when old is empty (pure insertion)', () => {
    const t = tokens('', 'brand new line');
    expect(t.every((x) => x.type === 'added')).toBe(true);
    expect(t.map((x) => x.text).join('')).toBe('brand new line');
  });

  it('returns all-removed tokens when new is empty (pure deletion)', () => {
    const t = tokens('doomed line', '');
    expect(t.every((x) => x.type === 'removed')).toBe(true);
    expect(t.map((x) => x.text).join('')).toBe('doomed line');
  });

  // ── Reconstruction contract ───────────────────────────────────────────
  it('reconstructs old from removed+context and new from added+context', () => {
    const oldS = 'the quick brown fox';
    const newS = 'the slow brown cat';
    const t = tokens(oldS, newS);
    const reconstructedOld = t.filter((x) => x.type !== 'added').map((x) => x.text).join('');
    const reconstructedNew = t.filter((x) => x.type !== 'removed').map((x) => x.text).join('');
    expect(reconstructedOld).toBe(oldS);
    expect(reconstructedNew).toBe(newS);
  });

  // ── Whitespace preserved ───────────────────────────────────────────────
  it('preserves whitespace inside token text (space survives in context runs)', () => {
    // jsdiff diffWords keeps whitespace in `value`: the shared 'foo ' (with
    // its trailing space) surfaces as a context token, not stripped.
    const t = tokens('foo bar', 'foo baz');
    const context = t.filter((x) => x.type === 'context').map((x) => x.text).join('');
    expect(context).toBe('foo ');
  });

  it('treats a pure-whitespace change as context (diffWords ignores ws for diff)', () => {
    // NOTE: this contradicts P6 report §5.3's claim that diffWords flags
    // whitespace-only changes as token changes. jsdiff's own docstring says
    // "Whitespace is ignored when computing the diff"; flagging whitespace
    // changes would require `diffWordsWithSpace`. Pinned here to document the
    // actual behavior — revisit if reviewers want whitespace-flagging.
    const t = tokens('  indented', '    indented');
    expect(t.every((x) => x.type === 'context')).toBe(true);
  });
});
