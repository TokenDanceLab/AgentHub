import { describe, expect, it } from 'vitest';
import {
  clampPopoverPosition,
  planMentionPopoverKeyDown,
} from './composerMentionPopoverHelpers';

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
