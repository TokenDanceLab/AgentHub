import React from 'react';
import styles from './SkeletonBar.module.css';

export interface SkeletonBarProps {
  /** Width of each bar (CSS value). Default '100%'. */
  width?: string;
  /** Height of each bar (CSS value). Default '1em'. */
  height?: string;
  /** Number of bars to render. Default 1. */
  lines?: number;
  /** Gap between bars (CSS value). Default '0.5em'. */
  gap?: string;
  /** Additional className for the container. */
  className?: string;
  /** Additional className for each bar line. */
  lineClassName?: string;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/** Structural skeleton placeholder with reduced-motion support.
 *  Use TextShimmer for text-specific loading; use SkeletonBar for
 *  card, row, and structural shapes. */
export function SkeletonBar({
  width = '100%',
  height = '1em',
  lines = 1,
  gap = '0.5em',
  className,
  lineClassName,
}: SkeletonBarProps) {
  return (
    <div
      className={cx(styles.container, className)}
      aria-busy="true"
      aria-hidden="true"
      style={{ gap }}
    >
      {Array.from({ length: lines }, (_, i) => (
        <span
          key={i}
          className={cx(styles.line, lineClassName)}
          style={{ width, height }}
        />
      ))}
    </div>
  );
}
