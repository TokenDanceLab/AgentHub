import React, { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import styles from './Tooltip.module.css';

export interface TooltipProps {
  content: string;
  children: ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  /** Delay before showing the tooltip (ms). Default 300. */
  showDelay?: number;
  /** Delay before hiding the tooltip after the pointer leaves (ms). Default 200. */
  hideDelay?: number;
}

export function Tooltip({
  content,
  children,
  position = 'top',
  showDelay = 300,
  hideDelay = 200,
}: TooltipProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const showTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const clearTimers = useCallback(() => {
    if (showTimerRef.current !== undefined) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = undefined;
    }
    if (hideTimerRef.current !== undefined) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = undefined;
    }
  }, []);

  const show = useCallback(() => {
    clearTimers();
    showTimerRef.current = setTimeout(() => {
      setVisible(true);
    }, showDelay);
  }, [clearTimers, showDelay]);

  const hide = useCallback(() => {
    clearTimers();
    hideTimerRef.current = setTimeout(() => {
      setVisible(false);
    }, hideDelay);
  }, [clearTimers, hideDelay]);

  const dismiss = useCallback(() => {
    clearTimers();
    setVisible(false);
  }, [clearTimers]);

  // WCAG 2.2 SC 1.4.13: tooltip must be dismissible via Escape without moving focus
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        dismiss();
      }
    },
    [dismiss],
  );

  // Cleanup timers on unmount to prevent state updates on unmounted component
  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  // Hover bridge: prevent hide while the pointer is over the tooltip itself.
  // This satisfies WCAG 2.2 SC 1.4.13 "hoverable" — the tooltip content persists
  // when the pointer moves from the trigger onto the tooltip.
  const handleTooltipEnter = useCallback(() => {
    if (hideTimerRef.current !== undefined) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = undefined;
    }
  }, []);

  return (
    <span className={styles.host} data-tooltip-position={position}>
      <span
        aria-describedby={id}
        className={styles.trigger}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={handleKeyDown}
      >
        {children}
      </span>
      <span
        id={id}
        role="tooltip"
        className={`${styles.tooltip}${visible ? ` ${styles.visible}` : ''}`}
        onMouseEnter={handleTooltipEnter}
        onMouseLeave={hide}
      >
        {content}
      </span>
    </span>
  );
}
