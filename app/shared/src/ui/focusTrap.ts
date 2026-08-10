// Focus-trap utility for overlay/dialog components.
// Implements WAI-ARIA dialog pattern: traps Tab/Shift+Tab within the
// container and returns focus to the trigger element on close.
// WCAG 2.1 Level A — 2.4.3 Focus Order.
import { useLayoutEffect, useRef, type RefObject } from 'react';

export const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isVisible(el: HTMLElement): boolean {
  // offsetParent is null for position:fixed elements even when visible, so it
  // must not be the sole visibility check (browser bug this file was created
  // to fix). Geometry fast path:
  if (el.offsetParent !== null) return true;
  if (el.getClientRects().length > 0) return true;
  // jsdom has no layout engine: offsetParent/getClientRects are always empty,
  // so fall back to computed style, including ancestors (a child of a
  // display:none container is itself hidden).
  let node: HTMLElement | null = el;
  while (node) {
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    node = node.parentElement;
  }
  return true;
}

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible);
}

// Registry of currently active traps so nested dialogs (e.g. a modal opened
// from inside another modal) hand Tab to the innermost trap instead of the
// outer one stealing the wrap.
const activeTraps = new Set<HTMLElement>();

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
    activeTraps.add(container);

    // Save the element that triggered the dialog open.
    triggerRef.current = document.activeElement as HTMLElement | null;

    // Move focus into the dialog.
    const focusable = getFocusableElements(container);
    const first = focusable[0] ?? container;
    first.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const activeEl = document.activeElement as HTMLElement | null;
      if (!activeEl) return;

      // A nested trap whose container holds the focused element owns this Tab
      // — the outer trap must not steal the wrap.
      for (const other of activeTraps) {
        if (other !== container && container.contains(other) && other.contains(activeEl)) {
          return;
        }
      }

      const focusableNow = getFocusableElements(container);
      if (focusableNow.length === 0) {
        e.preventDefault();
        return;
      }

      const firstEl = focusableNow[0]!;
      const lastEl = focusableNow[focusableNow.length - 1]!;

      if (e.shiftKey) {
        // Shift+Tab: if focus is on first element, wrap to last
        if (activeEl === firstEl || activeEl === container) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        // Tab: if focus is on last element, wrap to first
        if (activeEl === lastEl || activeEl === container) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      activeTraps.delete(container);
      // Return focus to the trigger that opened the dialog.
      triggerRef.current?.focus();
    };
  }, [active, containerRef]);
}
