import { describe, expect, it } from 'vitest';

import { getBottomSheetFrame, getBottomSheetTiming } from './BottomSheet.motion';

describe('BottomSheet motion helpers', () => {
  it('keeps phone sheets full-width and caps tablet sheets to a stable width', () => {
    expect(getBottomSheetFrame(390, 844)).toEqual({ maxHeight: 760 });
    expect(getBottomSheetFrame(1024, 768)).toEqual({ maxHeight: 691, maxWidth: 640 });
    expect(getBottomSheetFrame(800, 600)).toEqual({ maxHeight: 540, maxWidth: 640 });
  });

  it('collapses animation timing when reduced motion is requested', () => {
    expect(getBottomSheetTiming(false)).toEqual({ backdropMs: 150, sheetMs: 220 });
    expect(getBottomSheetTiming(true)).toEqual({ backdropMs: 0, sheetMs: 0 });
  });
});
