export type MotionEasingName =
  | 'standard'
  | 'decelerate'
  | 'accelerate'
  | 'spring'
  | 'panel'
  | 'press';

export type MotionDurationName =
  | 'instant'
  | 'tap'
  | 'fast'
  | 'quick'
  | 'normal'
  | 'pop'
  | 'medium'
  | 'enter'
  | 'slow'
  | 'sheet'
  | 'settle';

export type CubicBezier = readonly [number, number, number, number];

export interface MotionEasingSpec {
  readonly css: string;
  readonly bezier: CubicBezier;
}

export interface MotionSpringSpec {
  readonly damping: number;
  readonly stiffness: number;
  readonly mass: number;
  readonly overshootClamping?: boolean;
  readonly restDisplacementThreshold: number;
  readonly restSpeedThreshold: number;
}

export interface MotionTimingSpec {
  readonly durationMs: number;
  readonly easing: MotionEasingName;
}

export interface ReducedMotionSpec {
  readonly durationMs: 1;
  readonly distance: 0;
  readonly scale: 1;
  readonly opacityOnly: true;
  readonly spring: MotionSpringSpec;
}

export const motion = {
  duration: {
    instant: 0,
    tap: 90,
    fast: 120,
    quick: 150,
    normal: 220,
    pop: 220,
    medium: 260,
    enter: 320,
    slow: 360,
    sheet: 420,
    settle: 520,
  } satisfies Record<MotionDurationName, number>,
  easings: {
    standard: { css: 'cubic-bezier(0.2, 0, 0, 1)', bezier: [0.2, 0, 0, 1] },
    decelerate: { css: 'cubic-bezier(0.16, 1, 0.3, 1)', bezier: [0.16, 1, 0.3, 1] },
    accelerate: { css: 'cubic-bezier(0.4, 0, 1, 1)', bezier: [0.4, 0, 1, 1] },
    spring: { css: 'cubic-bezier(0.18, 0.86, 0.24, 1)', bezier: [0.18, 0.86, 0.24, 1] },
    panel: { css: 'cubic-bezier(0.16, 1, 0.3, 1)', bezier: [0.16, 1, 0.3, 1] },
    press: { css: 'cubic-bezier(0.34, 1.56, 0.64, 1)', bezier: [0.34, 1.56, 0.64, 1] },
  } satisfies Record<MotionEasingName, MotionEasingSpec>,
  spring: {
    press: {
      damping: 18,
      stiffness: 420,
      mass: 0.72,
      restDisplacementThreshold: 0.01,
      restSpeedThreshold: 0.01,
    },
    tab: {
      damping: 20,
      stiffness: 360,
      mass: 0.78,
      restDisplacementThreshold: 0.01,
      restSpeedThreshold: 0.01,
    },
    sheet: {
      damping: 28,
      stiffness: 260,
      mass: 0.9,
      overshootClamping: true,
      restDisplacementThreshold: 0.5,
      restSpeedThreshold: 0.5,
    },
    list: {
      damping: 22,
      stiffness: 320,
      mass: 0.86,
      restDisplacementThreshold: 0.1,
      restSpeedThreshold: 0.1,
    },
    gentle: {
      damping: 24,
      stiffness: 210,
      mass: 1,
      restDisplacementThreshold: 0.1,
      restSpeedThreshold: 0.1,
    },
  } satisfies Record<string, MotionSpringSpec>,
  distance: {
    press: {
      scale: 0.97,
      iconScale: 0.94,
      translateY: 1,
    },
    tab: {
      iconLift: -2,
      indicatorY: 4,
      badgeScale: 0.92,
    },
    sheet: {
      enterY: 36,
      dismissY: 64,
      peekOffsetY: 24,
      handleTravelY: 8,
    },
    list: {
      enterY: 10,
      staggerY: 6,
      reorderY: 8,
      swipeActionX: 72,
    },
    page: {
      enterX: 18,
      enterY: 14,
    },
    toast: {
      enterY: 12,
    },
  },
  timing: {
    pressIn: { durationMs: 90, easing: 'standard' },
    pressOut: { durationMs: 150, easing: 'press' },
    tabSwitch: { durationMs: 220, easing: 'spring' },
    listEnter: { durationMs: 260, easing: 'decelerate' },
    sheetEnter: { durationMs: 420, easing: 'panel' },
    sheetExit: { durationMs: 260, easing: 'accelerate' },
    pageEnter: { durationMs: 320, easing: 'decelerate' },
    feedback: { durationMs: 120, easing: 'standard' },
  } satisfies Record<string, MotionTimingSpec>,
  reduced: {
    durationMs: 1,
    distance: 0,
    scale: 1,
    opacityOnly: true,
    spring: {
      damping: 100,
      stiffness: 1000,
      mass: 1,
      overshootClamping: true,
      restDisplacementThreshold: 1,
      restSpeedThreshold: 1,
    },
  } satisfies ReducedMotionSpec,
  quickMs: 150,
  normalMs: 220,
  slowMs: 300,
  easing: 'easeOut',
} as const;

export function shouldReduceMotion(accessibilityReduceMotion: boolean | null | undefined): boolean {
  return accessibilityReduceMotion === true;
}
