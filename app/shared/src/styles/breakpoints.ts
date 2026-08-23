/* ═══════════════════════════════════════════════════════════════════
   Responsive Breakpoints — JS SSOT (#1827)

   CSS custom properties cannot be used inside `@media` queries, so the
   viewport tiers are documented twice ON PURPOSE:

     • styles/tokens-base.css — "Responsive Breakpoints" comment block:
       CSS-side documentation SSOT (copy the value into `@media`).
     • this file — machine-readable SSOT for TS/JS consumers.

   The two copies MUST change in the same commit; a value drift between
   them is a two-SSOT divergence (same rule as tokens-base.css vs
   designTokens.ts, see docs/architecture/07-design-system-ssot.md).
   tokens-base.test.ts cross-checks both sides.

   ═══════════════════════════════════════════════════════════════════ */

/**
 * Viewport breakpoint tiers, in px (min-width semantics).
 *
 * Layout strategy per tier (the 760–1920 range is the one the frontend
 * audit found to have zero CSS `@media` coverage — #1827):
 *
 * | Tier    | px   | Strategy                                                        |
 * | ------- | ---- | --------------------------------------------------------------- |
 * | minimal | 420  | ≤420: deep compact. Single-column action/stack layouts below    |
 * |         |      |  the mobile shell (RecoveryPanel actions).                      |
 * | mobile  | 480  | ≤480: compact shell. Single-column cards, touch targets enlarge |
 * |         |      |  via --touch-target-min (WCAG 2.5.5).                           |
 * | compact | 720  | ≤720: dense chrome band between mobile and narrow. Floating bar  |
 * |         |      |  width caps + dense settings rows (MultiSelectBar, SettingsPage; |
 * |         |      |  legacy 700 folded up to this tier).                            |
 * | narrow  | 768  | ≤768: mobile shell. Workbench grid collapses to rail + main     |
 * |         |      |  (2 cols; sidebar/inspector hidden), auth cards go full-width.  |
 * | medium  | 1024 | ≥1024: full desktop layout resumes.                          |
 * |         |      |  768–1023 (tablet band) is patrolled in JS: the workbench      |
 * |         |      |  workspace-pressure auto-collapse (#721) keeps the chat main   |
 * |         |      |  column ≥ WORKSPACE_AUTO_COLLAPSE_WIDTH (560px).              |
 * | standard | 1280 | 3-panel comfort zone starts (rail 52 + sidebar 260 +         |
 * |         |      |  inspector 400 leaves ≥560px main at 1280). desktop/App.     |
 * |         |      |  module.css clamps panels over the 1023/1279 legacy queries.  |
 * | wide    | 1440 | Design target / visual QA viewport (visual-qa-matrix).         |
 * | xwide   | 1920 | Root type bump 16 → 17px for viewing distance (#1309/#1307).  |
 * | ultra   | 2560 | Root type bump 18px (ultrawide).                              |
 *
 * Max-width query convention: integer form `(max-width: 768px)` as in
 * token-media wording above; do NOT introduce 767.98px float forms or
 * next-breakpoint−1 integers unless deliberately pairing siblings
 * (desktop/App.module.css legacy 1023/1279 stays as accepted convention).
 */
export const BREAKPOINTS = {
  /** ≤420 — deep compact: below the mobile shell, single-column stacks. */
  minimal: 420,
  /** ≤480 — compact shell: single-column cards, touch-target enlarge. */
  mobile: 480,
  /** ≤720 — dense chrome band between mobile and narrow. */
  compact: 720,
  /** ≤768 — mobile shell: rail + main 2-col grid, sidebar collapsible. */
  narrow: 768,
  /** ≥1024 — full desktop layout. */
  medium: 1024,
  /** ≥1280 — standard desktop window (3-panel comfort zone). */
  standard: 1280,
  /** ≥1440 — design target / visual QA viewport. */
  wide: 1440,
  /** ≥1920 — large desktop: root type bump 16 → 17px (#1309). */
  xwide: 1920,
  /** ≥2560 — ultrawide: root type bump 18px. */
  ultra: 2560,
} as const;

export type BreakpointKey = keyof typeof BREAKPOINTS;

/** e.g. `(max-width: 768px)` — compact shell form (minimal/mobile/compact/narrow tiers). */
export function maxWidthQuery(key: BreakpointKey): string {
  return `(max-width: ${BREAKPOINTS[key]}px)`;
}

/** e.g. `(min-width: 1280px)` — desktop-up form (medium → ultra tiers). */
export function minWidthQuery(key: BreakpointKey): string {
  return `(min-width: ${BREAKPOINTS[key]}px)`;
}
