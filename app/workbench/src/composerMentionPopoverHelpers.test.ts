import { describe, expect, it, vi } from 'vitest';
import {
  clampPopoverPosition,
  measureCaretCoords,
  planMentionPopoverKeyDown,
} from './composerMentionPopoverHelpers';

function domRect(partial: Partial<DOMRect>): DOMRect {
  return {
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...partial,
  } as DOMRect;
}

describe('planMentionPopoverKeyDown', () => {
  it('returns none when the popover is closed', () => {
    expect(
      planMentionPopoverKeyDown({ key: 'Enter', isComposing: false, popoverOpen: false, candidateCount: 3 }),
    ).toEqual({ kind: 'none' });
  });

  it('returns none during IME composition even when the popover is open', () => {
    expect(
      planMentionPopoverKeyDown({ key: 'Enter', isComposing: true, popoverOpen: true, candidateCount: 3 }),
    ).toEqual({ kind: 'none' });
  });

  it('closes on Escape', () => {
    expect(
      planMentionPopoverKeyDown({ key: 'Escape', isComposing: false, popoverOpen: true, candidateCount: 2 }),
    ).toEqual({ kind: 'close' });
  });

  it('moves down on ArrowDown and up on ArrowUp', () => {
    expect(
      planMentionPopoverKeyDown({ key: 'ArrowDown', isComposing: false, popoverOpen: true, candidateCount: 3 }),
    ).toEqual({ kind: 'move', delta: 1 });
    expect(
      planMentionPopoverKeyDown({ key: 'ArrowUp', isComposing: false, popoverOpen: true, candidateCount: 3 }),
    ).toEqual({ kind: 'move', delta: -1 });
  });

  it('selects on Enter/Tab when candidates exist', () => {
    expect(
      planMentionPopoverKeyDown({ key: 'Enter', isComposing: false, popoverOpen: true, candidateCount: 2 }),
    ).toEqual({ kind: 'select' });
    expect(
      planMentionPopoverKeyDown({ key: 'Tab', isComposing: false, popoverOpen: true, candidateCount: 2 }),
    ).toEqual({ kind: 'select' });
  });

  it('closes and defers to normal handling on Enter with no candidates', () => {
    expect(
      planMentionPopoverKeyDown({ key: 'Enter', isComposing: false, popoverOpen: true, candidateCount: 0 }),
    ).toEqual({ kind: 'close-defer' });
  });

  it('returns none for unrelated keys', () => {
    expect(
      planMentionPopoverKeyDown({ key: 'a', isComposing: false, popoverOpen: true, candidateCount: 2 }),
    ).toEqual({ kind: 'none' });
  });
});

describe('clampPopoverPosition', () => {
  const base = {
    caretTop: 300,
    caretLeft: 100,
    caretHeight: 20,
    popoverWidth: 280,
    popoverHeight: 200,
    viewportWidth: 1280,
    viewportHeight: 800,
  };

  it('places the popover above the caret when there is room', () => {
    const coords = clampPopoverPosition(base);
    expect(coords.placement).toBe('up');
    expect(coords.top).toBe(300 - 200 - 6); // caretTop - popoverHeight - margin
    expect(coords.left).toBe(100);
  });

  it('flips below when there is no room above', () => {
    const coords = clampPopoverPosition({ ...base, caretTop: 40, popoverHeight: 200 });
    expect(coords.placement).toBe('down');
    expect(coords.top).toBe(40 + 20 + 6); // caretTop + caretHeight + margin
  });

  it('clamps left so the popover never overflows the right edge', () => {
    const coords = clampPopoverPosition({
      ...base,
      caretLeft: 1100,
      viewportWidth: 1280,
      popoverWidth: 280,
    });
    // maxLeft = 1280 - 280 - 6 = 994
    expect(coords.left).toBe(994);
  });

  it('clamps left so the popover never overflows the left edge', () => {
    const coords = clampPopoverPosition({ ...base, caretLeft: 2, margin: 6 });
    expect(coords.left).toBe(6);
  });

  it('respects a custom margin', () => {
    const coords = clampPopoverPosition({ ...base, caretTop: 300, margin: 12 });
    expect(coords.top).toBe(300 - 200 - 12);
  });
});

describe('measureCaretCoords', () => {
  it('returns null for a missing textarea or one without layout', () => {
    expect(measureCaretCoords(null, 0)).toBeNull();

    // jsdom reports a zero rect for unrendered elements → treated as no layout.
    const detached = document.createElement('textarea');
    expect(measureCaretCoords(detached, 3)).toBeNull();
  });

  it('returns null when the textarea has a rect but no parent to host the mirror', () => {
    const textarea = document.createElement('textarea');
    vi.spyOn(textarea, 'getBoundingClientRect').mockReturnValue(domRect({ width: 200, height: 24 }));
    expect(measureCaretCoords(textarea, 0)).toBeNull();
  });

  it('builds a mirror div, clamps the caret offset, and cleans the mirror up', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const textarea = document.createElement('textarea');
    textarea.value = 'hello mention';
    parent.appendChild(textarea);
    vi.spyOn(textarea, 'getBoundingClientRect').mockReturnValue(domRect({ width: 200, height: 24 }));
    // jsdom spans have no layout; simulate a measured caret marker.
    const markerSpy = vi
      .spyOn(HTMLSpanElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(domRect({ top: 40, left: 55, width: 2, height: 18 }));

    try {
      // caretOffset beyond the text length must clamp to the end, not throw.
      const coords = measureCaretCoords(textarea, 999);
      expect(coords).toEqual({ top: 40, left: 55, height: 18 });
      // The mirror div is removed after measurement; only the textarea stays.
      expect(Array.from(parent.children)).toEqual([textarea]);
    } finally {
      markerSpy.mockRestore();
      parent.remove();
    }
  });

  it('prefers a numeric computed line-height over the marker/rect height', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const textarea = document.createElement('textarea');
    textarea.value = 'abc';
    textarea.style.lineHeight = '30px';
    parent.appendChild(textarea);
    vi.spyOn(textarea, 'getBoundingClientRect').mockReturnValue(domRect({ width: 200, height: 24 }));
    const markerSpy = vi
      .spyOn(HTMLSpanElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(domRect({ top: 10, left: 12, width: 2, height: 18 }));

    try {
      const coords = measureCaretCoords(textarea, 1);
      expect(coords?.height).toBe(30);
      expect(coords?.top).toBe(10);
    } finally {
      markerSpy.mockRestore();
      parent.remove();
    }
  });
});
