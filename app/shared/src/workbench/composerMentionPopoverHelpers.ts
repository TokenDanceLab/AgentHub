/* ═══════════════════════════════════════════════════════════════════════
   composerMentionPopoverHelpers — pure + DOM plumbing for the @mention
   popover (T11 / UI1): keyboard navigation plan, viewport-clamped
   positioning, and best-effort caret coordinate measurement.

   - `planMentionPopoverKeyDown` / `clampPopoverPosition` are pure and
     fully unit-testable.
   - `measureCaretCoords` is a defensive DOM measurement (mirror-div
     technique) that returns null in environments without layout (jsdom),
     letting the host fall back to an anchored position.

   No React. The host wires these into the textarea keydown handler and
   a layout effect that positions the popover.
   ═══════════════════════════════════════════════════════════════════════ */

/** Keyboard effect the host should apply while the mention popover is open. */
export type MentionPopoverKeyEffect =
  | { kind: 'none' }
  | { kind: 'close' }
  | { kind: 'move'; delta: number }
  | { kind: 'select' }
  | { kind: 'close-defer' };

/**
 * Plan the popover's response to a keydown event. The host calls this
 * before the regular composer submit/newline planner so the popover can
 * intercept navigation. `none` / `close-defer` fall through to the normal
 * planner (the latter also closes the popover first).
 *
 * IME guard: when `isComposing` is true the host must not call this — the
 * composition session owns the keystrokes (Enter confirms the candidate
 * string, not a popover selection).
 */
export function planMentionPopoverKeyDown(params: {
  key: string;
  isComposing: boolean;
  popoverOpen: boolean;
  candidateCount: number;
}): MentionPopoverKeyEffect {
  const { key, isComposing, popoverOpen, candidateCount } = params;
  if (!popoverOpen || isComposing) return { kind: 'none' };
  if (key === 'Escape') return { kind: 'close' };
  if (key === 'ArrowDown') return { kind: 'move', delta: 1 };
  if (key === 'ArrowUp') return { kind: 'move', delta: -1 };
  if (key === 'Enter' || key === 'Tab') {
    if (candidateCount > 0) return { kind: 'select' };
    return { kind: 'close-defer' };
  }
  return { kind: 'none' };
}

export interface MentionPopoverCoords {
  top: number;
  left: number;
  placement: 'up' | 'down';
}

/**
 * Clamp a popover position so it opens above the caret when there is room
 * (otherwise below) and stays inside the viewport horizontally. Pure.
 */
export function clampPopoverPosition(params: {
  caretTop: number;
  caretLeft: number;
  caretHeight: number;
  popoverWidth: number;
  popoverHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  margin?: number;
}): MentionPopoverCoords {
  const {
    caretTop,
    caretLeft,
    caretHeight,
    popoverWidth,
    popoverHeight,
    viewportWidth,
  } = params;
  const margin = params.margin ?? 6;
  const fitsUp = caretTop - popoverHeight - margin >= 0;
  const placement = fitsUp ? 'up' : 'down';
  const top = fitsUp
    ? caretTop - popoverHeight - margin
    : caretTop + caretHeight + margin;
  const maxLeft = Math.max(margin, viewportWidth - popoverWidth - margin);
  const left = Math.min(Math.max(margin, caretLeft), maxLeft);
  return { top, left, placement };
}

export interface CaretCoords {
  top: number;
  left: number;
  height: number;
}

/** Style properties that influence text layout and must be mirrored. */
const MIRROR_STYLE_PROPS = [
  'boxSizing',
  'width',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'textTransform',
  'tabSize',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'whiteSpace',
  'wordWrap',
  'wordBreak',
  'overflowWrap',
  'textWrap',
] as const;

/**
 * Measure the caret pixel position (viewport-relative) using a mirror div
 * that replicates the textarea's text layout. Returns null when layout is
 * unavailable (jsdom, detached node, or zero-size textarea) so the host
 * can fall back to an anchored position. Best-effort: not unit-tested.
 */
export function measureCaretCoords(
  textarea: HTMLTextAreaElement | null,
  caretOffset: number,
): CaretCoords | null {
  if (!textarea) return null;
  if (typeof window === 'undefined') return null;
  const rect = textarea.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  const doc = textarea.ownerDocument;
  const view = doc.defaultView;
  if (!view) return null;
  const style = view.getComputedStyle(textarea);
  const parent = textarea.parentNode;
  if (!parent) return null;

  const mirror = doc.createElement('div');
  for (const prop of MIRROR_STYLE_PROPS) {
    mirror.style.setProperty(prop, style.getPropertyValue(prop));
  }
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.top = '0';
  mirror.style.left = '0';
  mirror.style.height = 'auto';
  mirror.style.whiteSpace = style.whiteSpace || 'pre-wrap';
  mirror.style.wordWrap = style.wordWrap || 'break-word';

  const text = textarea.value;
  const safeCaret = Math.max(0, Math.min(caretOffset, text.length));
  mirror.append(text.slice(0, safeCaret));
  const marker = doc.createElement('span');
  marker.textContent = '​';
  mirror.append(marker);
  mirror.append(text.slice(safeCaret));

  parent.appendChild(mirror);
  const markerRect = marker.getBoundingClientRect();
  const lineHeightRaw = style.lineHeight;
  const parsedLineHeight = parseFloat(lineHeightRaw);
  const height =
    Number.isFinite(parsedLineHeight) && parsedLineHeight > 0
      ? parsedLineHeight
      : markerRect.height || rect.height;
  parent.removeChild(mirror);

  if (markerRect.top === 0 && markerRect.left === 0 && markerRect.width === 0) {
    return null;
  }
  return { top: markerRect.top, left: markerRect.left, height };
}
