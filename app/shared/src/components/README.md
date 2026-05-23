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

## Props Rules

- Every component must accept `className?: string` for external style overrides
- Favor `children` over hardcoded content in complex components
- Never use `any` — prefer `unknown` if the type is truly unconstrained
