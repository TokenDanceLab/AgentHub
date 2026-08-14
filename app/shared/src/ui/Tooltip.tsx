// Tooltip — shared a11y tooltip primitive (hover + focus triggered, ESC dismiss)
// Ported and extended from desktop ShellIconButton iconTooltip CSS pattern:
//  - useId + aria-describedby association (ShellIconButton) +
//  - hover delay, focus trigger, ESC dismiss (new), reduced-motion gating.
// Pure CSS positioning (absolute), no portal/Radix runtime dependency.
// Viewport flipping (#1507): on open, and on scroll/resize while open, the
// tooltip is measured and `data-side` is flipped when it would overflow the
// viewport (bottom->top, top->bottom, right->left, left->right). Flip is
// one-shot (no re-flip of the flipped side) — enough to keep the tooltip
// visible in normal viewports.
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
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

/** Offset between trigger and tooltip — must mirror Tooltip.module.css gaps
 *  (8px vertical, 9px horizontal) so the overflow math matches the CSS. */
const VERTICAL_GAP_PX = 8;
const HORIZONTAL_GAP_PX = 9;

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

/** Opposite side for viewport flipping. */
function flipSide(side: TooltipSide): TooltipSide {
  if (side === 'top') return 'bottom';
  if (side === 'bottom') return 'top';
  if (side === 'left') return 'right';
  return 'left';
}

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

  // ── Viewport flipping (#1507) ──────────────────────────────────────
  // Measure on open and re-measure on scroll/resize while open. The flip is
  // one-shot per axis: when the requested side would overflow the viewport,
  // we render the opposite `data-side` (CSS classes already exist for all
  // four sides, so no portal or layout restructure is needed).
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLSpanElement | null>(null);
  const [flipped, setFlipped] = useState(false);

  const measureAndMaybeFlip = useCallback(() => {
    const host = hostRef.current;
    const tooltip = tooltipRef.current;
    if (!host || !tooltip) return;

    const hostRect = host.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let shouldFlip: boolean;
    if (side === 'bottom') {
      shouldFlip = hostRect.bottom + VERTICAL_GAP_PX + tooltipRect.height > viewportHeight;
    } else if (side === 'top') {
      shouldFlip = hostRect.top - VERTICAL_GAP_PX - tooltipRect.height < 0;
    } else if (side === 'right') {
      shouldFlip = hostRect.right + HORIZONTAL_GAP_PX + tooltipRect.width > viewportWidth;
    } else {
      shouldFlip = hostRect.left - HORIZONTAL_GAP_PX - tooltipRect.width < 0;
    }
    setFlipped(shouldFlip);
  }, [side]);

  // Reset the flip when the requested side changes (e.g. consumer switches
  // side while the tooltip is closed); the open-path measure below re-applies
  // the correct value when the tooltip is visible.
  useEffect(() => {
    setFlipped(false);
  }, [side]);

  // Measure right after the tooltip enters the DOM (before paint) so the
  // flipped side never flashes.
  useLayoutEffect(() => {
    if (!open) return;
    measureAndMaybeFlip();
  }, [open, measureAndMaybeFlip]);

  // Re-measure while open: the trigger may scroll under a sticky panel or the
  // window may resize; capture-phase scroll catches scrolls from any ancestor.
  useEffect(() => {
    if (!open) return;
    const handleViewportChange = () => {
      measureAndMaybeFlip();
    };
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [open, measureAndMaybeFlip]);

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
    <span ref={hostRef} className={cx(styles.host, className)}>
      {trigger}
      {open ? (
        <span
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          className={styles.tooltip}
          data-side={flipped ? flipSide(side) : side}
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}
