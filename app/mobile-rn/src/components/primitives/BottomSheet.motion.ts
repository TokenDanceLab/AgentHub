import { motion } from '@/theme/motion';

const TABLET_BREAKPOINT = 768;
const TABLET_SHEET_MAX_WIDTH = 640;
const TABLET_SIDE_MARGIN = 48;
const SHEET_MAX_HEIGHT_RATIO = 0.9;

export interface BottomSheetFrame {
  maxHeight: number;
  maxWidth?: number;
}

export interface BottomSheetTiming {
  backdropMs: number;
  sheetMs: number;
}

export function getBottomSheetFrame(width: number, height: number): BottomSheetFrame {
  const frame: BottomSheetFrame = {
    maxHeight: Math.round(height * SHEET_MAX_HEIGHT_RATIO),
  };

  if (width >= TABLET_BREAKPOINT) {
    frame.maxWidth = Math.min(TABLET_SHEET_MAX_WIDTH, width - TABLET_SIDE_MARGIN);
  }

  return frame;
}

export function getBottomSheetTiming(reduceMotion: boolean): BottomSheetTiming {
  if (reduceMotion) {
    return { backdropMs: 0, sheetMs: 0 };
  }

  return { backdropMs: motion.quickMs, sheetMs: motion.normalMs };
}
