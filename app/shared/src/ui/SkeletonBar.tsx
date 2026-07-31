import React from 'react';
import { cx } from './cx';
import styles from './SkeletonBar.module.css';

export type SkeletonBarVariant = 'line' | 'circle' | 'block';

export interface SkeletonBarProps {
  /** Shape of each bar: 'line' (default), 'circle' (avatar), 'block' (card). */
  variant?: SkeletonBarVariant;
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


/** Structural skeleton placeholder with reduced-motion support.
 *  Use SkeletonBar for card, row, and structural shapes.
 *  Variants: 'line' for text rows, 'circle' for avatar placeholders
 *  (square defaults when width/height are omitted), 'block' for card bodies. */
export function SkeletonBar({
  variant = 'line',
  width = '100%',
  height = '1em',
  lines = 1,
  gap = '0.5em',
  className,
  lineClassName,
}: SkeletonBarProps) {
  // Circle placeholders degrade to a square unless both dimensions are
  // supplied: a bare height (or the '1em' default) also drives the width.
  const resolvedWidth = variant === 'circle' && width === '100%' ? height : width;
  const resolvedHeight =
    variant === 'circle' && height === '1em' ? resolvedWidth : height;

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
          className={cx(styles.line, styles[variant], lineClassName)}
          style={{ width: resolvedWidth, height: resolvedHeight }}
        />
      ))}
    </div>
  );
}
