import type { ComposerMention } from '@shared/composer';

/* ═══════════════════════════════════════════════════════════════════════
   composerMentionTrigger — pure @mention trigger detection for the
   UnifiedComposer textarea (T11 / UI1).

   Detects an active '@' trigger immediately preceding the caret, extracts
   the query segment, filters mentionable candidates, and computes the text
   slice that must be removed when a candidate is inserted as a chip.

   Pure + framework-agnostic: no React, no DOM. The host (UnifiedComposer)
   wires these into textarea onChange/onSelect and the popover selection
   handler. Mention data + dispatchRole semantics flow unchanged through
   the existing `addMention` reducer action — see planAddMentionAction.
   ═══════════════════════════════════════════════════════════════════════ */

export interface MentionTrigger {
  /** Offset of the '@' trigger char in the composer text. */
  atOffset: number;
  /**
   * Text between the '@' and the caret (excludes the '@'). Empty when only
   * '@' has been typed. Never contains whitespace.
   */
  query: string;
  /** Caret offset captured at detection time (atOffset + 1 + query.length). */
  caret: number;
}

const WHITESPACE = /\s/;

/**
 * Detect an active '@' mention trigger immediately preceding the caret.
 *
 * A trigger is active when the nearest '@' before the caret sits at the
 * start of the text or right after whitespace, and the segment between
 * that '@' and the caret contains no whitespace. Scanning only the
 * nearest '@' is sufficient: any earlier '@' would have an even longer
 * segment that includes this one's whitespace (if any).
 *
 * Returns null during IME composition handling is the host's job — this
 * helper only inspects text geometry.
 */
export function detectMentionTrigger(params: {
  text: string;
  caret: number;
}): MentionTrigger | null {
  const { text, caret } = params;
  const end = Math.max(0, Math.min(caret, text.length));
  let atOffset = -1;
  for (let i = end - 1; i >= 0; i--) {
    if (text[i] === '@') {
      atOffset = i;
      break;
    }
  }
  if (atOffset < 0) return null;
  const precededByWhitespace = atOffset === 0 || WHITESPACE.test(text[atOffset - 1] ?? '');
  if (!precededByWhitespace) return null;
  const segment = text.slice(atOffset + 1, end);
  if (WHITESPACE.test(segment)) return null;
  return { atOffset, query: segment, caret: end };
}

/**
 * Filter mention candidates by the active query. Empty query returns all
 * candidates (popover shows the full roster when only '@' is typed).
 * Prefix matches sort before substring matches; input order is preserved
 * within each bucket so the store's agent ordering stays stable.
 */
export function filterMentionCandidates(params: {
  candidates: ComposerMention[];
  query: string;
}): ComposerMention[] {
  const { candidates, query } = params;
  const q = query.trim().toLowerCase();
  if (!q) return [...candidates];
  const prefix: ComposerMention[] = [];
  const contains: ComposerMention[] = [];
  for (const candidate of candidates) {
    const label = candidate.label.toLowerCase();
    if (label.startsWith(q)) prefix.push(candidate);
    else if (label.includes(q)) contains.push(candidate);
  }
  return [...prefix, ...contains];
}

/**
 * Remove the '@<query>' trigger text (from the '@' through the caret) so
 * the inserted mention chip replaces it. Clamps offsets defensively.
 */
export function removeMentionTriggerText(params: {
  text: string;
  atOffset: number;
  caret: number;
}): { nextText: string; nextCaret: number } {
  const { text, atOffset, caret } = params;
  const end = Math.max(0, Math.min(caret, text.length));
  const start = Math.max(0, Math.min(atOffset, end));
  return {
    nextText: text.slice(0, start) + text.slice(end),
    nextCaret: start,
  };
}
