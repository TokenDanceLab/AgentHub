export const motion = {
  quickMs: 150,
  normalMs: 220,
  slowMs: 300,
  easing: 'easeOut',
} as const;

export function shouldReduceMotion(accessibilityReduceMotion: boolean | null | undefined): boolean {
  return accessibilityReduceMotion === true;
}
