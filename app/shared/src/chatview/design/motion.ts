/** Reduced-motion helper (#1825): single source for JS-side
 *  prefers-reduced-motion probes, mirroring the CSS media-gate pattern used
 *  across chatview component styles. Read at call time so runtime changes
 *  of the system setting are honored on the next invocation. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
