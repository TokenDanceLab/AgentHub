// Focus-trap utility for overlay/dialog components.
// Implements WAI-ARIA dialog pattern: traps Tab/Shift+Tab within the
// container and returns focus to the trigger element on close.
// WCAG 2.1 Level A — 2.4.3 Focus Order.
import { useLayoutEffect, useRef, type RefObject } from 'react';

export const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null, // visible (not display:none / visibility:hidden)
  );
}

/**
 * Traps Tab / Shift+Tab inside `containerRef` while `active` is true.
 * On activation: saves `document.activeElement` as the trigger and focuses
 * the first focusable descendant (or the container itself).
 * On deactivation / unmount: returns focus to the saved trigger.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
): void {
  const triggerRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!active || !containerRef.current) return;
    const container = containerRef.current;

    // Save the element that triggered the dialog open.
    triggerRef.current = document.activeElement as HTMLElement | null;

    // Move focus into the dialog.
    const focusable = getFocusableElements(container);
    const first = focusable[0] ?? container;
    first.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;

      const focusableNow = getFocusableElements(container);
      if (focusableNow.length === 0) {
        e.preventDefault();
        return;
      }

      const firstEl = focusableNow[0]!;
      const lastEl = focusableNow[focusableNow.length - 1]!;

      if (e.shiftKey) {
        // Shift+Tab: if focus is on first element, wrap to last
        if (document.activeElement === firstEl || document.activeElement === container) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        // Tab: if focus is on last element, wrap to first
        if (document.activeElement === lastEl || document.activeElement === container) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      // Return focus to the trigger that opened the dialog.
      triggerRef.current?.focus();
    };
  }, [active, containerRef]);
}
