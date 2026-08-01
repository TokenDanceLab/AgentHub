// Tooltip — shared a11y tooltip primitive (hover + focus triggered, ESC dismiss)
// Ported and extended from desktop ShellIconButton iconTooltip CSS pattern:
//  - useId + aria-describedby association (ShellIconButton) +
//  - hover delay, focus trigger, ESC dismiss (new), reduced-motion gating.
// Pure CSS positioning (absolute), no portal/Radix runtime dependency.
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cx } from './cx';
import styles from './Tooltip.module.css';

export type TooltipSide = 'top' | 'right' | 'bottom' | 'left';

export interface TooltipProps {
  /** Tooltip text. Kept as plain string — consumers supply localized copy. */
  label: string;
  /** Edge the tooltip pops out of. Default 'bottom'. */
  side?: TooltipSide | undefined;
  /** Hover show delay in ms to avoid accidental trigger. Default 500. */
  delayMs?: number | undefined;
  /** Extra class on the positioning host span. */
  className?: string | undefined;
  /** The element the tooltip describes (button, link, icon…). Must be a single
   *  React element for full a11y (aria-describedby + focus trigger). Non-element
   *  children fall back to a hover-only wrapping span (no focus trigger). */
  children: ReactNode;
}

const DEFAULT_DELAY_MS = 500;

/** Merge two handlers; if `a` is absent, return `b` unchanged (no wrapper). */
function chain<T extends React.SyntheticEvent>(
  a: ((e: T) => void) | undefined,
  b: (e: T) => void,
): (e: T) => void {
  if (!a) return b;
  return (e: T) => {
    a(e);
    b(e);
  };
}

/** Append `id` to an existing aria-describedby list without duplicating.
 *  `id` may be undefined (tooltip closed) — in that case return `existing`. */
function mergeDescribedBy(
  existing: string | undefined,
  id: string | undefined,
): string | undefined {
  if (!id) return existing;
  if (!existing) return id;
  return existing.includes(id) ? existing : `${existing} ${id}`;
}

export function Tooltip({
  label,
  side = 'bottom',
  delayMs = DEFAULT_DELAY_MS,
  children,
  className,
}: TooltipProps) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearShowTimer = useCallback(() => {
    if (showTimerRef.current !== null) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
  }, []);

  // Clear any pending show timer on unmount.
  useEffect(() => clearShowTimer, [clearShowTimer]);

  // Hover: delayed show (avoids accidental trigger).
  const scheduleShow = useCallback(() => {
    clearShowTimer();
    showTimerRef.current = setTimeout(() => {
      showTimerRef.current = null;
      setOpen(true);
    }, delayMs);
  }, [clearShowTimer, delayMs]);

  // Focus: show immediately (keyboard users want instant feedback).
  const showNow = useCallback(() => {
    clearShowTimer();
    setOpen(true);
  }, [clearShowTimer]);

  const hide = useCallback(() => {
    clearShowTimer();
    setOpen(false);
  }, [clearShowTimer]);

  const handleMouseEnter = useCallback(() => {
    scheduleShow();
  }, [scheduleShow]);

  const handleMouseLeave = useCallback(() => {
    hide();
  }, [hide]);

  const handleFocus = useCallback(() => {
    showNow();
  }, [showNow]);

  const handleBlur = useCallback(() => {
    hide();
  }, [hide]);

  // ESC dismisses an open tooltip (does not preventDefault/stopPropagation so
  // the trigger's own ESC handler still runs, e.g. closing a menu).
  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLElement>) => {
      if (e.key === 'Escape') {
        hide();
      }
    },
    [hide],
  );

  // Only associate aria-describedby while the tooltip is actually rendered
  // (open). When closed, omit it so SRs don't chase a dangling idref —
  // mirrors Radix Tooltip behaviour.
  const describedBy = open ? tooltipId : undefined;

  // Clone a single element child to land aria-describedby + handlers on the
  // real focusable element (correct a11y). For non-element children, fall back
  // to a wrapping span (hover-only, since the span is not focusable).
  //
  // React 19's `isValidElement` narrows to `ReactElement<unknown>`, which makes
  // `cloneElement` reject injected prop keys (overload 7 wants
  // `Partial<unknown>`). We cast to `ReactElement<Record<string, unknown>>`
  // so the existing handlers stay typed while cloneElement accepts our keys.
  let trigger: ReactNode;
  if (isValidElement(children)) {
    const typed = children as ReactElement<Record<string, unknown>>;
    const p = typed.props;
    trigger = cloneElement(typed, {
      'aria-describedby': mergeDescribedBy(
        p['aria-describedby'] as string | undefined,
        describedBy,
      ),
      onMouseEnter: chain<ReactMouseEvent<HTMLElement>>(
        p.onMouseEnter as ((e: ReactMouseEvent<HTMLElement>) => void) | undefined,
        handleMouseEnter,
      ),
      onMouseLeave: chain<ReactMouseEvent<HTMLElement>>(
        p.onMouseLeave as ((e: ReactMouseEvent<HTMLElement>) => void) | undefined,
        handleMouseLeave,
      ),
      onFocus: chain<ReactFocusEvent<HTMLElement>>(
        p.onFocus as ((e: ReactFocusEvent<HTMLElement>) => void) | undefined,
        handleFocus,
      ),
      onBlur: chain<ReactFocusEvent<HTMLElement>>(
        p.onBlur as ((e: ReactFocusEvent<HTMLElement>) => void) | undefined,
        handleBlur,
      ),
      onKeyDown: chain<ReactKeyboardEvent<HTMLElement>>(
        p.onKeyDown as ((e: ReactKeyboardEvent<HTMLElement>) => void) | undefined,
        handleKeyDown,
      ),
    });
  } else {
    trigger = (
      <span
        aria-describedby={describedBy}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {children}
      </span>
    );
  }

  return (
    <span className={cx(styles.host, className)}>
      {trigger}
      {open ? (
        <span
          id={tooltipId}
          role="tooltip"
          className={styles.tooltip}
          data-side={side}
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}
