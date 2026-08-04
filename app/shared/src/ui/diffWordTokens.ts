/**
 * Word-diff token producer (P6 Step 1).
 *
 * Pure function: maps jsdiff's word/char-level diff into a flat token stream
 * for later rendering inside DiffReviewPanel modified rows. Zero React/DOM/
 * protocol coupling. Reuses the existing `diff` (jsdiff v8) dependency — no
 * new deps; `diff.ts` already imports from the same package.
 *
 * Step 2 lift (done): `WordDiffToken` now lives in `DiffReviewPanelTypes.ts`
 * beside the diff-row types that consume it; this module re-exports it for
 * backward compatibility with existing callers/tests. Step 3 will wire the
 * tokens into the HAST word-diff injector in `prismRegistry.ts` (rendering
 * stays untouched here).
 *
 * Boundaries (see P6 design report §5):
 *  - CJK-dominant lines fall back to `diffChars` (Chinese has no word
 *    separators, so `diffWords` would treat a whole sentence as one token).
 *  - Oversized lines (>800 chars or >200 words) skip word-diff entirely
 *    (returns null) so the caller falls back to whole-line Prism highlight,
 *    avoiding O(n*m) LCS blow-up on minified/long lines.
 *  - Whitespace is preserved (jsdiff `diffWords` keeps whitespace in `value`).
 */
import { diffWords, diffChars } from 'diff';

// ── Types ────────────────────────────────────────────────────────────────

// `WordDiffToken` is the canonical type for diff-row consumers; it lives in
// DiffReviewPanelTypes.ts. Re-export here so existing imports of
// `diffWordTokens` (e.g. its own test file) keep resolving unchanged.
import type { WordDiffToken } from './DiffReviewPanelTypes';
export type { WordDiffToken };

// ── Guards / heuristics ──────────────────────────────────────────────────

/** Max line length (chars) before word-diff is skipped to avoid O(n*m) cost. */
const MAX_LINE_CHARS = 800;
/** Max line word count before word-diff is skipped. */
const MAX_LINE_WORDS = 200;
/** CJK char share above which a line is treated as CJK-dominant (-> diffChars). */
const CJK_DENSITY_THRESHOLD = 0.5;

// CJK Unified Ideographs + Hiragana/Katakana + Hangul Syllables.
const CJK_RE = /[一-鿿぀-ヿ가-힯]/g;

/**
 * Fail-safe guard: returns true when either side exceeds the size thresholds,
 * meaning word-diff must be skipped so the caller falls back to whole-line
 * highlight (line-level diff stays available for any line length).
 *
 * Threshold semantics:
 *  - `MAX_LINE_CHARS` (800): combined guard for a single line side. 800 chars
 *    already covers real-world diff lines (a typical code line is <200 chars;
 *    minified/long lines almost always exceed it).
 *  - `MAX_LINE_WORDS` (200): word-count guard for whitespace-heavy prose
 *    (e.g. pasted paragraphs). 200 words ≈ 1,000-1,200 chars, so it only
 *    triggers for lines that are long by the prose standard but compact.
 *
 * Calibration rationale (issue #1505): word-diff runs jsdiff's O(n*m) LCS
 * on every modified line pair inside DiffReviewPanel; the previous
 * 2000-char / 500-word limits let pathological minified lines through, which
 * could freeze the UI thread on large diffs. The values below are a
 * deliberately conservative fail-safe: they keep word-diff for all normal
 * edit lines while capping worst-case work with ample safety margin. Lines
 * over the guard lose word-level granularity but never lose readability —
 * whole-line Prism highlight is the fallback.
 */
export function shouldSkipWordDiff(oldContent: string, newContent: string): boolean {
  if (oldContent.length > MAX_LINE_CHARS || newContent.length > MAX_LINE_CHARS) {
    return true;
  }
  const oldWords = countWords(oldContent);
  const newWords = countWords(newContent);
  return oldWords > MAX_LINE_WORDS || newWords > MAX_LINE_WORDS;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

/**
 * Heuristic: is this line CJK-dominant? When true, `diffWords` is useless
 * (no word separators -> whole sentence collapses to one token), so we use
 * `diffChars` for per-character granularity — what Chinese readers expect.
 *
 * Limitation (report §5.2): mixed CJK+Latin lines pick ONE granularity for
 * the whole line; we don't mix word/char granularity within a line. The
 * density threshold (0.5) is a heuristic, not a tuned parameter.
 */
function isCjkDominant(a: string, b: string): boolean {
  const combined = a + b;
  if (!combined) return false;
  const matches = combined.match(CJK_RE);
  const cjkCount = matches ? matches.length : 0;
  return cjkCount / combined.length > CJK_DENSITY_THRESHOLD;
}

// ── Token producer ───────────────────────────────────────────────────────

/** Structural subset of jsdiff's ChangeObject<string> (avoids coupling to
 *  jsdiff's internal type export surface; we only read these three fields). */
type JsDiffChange = { value: string; added: boolean; removed: boolean };

function toToken(change: JsDiffChange): WordDiffToken {
  return {
    type: change.added ? 'added' : change.removed ? 'removed' : 'context',
    text: change.value,
  };
}

/**
 * Produce a flat word-diff token stream for a modified line pair.
 *
 *  - English/code lines -> `diffWords` (word + punctuation granularity).
 *  - CJK-dominant lines -> `diffChars` (per-character).
 *  - Oversized lines     -> `null` (skip; caller renders whole-line highlight).
 *  - Whitespace is preserved in token text (jsdiff keeps it in `value`).
 *
 * Reconstruction contract: joining `removed`+`context` token text reproduces
 * `oldContent`; joining `added`+`context` reproduces `newContent`. This is
 * what lets Step 2 split tokens per column (left=removed+context,
 * right=added+context) and Step 3 align token spans to the source string
 * inside the HAST tree.
 */
export function produceWordDiffTokens(
  oldContent: string,
  newContent: string,
): WordDiffToken[] | null {
  if (shouldSkipWordDiff(oldContent, newContent)) return null;

  const changes = isCjkDominant(oldContent, newContent)
    ? diffChars(oldContent, newContent)
    : diffWords(oldContent, newContent);

  return changes.map(toToken);
}
