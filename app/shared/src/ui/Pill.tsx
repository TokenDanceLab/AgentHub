import React from 'react';
import styles from './Pill.module.css';

type PillVariant = 'default' | 'blue' | 'cyan' | 'purple' | 'green' | 'amber';

/**
 * Variant → semantic mapping (color-name API kept for backward compat):
 *   blue  → info (primary blue)
 *   cyan  → td-accent-blue (light informational blue)
 *   purple→ td-accent-purple
 *   green → success
 *   amber → warning / td-accent-amber
 * Module CSS resolves each to theme tokens; do not add new color-name
 * variants — prefer semantic tokens in new surfaces.
 */
interface PillProps {
  variant?: PillVariant;
  children: React.ReactNode;
  className?: string;
}

function pillClass(v: PillVariant): string {
  switch (v) {
    case 'default': return styles.default!;
    case 'blue': return styles.blue!;
    case 'cyan': return styles.cyan!;
    case 'purple': return styles.purple!;
    case 'green': return styles.green!;
    case 'amber': return styles.amber!;
  }
}

export function Pill({ variant = 'default', children, className }: PillProps) {
  return (
    <span className={`${styles.pill} ${pillClass(variant)} ${className ?? ''}`}>
      {children}
    </span>
  );
}
