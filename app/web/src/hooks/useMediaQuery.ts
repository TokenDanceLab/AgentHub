import { useState, useEffect } from 'react';

/**
 * Returns true when the viewport matches the given media query string.
 * Re-evaluates on window resize.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    setMatches(mql.matches);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

/** True when viewport width < 760px (mobile / shell narrow SSOT #1309). */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 759px)');
}

/** True when 760px <= viewport width < 1024px (tablet). */
export function useIsTablet(): boolean {
  return useMediaQuery('(min-width: 760px) and (max-width: 1023px)');
}
