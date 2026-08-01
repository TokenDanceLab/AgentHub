/**
 * Shared Prism language registry.
 *
 * Registers common languages on a single refractor instance and provides
 * low-level highlight helpers used by diff viewers and code previews.
 *
 * react-syntax-highlighter's PrismLight uses the same refractor instance
 * (ESM singleton), so languages registered here are also available to
 * <SyntaxHighlighter> in Markdown.tsx.
 */
import { refractor } from 'refractor/core';

import type { WordDiffToken } from './DiffReviewPanelTypes';

// ── Language grammar imports ──────────────────────────────────────────

import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import diff from 'react-syntax-highlighter/dist/esm/languages/prism/diff';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';

// ── Register all grammars ──────────────────────────────────────────────

refractor.register(tsx);
refractor.register(typescript);
refractor.register(javascript);
refractor.register(jsx);
refractor.register(bash);
refractor.register(json);
refractor.register(css);
refractor.register(python);
refractor.register(markdown);
refractor.register(diff);
refractor.register(yaml);
refractor.register(rust);
refractor.register(go);
refractor.register(sql);

// ── Aliases ────────────────────────────────────────────────────────────

refractor.alias('js', 'javascript');
refractor.alias('jsx', 'javascript'); // jsx extends javascript grammar
refractor.alias('sh', 'bash');
refractor.alias('shell', 'bash');
refractor.alias('py', 'python');
refractor.alias('md', 'markdown');
refractor.alias('yml', 'yaml');

// ── Extension → language mapping ───────────────────────────────────────

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  pyi: 'python',
  pyx: 'python',
  css: 'css',
  scss: 'css',
  less: 'css',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  rs: 'rust',
  go: 'go',
  md: 'markdown',
  mdx: 'markdown',
  html: 'markup',
  htm: 'markup',
  xml: 'markup',
  svg: 'markup',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  proto: 'protobuf',
  dockerfile: 'docker',
  env: 'bash',
  gitignore: 'bash',
  editorconfig: 'ini',
  txt: '',
};

/**
 * Detect language from a file path extension.
 * Returns '' for unknown extensions (falls back to plain text).
 */
export function languageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_LANG[ext] ?? '';
}

// ── HAST → HTML conversion ─────────────────────────────────────────────

// HAST node shapes (compatible with hast Root/Element/Text from refractor output)
interface HastTextLike {
  type: 'text';
  value: string;
}

interface HastElementLike {
  type: 'element';
  tagName: string;
  properties?: { className?: string[]; [key: string]: unknown };
  children?: Array<HastTextLike | HastElementLike>;
}

type HastNodeLike =
  | HastTextLike
  | HastElementLike
  | { type: 'root'; children?: Array<HastTextLike | HastElementLike> };

function hastToHtml(node: HastNodeLike): string {
  if (node.type === 'text') {
    return escapeHtml((node as HastTextLike).value);
  }
  if (node.type === 'element') {
    const el = node as HastElementLike;
    const classes = el.properties?.className;
    const classAttr =
      classes && classes.length > 0
        ? ` class="${classes.join(' ')}"`
        : '';
    const children = (el.children ?? []).map(hastToHtml).join('');
    if (VOID_ELEMENTS.has(el.tagName)) {
      return `<${el.tagName}${classAttr} />`;
    }
    return `<${el.tagName}${classAttr}>${children}</${el.tagName}>`;
  }
  // type === 'root' or fallback
  if ('children' in node && Array.isArray(node.children)) {
    return (node.children as HastNodeLike[]).map(hastToHtml).join('');
  }
  return '';
}

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// ── HTML escaping (fallback / plain text) ──────────────────────────────

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch] ?? ch);
}

// ── Highlight helpers ──────────────────────────────────────────────────

/**
 * Syntax-highlight a single line of code.
 * Returns an HTML string with Prism token spans.
 */
export function highlightLine(code: string, lang: string): string {
  if (!lang || !refractor.registered(lang)) {
    return escapeHtml(code);
  }
  try {
    const tree = refractor.highlight(code, lang);
    return hastToHtml(tree as HastNodeLike);
  } catch {
    return escapeHtml(code);
  }
}

/**
 * Syntax-highlight a block of code, preserving line breaks.
 * Returns an HTML string with Prism token spans and newlines.
 */
export function highlightBlock(code: string, lang: string): string {
  if (!lang || !refractor.registered(lang)) {
    return escapeHtml(code);
  }
  try {
    const lines = code.split('\n');
    return lines
      .map((line) => {
        const tree = refractor.highlight(line, lang);
        return hastToHtml(tree as HastNodeLike);
      })
      .join('\n');
  } catch {
    return escapeHtml(code);
  }
}

// ── Word-diff HAST injection (P6 Step 3) ──────────────────────────────
//
// Goal: render per-word added/removed highlights INSIDE a Prism-highlighted
// line without dropping syntax color. We do this at the HAST layer (after
// refractor tokenises, before hastToHtml serialises) so word-diff <span>s
// nest inside Prism token <span>s — the two do not collide.
//
// P6 design report §4.3 + §8.2: this is the highest-risk step — the HAST
// split/wrap is design-deductive, NOT prototyped in the report. Snapshot
// tests below pin the behaviour; the pure function is defensive (falls
// back to plain `highlightLine` on any contract violation or Prism error).
//
// Reconstruction contract (from Step 1/2): the per-column token stream
// joins back to the cell's `content` (== `code`). Left cell holds
// removed+context; right cell holds added+context. So `tokens` always
// covers `[0, code.length)` with no gaps — which is what makes the
// char-range alignment with HAST text leaves well-defined.

/** A child node of an element/root (text or element — never root). */
type HastChild = HastTextLike | HastElementLike;

/** A word-diff token anchored to an absolute char range in `code`. */
interface WordDiffRange {
  type: WordDiffToken['type'];
  start: number;
  end: number;
}

/** Mutable offset cursor threaded through the DFS. */
interface OffsetCursor {
  offset: number;
}

/**
 * Map a flat token stream (whose `text` joins to `code`) to absolute char
 * ranges covering `[0, code.length)` with no gaps and no overlaps. Trusts
 * the reconstruction contract; the public entry re-validates it.
 */
function computeWordDiffRanges(tokens: readonly WordDiffToken[]): WordDiffRange[] {
  const ranges: WordDiffRange[] = [];
  let offset = 0;
  for (const t of tokens) {
    ranges.push({ type: t.type, start: offset, end: offset + t.text.length });
    offset += t.text.length;
  }
  return ranges;
}

/**
 * Partition a text leaf's `value` by the word-diff ranges overlapping it,
 * wrapping each partition in a `<span class=…>` element when
 * `wordClassFor(type)` returns a non-empty class. Context runs (and any
 * token whose class is empty) stay as bare text nodes — so Prism
 * highlighting passes through untouched inside them.
 *
 * A single word-diff range that spans several Prism token boundaries (e.g.
 * one word covering a keyword span + a punctuation span) produces several
 * span elements, one per text-leaf segment. Same class, same color —
 * visually identical, structurally harmless (report §4.3).
 */
function wrapTextNodeValue(
  value: string,
  nodeStart: number,
  ranges: readonly WordDiffRange[],
  wordClassFor: (t: WordDiffToken['type']) => string,
): HastChild[] {
  const nodeEnd = nodeStart + value.length;
  const out: HastChild[] = [];
  let cursor = 0; // relative to `value`

  for (const r of ranges) {
    if (r.start >= nodeEnd) break; // past this leaf (ranges are ordered)
    if (r.end <= nodeStart) continue; // before this leaf (defensive)

    const segStart = Math.max(0, r.start - nodeStart);
    const segEnd = Math.min(value.length, r.end - nodeStart);
    if (segEnd <= segStart) continue;

    // Gap before this segment — surface as bare text. Shouldn't fire under
    // the contiguous-coverage contract, but keeps the function total.
    if (segStart > cursor) {
      out.push({ type: 'text', value: value.slice(cursor, segStart) });
    }

    const segment = value.slice(segStart, segEnd);
    const cls = wordClassFor(r.type);
    if (cls) {
      out.push({
        type: 'element',
        tagName: 'span',
        properties: { className: [cls] },
        children: [{ type: 'text', value: segment }],
      });
    } else {
      out.push({ type: 'text', value: segment });
    }
    cursor = segEnd;
  }

  if (cursor < value.length) {
    out.push({ type: 'text', value: value.slice(cursor) });
  }
  return out;
}

/**
 * DFS the HAST tree, replacing every text leaf with its word-diff-wrapped
 * partition. `cursor.offset` advances across text leaves in document order,
 * which matches the order refractor tokenised `code` — so a text leaf's
 * absolute range is `[cursor.offset, cursor.offset + value.length)`.
 *
 * Mutates `node` in place. The caller MUST pass a freshly-built tree (the
 * public entry does this via `refractor.highlight`), so the mutation has no
 * externally-observable aliasing — the function is pure from a caller POV.
 */
function injectWordDiffWalk(
  node: HastChild,
  ranges: readonly WordDiffRange[],
  wordClassFor: (t: WordDiffToken['type']) => string,
  cursor: OffsetCursor,
): HastChild[] {
  if (node.type === 'text') {
    const start = cursor.offset;
    cursor.offset = start + node.value.length;
    const replaced = wrapTextNodeValue(node.value, start, ranges, wordClassFor);
    // Fast path: when no wrapping occurred, keep the ORIGINAL node object so
    // the serialized HTML is byte-identical to the no-word-diff baseline
    // (lets the all-context / empty-class case equal `highlightLine`).
    if (replaced.length === 1) {
      const only = replaced[0];
      if (only && only.type === 'text' && only.value === node.value) {
        return [node];
      }
    }
    return replaced;
  }

  // element: recurse, rebuild children, flatten replacements
  const newChildren: HastChild[] = [];
  for (const child of node.children ?? []) {
    for (const r of injectWordDiffWalk(child, ranges, wordClassFor, cursor)) {
      newChildren.push(r);
    }
  }
  node.children = newChildren;
  return [node];
}

/**
 * Inject word-diff `<span>` elements into a HAST tree (pure core).
 *
 * `tokens` MUST join back to the source string that produced `hastRoot`
 * (the reconstruction contract). The function trusts this and does not
 * re-validate — use {@link highlightLineWithWordDiff} for the validated
 * public entry. Returns the same root object, mutated.
 *
 * Exported so callers building their own HAST (e.g. tests) can apply it
 * directly; normal rendering goes through `highlightLineWithWordDiff`.
 */
export function injectWordDiffIntoHast(
  hastRoot: HastNodeLike,
  tokens: readonly WordDiffToken[],
  wordClassFor: (t: WordDiffToken['type']) => string,
): HastNodeLike {
  const ranges = computeWordDiffRanges(tokens);
  const cursor: OffsetCursor = { offset: 0 };

  if (hastRoot.type === 'root' || hastRoot.type === 'element') {
    // Both root and element expose `children?: Array<HastChild>`.
    const parent = hastRoot as HastElementLike;
    const children = (parent.children ?? []) as HastChild[];
    const newChildren: HastChild[] = [];
    for (const child of children) {
      for (const r of injectWordDiffWalk(child, ranges, wordClassFor, cursor)) {
        newChildren.push(r);
      }
    }
    parent.children = newChildren;
  }
  return hastRoot;
}

/**
 * Syntax-highlight a single line AND layer per-word added/removed spans on
 * top, preserving Prism syntax color (word-diff spans nest inside Prism
 * token spans — the two do not collide).
 *
 * Pure: `code` + `lang` + `tokens` + `wordClassFor` → HTML string. Zero
 * React/DOM/protocol coupling.
 *
 * `tokens` is the per-column word-diff stream (left = removed+context,
 * right = added+context) whose `text` joins back to `code`. `null`/
 * `undefined` is accepted and falls back to plain {@link highlightLine} —
 * this is the oversized-line / guard-skipped path (report §5.1) so Step 4's
 * renderer can pass `cell.wordDiff` through unconditionally.
 *
 * `wordClassFor(type)` returns the CSS class for a token type; returning `''`
 * leaves that token unwrapped (recommended for `context` — Prism color
 * shows through unchanged).
 *
 * Safety: if `tokens` don't reconstruct `code`, or refractor throws, the
 * function degrades to `highlightLine(code, lang)` rather than emit
 * misaligned word-diff spans.
 */
export function highlightLineWithWordDiff(
  code: string,
  lang: string,
  tokens: WordDiffToken[] | null | undefined,
  wordClassFor: (t: WordDiffToken['type']) => string,
): string {
  if (!tokens || tokens.length === 0) {
    return highlightLine(code, lang);
  }
  // Contract gate: misaligned ranges would wrap the wrong substrings, so
  // bail to plain highlight rather than render garbage.
  if (tokens.map((t) => t.text).join('') !== code) {
    return highlightLine(code, lang);
  }

  let tree: HastNodeLike;
  if (lang && refractor.registered(lang)) {
    try {
      tree = refractor.highlight(code, lang) as HastNodeLike;
    } catch {
      return highlightLine(code, lang);
    }
  } else {
    // No grammar registered: skip Prism but still render word-diff spans
    // (per-word highlights remain useful without syntax color). Build a
    // minimal plain-text HAST tree so the same injection path applies.
    tree = {
      type: 'root',
      children: [{ type: 'text', value: code }],
    } as HastNodeLike;
  }

  injectWordDiffIntoHast(tree, tokens, wordClassFor);
  return hastToHtml(tree);
}
