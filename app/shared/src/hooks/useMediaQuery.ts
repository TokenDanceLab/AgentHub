import { useEffect, useState } from 'react';
import { maxWidthQuery, minWidthQuery } from '../styles/breakpoints';
import type { BreakpointKey } from '../styles/breakpoints';

/* ═══════════════════════════════════════════════════════════════════
   useMediaQuery — matchMedia wrapper (#1827 breakpoint system).

   The breakpoint SSOT lives in @shared/styles/breakpoints (BREAKPOINTS +
   minWidthQuery / maxWidthQuery). This hook turns those query strings
   into a reactive boolean, so JS behavior tracks the same tiers that
   CSS `@media` blocks use.

   Guards (mirrors shared/src/theme.ts): server/non-browser renders and
   environments without matchMedia yield `false` instead of throwing.
   ═══════════════════════════════════════════════════════════════════ */

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => readQueryMatch(query));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQueryList = window.matchMedia(query);
    setMatches(mediaQueryList.matches);

    const handleChange = (event: MediaQueryListEvent): void => {
      setMatches(event.matches);
    };

    mediaQueryList.addEventListener('change', handleChange);
    return () => {
      mediaQueryList.removeEventListener('change', handleChange);
    };
  }, [query]);

  return matches;
}

/** True when the viewport is at or above the given breakpoint tier. */
export function useIsMinWidth(key: BreakpointKey): boolean {
  return useMediaQuery(minWidthQuery(key));
}

/** True when the viewport is at or below the given breakpoint tier. */
export function useIsMaxWidth(key: BreakpointKey): boolean {
  return useMediaQuery(maxWidthQuery(key));
}

function readQueryMatch(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(query).matches;
}
