# Shared UI Components

## File Structure

```
components/
  ComponentName/
    ComponentName.tsx          — React component (named export only)
    ComponentName.module.css   — CSS Module
    ComponentName.test.tsx     — unit tests (optional)
    index.ts                   — barrel re-export
```

## Naming Conventions

- **Directory / file**: PascalCase (`BrandingSection/`, `BrandingSection.tsx`)
- **Props interface**: `ComponentNameProps` — always exported alongside the component
- **CSS Module import**: `import styles from './ComponentName.module.css'`
- **No default exports** — use named exports only

```tsx
// ComponentName/ComponentName.tsx
import styles from './ComponentName.module.css';

export interface ComponentNameProps {
  title: string;
  className?: string;
  children?: React.ReactNode;
}

export function ComponentName({ title, className, children }: ComponentNameProps) {
  return (
    <div className={`${styles.root} ${className ?? ''}`}>
      <h2>{title}</h2>
      {children}
    </div>
  );
}
```

## Barrel Export

```ts
// ComponentName/index.ts
export { ComponentName } from './ComponentName';
export type { ComponentNameProps } from './ComponentName';
```

## CSS Rules

- Use OKLCH CSS variables for colors (`var(--brand)` etc.), never hardcode hex/rgb values
- Use font tokens: `var(--font-sans)`, `var(--font-mono)`
- Use radius tokens: `var(--radius-*)`
- No `!important`
- No `position: absolute` without a corresponding `position: relative` parent
- Animations over 200ms must be wrapped in `@media (prefers-reduced-motion: no-preference)`

### Motion Classification: Informational vs Decorative

Animations are classified into two tiers for `prefers-reduced-motion: reduce` behavior.
Tier follows a two-tier reduced-motion principle: maintainer opts into reduced-motion but expects **user-requested motion / state indicators** to remain legible.

| Category | Behavior under `reduce` | Examples |
|----------|------------------------|----------|
| **Informational (state stays legible)** | The animation loop halts, but the indicator keeps its static shape/text so the state remains readable. Implemented as a per-component `@media (prefers-reduced-motion: reduce) { animation: none }` block. | Spinner/loading rings keep their ring (loop stops) (`previewSpin`, `deploySpin`, `row-spinner`), status text stays (`AgentStreamingBar.iconPulse`, `AgentHubWorkbench.connectionBlink` → static dot), `thinkShimmer` text stays solid |
| **Decorative (fully reduced)** | Entrance/slide animations are wrapped in `@media (prefers-reduced-motion: no-preference)` so they never run; infinite decorative pulses get `animation: none` under `reduce`. | Entrance animations (`rowBdExpand`, `routeSlideIn`, `editorIn`, `previewIn`, `panelIn`, `dropdownIn`, `modalPanelIn`, `contentIn`, `overlayIn`, `emptyStateIn`, `fileMenuIn`, `inspectorMenuIn`, `permissionPopoverIn`), UI pulse effects (`routePulse`, `dagPulse`), hover lift (`ah-glass-press`), tab and chrome transitions |

**Implementation rule:**

```css
/* Decorative entrance — reduced-motion safe */
@media (prefers-reduced-motion: no-preference) {
  .my-panel { animation: slideIn 0.3s var(--ease-panel); }
}

/* Informational indicator — state stays, the loop stops */
.my-spinner { animation: spin 0.8s linear infinite; }
@media (prefers-reduced-motion: reduce) {
  .my-spinner { animation: none; }
}
```

There is **no global reduced-motion reset**: `chatview/design/global.css` is an unwired/dead file (its kill-switch never reaches the app). The real mechanism is per-component blocks — each component owns its own `prefers-reduced-motion` gate (see `RowItem.css`, `AgentStreamingBar.module.css`, `tokens-base.css` `.ah-glass-press`, `Card.module.css`, `Modal.module.css`, …). When adding motion, add its gate in the same file. Transition property lists are the mechanism for chrome feedback (e.g. `--motion-hover/press/panel` recipes); under `reduce` those components override `transition: none` or `transition-duration: 0ms`.

> Rule of thumb: **If the user didn't ask for it and it moves, it's decorative.** Loading spinners, search highlights, and running-state indicators are informational because they communicate system state the user is waiting for — keep their static form visible when the loop stops.

## Props Rules

- Every component must accept `className?: string` for external style overrides
- Favor `children` over hardcoded content in complex components
- Never use `any` — prefer `unknown` if the type is truly unconstrained
