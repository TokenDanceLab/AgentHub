import React from 'react';
import styles from './Pill.module.css';

type PillVariant = 'default' | 'blue' | 'cyan' | 'purple' | 'green' | 'amber';

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
