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
Tier follows a two-tier reduced-motion principle: maintainer opts into reduced-motion but expects **user-requested motion** to play normally.

| Category | Behavior under `reduce` | Examples |
|----------|------------------------|----------|
| **Informational (exempt)** | Play normally — not shortened or suppressed | Spinner/loading indicators (`previewSpin`, `deploySpin`, `skeletonShimmer`, `skeletonPulse`, `TextShimmer.shimmer`, `AgentStreamingBar.iconPulse`), user-requested search feedback (`highlightPulse`), active-state indicators (`SubagentStreamOverlay.avatarPulse`, `AgentHubWorkbench.connectionBlink`) |
| **Decorative (fully reduced)** | `animation-duration: 0.001ms !important; transition-duration: 0.001ms !important` | Entrance/slide-in animations (`rowBdExpand`, `routeSlideIn`, `editorIn`, `previewIn`, `panelIn`, `dropdownIn`, `modalPanelIn`, `contentIn`, `overlayIn`, `emptyStateIn`, `fileMenuIn`, `inspectorMenuIn`, `permissionPopoverIn`), UI pulse effects (`routePulse`, `dagPulse`), hover lift (`ah-glass-press`), tab and chrome transitions |

**Implementation rule:**

```css
/* Decorative entrance — reduced-motion safe */
@media (prefers-reduced-motion: no-preference) {
  .my-panel { animation: slideIn 0.3s var(--ease-panel); }
}

/* Informational spinner — always plays */
.my-spinner { animation: spin 0.8s linear infinite; }
```

The global reduced-motion reset at `chatview/design/global.css:24` zeroes all `animation-duration` and `transition-duration` to `0.001ms`. If a motion is informational and must be exempt, either:
1. Animate via a non-duration property (e.g. `opacity` swap) outside the `*` selector scope, or
2. Override within a `@media (prefers-reduced-motion: no-preference)` block (preferred).

> Rule of thumb: **If the user didn't ask for it and it moves, it's decorative.** Loading spinners, search highlights, and running-state indicators are informational because they communicate system state the user is waiting for.

## Props Rules

- Every component must accept `className?: string` for external style overrides
- Favor `children` over hardcoded content in complex components
- Never use `any` — prefer `unknown` if the type is truly unconstrained
