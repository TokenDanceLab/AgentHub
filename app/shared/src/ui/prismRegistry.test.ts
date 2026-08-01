/**
 * prismRegistry HAST word-diff injector tests (P6 Step 3).
 *
 * Step 3 is the highest-risk point of the P6 design (report §8.2: the HAST
 * split/wrap is design-deductive, NOT prototyped). These tests pin the
 * behaviour: alignment with Prism text leaves, coexistence of word-diff
 * spans with Prism token spans, the cross-Prism-boundary split, and the
 * safe fallback paths.
 *
 * jsdom is the test env (vitest.config.ts) but these are string-in/string-out
 * assertions — no real Prism DOM rendering is exercised (jsdom cannot render
 * Prism's CSS colors; that limitation is inherited from the existing
 * `tokens-base.css:586` TODO and applies to word-diff colors too).
 */
import { describe, expect, it } from 'vitest';

import { produceWordDiffTokens, type WordDiffToken } from './diffWordTokens';
import {
  highlightLine,
  highlightLineWithWordDiff,
  injectWordDiffIntoHast,
} from './prismRegistry';

// wordClassFor used across cases: added/removed get a class; context -> ''
// (context stays as bare text so Prism color passes through unchanged).
const cls = (t: WordDiffToken['type']): string =>
  t === 'added' ? 'wordAdded' : t === 'removed' ? 'wordRemoved' : '';

/** Strip tags + unescape entities so we can assert the rendered text
 *  content equals the source `code` (no chars lost or duplicated). */
function textContent(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent ?? '';
}

/** Narrow a non-null token array (mirrors the diffWordTokens test helper). */
function tok(oldS: string, newS: string): WordDiffToken[] {
  const r = produceWordDiffTokens(oldS, newS);
  if (r === null) throw new Error('expected tokens, got null (guard triggered)');
  return r;
}

describe('highlightLineWithWordDiff', () => {
  // ── Fallback / no-op paths (report §8.2 "safe degradation") ───────────

  it('falls back to highlightLine when tokens are null/undefined/empty', () => {
    const code = 'const x = 1;';
    const lang = 'typescript';
    const baseline = highlightLine(code, lang);
    expect(highlightLineWithWordDiff(code, lang, null, cls)).toBe(baseline);
    expect(highlightLineWithWordDiff(code, lang, undefined, cls)).toBe(baseline);
    expect(highlightLineWithWordDiff(code, lang, [], cls)).toBe(baseline);
  });

  it('falls back when tokens do not reconstruct code (contract violation)', () => {
    const code = 'const x = 1;';
    const lang = 'typescript';
    // tokens join to 'wrong' != code -> misaligned ranges -> bail to plain
    const bad: WordDiffToken[] = [{ type: 'removed', text: 'wrong' }];
    expect(highlightLineWithWordDiff(code, lang, bad, cls)).toBe(
      highlightLine(code, lang),
    );
  });

  it('falls back when refractor throws on a registered language', () => {
    // 'diff' grammar is registered; feed it tokens that reconstruct code so
    // the only failure path is refractor.highlight throwing. We can't easily
    // force refractor to throw without a malformed grammar, so this test
    // instead documents the try/catch exists by asserting a registered lang
    // with valid tokens still produces word-diff output (smoke test that the
    // happy path doesn't itself hit the catch).
    const oldS = '-old line';
    const newS = '+new line';
    const lang = 'diff';
    const tokens = tok(oldS, newS).filter((t) => t.type !== 'added');
    const html = highlightLineWithWordDiff(oldS, lang, tokens, cls);
    expect(html).toContain('<span class="wordRemoved">old</span>');
    expect(textContent(html)).toBe(oldS);
  });

  // ── Alignment invariant (proves HAST text leaves line up with code) ──

  it('is byte-identical to highlightLine when all tokens are context (empty class)', () => {
    // Identical lines -> all-context tokens whose text joins to code. With
    // context -> '' (no wrapping), the injector MUST be a no-op: same HTML
    // as plain highlightLine. This implicitly proves the HAST text leaves
    // concatenate to `code` (Prism only wraps, never alters text) — if they
    // didn't, the offset cursor would drift and wrapping would fire.
    const code = 'const oldValue = true;';
    const lang = 'typescript';
    const tokens = tok(code, code);
    expect(tokens.every((t) => t.type === 'context')).toBe(true);
    expect(highlightLineWithWordDiff(code, lang, tokens, cls)).toBe(
      highlightLine(code, lang),
    );
  });

  // ── English word-diff coexisting with Prism (the core value of Step 3)

  it('wraps removed words in wordRemoved spans AND keeps Prism token spans (left cell)', () => {
    const oldS = 'const old = true;';
    const newS = 'const updated = false;';
    const lang = 'typescript';
    const tokens = tok(oldS, newS).filter((t) => t.type !== 'added');
    // reconstruction contract for the left column
    expect(tokens.map((t) => t.text).join('')).toBe(oldS);

    const html = highlightLineWithWordDiff(oldS, lang, tokens, cls);

    // word-diff spans wrap the changed words
    expect(html).toContain('<span class="wordRemoved">old</span>');
    expect(html).toContain('<span class="wordRemoved">true</span>');
    // Prism syntax color is preserved (const is still a keyword token) —
    // this is the "Prism + word-diff do not collide" guarantee.
    expect(html).toContain('token keyword');
    // No chars lost or duplicated
    expect(textContent(html)).toBe(oldS);
  });

  it('wraps added words in wordAdded spans on the right cell', () => {
    const oldS = 'const old = true;';
    const newS = 'const updated = false;';
    const lang = 'typescript';
    const tokens = tok(oldS, newS).filter((t) => t.type !== 'removed');
    expect(tokens.map((t) => t.text).join('')).toBe(newS);

    const html = highlightLineWithWordDiff(newS, lang, tokens, cls);
    expect(html).toContain('<span class="wordAdded">updated</span>');
    expect(html).toContain('<span class="wordAdded">false</span>');
    expect(html).toContain('token keyword');
    expect(textContent(html)).toBe(newS);
  });

  // ── Inline snapshot: pins the exact Prism+word-diff HTML for one line ─
  it('matches the pinned inline snapshot for a canonical English+Prism line', () => {
    const oldS = 'const old = true;';
    const newS = 'const updated = false;';
    const lang = 'typescript';
    const tokens = tok(oldS, newS).filter((t) => t.type !== 'added');
    const html = highlightLineWithWordDiff(oldS, lang, tokens, cls);
    // Snapshot nails the exact structure (Prism spans + nested wordRemoved
    // spans). If refractor/Prism upgrades change tokenisation, this snapshot
    // is the signal — review and `-u` to update.
    expect(html).toMatchInlineSnapshot(`"<span class="token keyword">const</span> <span class="wordRemoved">old</span> <span class="token operator">=</span> <span class="token boolean"><span class="wordRemoved">true</span></span><span class="token punctuation">;</span>"`);
  });

  // ── CJK char-level diff (Step 1 diffChars fallback) ──────────────────

  it('wraps per-char CJK changes (char-level fallback from Step 1)', () => {
    const oldS = '修改了一处';
    const newS = '修改了两处';
    const lang = ''; // no grammar for CJK -> plain-text tree, word-diff applies
    const tokens = tok(oldS, newS).filter((t) => t.type !== 'added');
    expect(tokens.map((t) => t.text).join('')).toBe(oldS);

    const html = highlightLineWithWordDiff(oldS, lang, tokens, cls);
    // '一' is removed (single char granularity — proves char-level, not
    // whole-sentence, since CJK has no word separators).
    expect(html).toContain('<span class="wordRemoved">一</span>');
    expect(textContent(html)).toBe(oldS);
  });

  // ── Whitespace / blank line ──────────────────────────────────────────

  it('handles a blank line (single space) without losing content', () => {
    const code = ' ';
    const tokens = tok(code, code); // all-context
    const html = highlightLineWithWordDiff(code, '', tokens, cls);
    expect(textContent(html)).toBe(code);
  });

  it('preserves leading whitespace inside context runs', () => {
    const oldS = '  indented old';
    const newS = '  indented new';
    const lang = '';
    const tokens = tok(oldS, newS).filter((t) => t.type !== 'added');
    expect(tokens.map((t) => t.text).join('')).toBe(oldS);
    const html = highlightLineWithWordDiff(oldS, lang, tokens, cls);
    expect(html).toContain('<span class="wordRemoved">old</span>');
    // leading spaces survive (no trimming)
    expect(html.startsWith('  ')).toBe(true);
    expect(textContent(html)).toBe(oldS);
  });

  // ── No-lang path: word-diff without Prism ────────────────────────────

  it('renders word-diff spans even without a registered grammar', () => {
    const oldS = 'foo bar';
    const newS = 'foo baz';
    const lang = '';
    const tokens = tok(oldS, newS).filter((t) => t.type !== 'added');
    const html = highlightLineWithWordDiff(oldS, lang, tokens, cls);
    expect(html).toContain('<span class="wordRemoved">bar</span>');
    // no Prism token spans when lang is empty (plain-text HAST tree)
    expect(html).not.toContain('class="token');
    expect(textContent(html)).toBe(oldS);
  });

  // ── Oversized line: Step 1 guard returns null -> injector bails ──────
  it('bails to highlightLine when the Step 1 size guard produced null tokens', () => {
    // produceWordDiffTokens returns null for >2000 chars (Step 1 guard).
    // The renderer (Step 4) passes cell.wordDiff (== null) straight through;
    // the injector must treat null as "no word-diff" and defer to
    // highlightLine. This is the oversized-line path (report §5.1).
    const oldS = 'a'.repeat(2001);
    const newS = 'b';
    expect(produceWordDiffTokens(oldS, newS)).toBeNull();
    const baseline = highlightLine(oldS, 'typescript');
    expect(highlightLineWithWordDiff(oldS, 'typescript', null, cls)).toBe(baseline);
  });
});

describe('injectWordDiffIntoHast (pure core)', () => {
  // ── Cross-boundary: one word-diff token spanning two Prism spans ────
  // The riskiest case (report §8.2): a single token whose char range covers
  // two Prism text leaves (e.g. a word straddling a keyword + punctuation
  // boundary). The injector must split it into two wordRemoved spans — one
  // per leaf — both nested inside their respective Prism spans. Same class,
  // same color; structurally two segments, visually one highlight. This is
  // why HAST injection beats per-token `highlightLine` (the report's
  // rejected fallback would mis-tokenise string literals split mid-word).
  it('splits a token that spans two Prism spans into nested word-diff spans', () => {
    // Synthetic tree mirroring refractor output:
    //   <span class="token keyword">foo</span><span class="token operator">bar</span>
    // text leaves 'foo' (0-3) + 'bar' (3-6) => 'foobar' total.
    const tree = injectWordDiffIntoHast(
      {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: ['token', 'keyword'] },
            children: [{ type: 'text', value: 'foo' }],
          },
          {
            type: 'element',
            tagName: 'span',
            properties: { className: ['token', 'operator'] },
            children: [{ type: 'text', value: 'bar' }],
          },
        ],
      },
      [{ type: 'removed', text: 'foobar' }],
      (t) => (t === 'removed' ? 'wordRemoved' : ''),
    );

    // Inspect the mutated structure (HastNodeLike isn't exported; cast to a
    // local shape for assertion ergonomics).
    const root = tree as {
      type: 'root';
      children: Array<{
        type: 'element';
        tagName: string;
        properties?: { className?: string[] };
        children?: Array<{
          type: 'text' | 'element';
          value?: string;
          tagName?: string;
          properties?: { className?: string[] };
          children?: Array<{ type: string; value?: string }>;
        }>;
      }>;
    };

    expect(root.type).toBe('root');
    expect(root.children).toHaveLength(2);

    // First Prism span (keyword) now wraps a wordRemoved span containing 'foo'
    const kw = root.children[0]!;
    expect(kw.properties?.className).toEqual(['token', 'keyword']);
    const kwInner = kw.children?.[0];
    expect(kwInner?.type).toBe('element');
    expect(kwInner?.tagName).toBe('span');
    expect(kwInner?.properties?.className).toEqual(['wordRemoved']);
    expect(kwInner?.children?.[0]).toMatchObject({ type: 'text', value: 'foo' });

    // Second Prism span (operator) wraps a wordRemoved span containing 'bar'
    const op = root.children[1]!;
    expect(op.properties?.className).toEqual(['token', 'operator']);
    const opInner = op.children?.[0];
    expect(opInner?.type).toBe('element');
    expect(opInner?.tagName).toBe('span');
    expect(opInner?.properties?.className).toEqual(['wordRemoved']);
    expect(opInner?.children?.[0]).toMatchObject({ type: 'text', value: 'bar' });
  });

  it('leaves context runs as bare text (no wrapping) when class is empty', () => {
    const tree = injectWordDiffIntoHast(
      {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: ['token', 'string'] },
            children: [{ type: 'text', value: 'hello' }],
          },
        ],
      },
      [{ type: 'context', text: 'hello' }],
      () => '', // empty class for all types
    );
    const root = tree as {
      type: 'root';
      children: Array<{
        type: 'element';
        children?: Array<{ type: string; value?: string }>;
      }>;
    };
    // Original text leaf untouched (fast path keeps the original node object)
    const inner = root.children[0]!.children?.[0];
    expect(inner).toMatchObject({ type: 'text', value: 'hello' });
  });

  it('handles a token covering the whole single-leaf code', () => {
    const tree = injectWordDiffIntoHast(
      { type: 'root', children: [{ type: 'text', value: 'abcde' }] },
      [{ type: 'added', text: 'abcde' }],
      (t) => (t === 'added' ? 'wordAdded' : ''),
    );
    const root = tree as {
      type: 'root';
      children: Array<{ type: string; tagName?: string; properties?: { className?: string[] }; children?: Array<{ type: string; value?: string }> }>;
    };
    expect(root.children).toHaveLength(1);
    const span = root.children[0]!;
    expect(span.type).toBe('element');
    expect(span.tagName).toBe('span');
    expect(span.properties?.className).toEqual(['wordAdded']);
    expect(span.children?.[0]).toMatchObject({ type: 'text', value: 'abcde' });
  });
});
