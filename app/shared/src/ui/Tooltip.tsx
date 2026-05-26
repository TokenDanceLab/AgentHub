import React, { type ReactNode, useId } from 'react';
import styles from './Tooltip.module.css';

export interface TooltipProps {
  content: string;
  children: ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export function Tooltip({ content, children, position = 'top' }: TooltipProps) {
  const id = useId();
  return (
    <span className={styles.host} data-tooltip-position={position}>
      <span aria-describedby={id} className={styles.trigger}>
        {children}
      </span>
      <span id={id} role="tooltip" className={styles.tooltip}>
        {content}
      </span>
    </span>
  );
}
