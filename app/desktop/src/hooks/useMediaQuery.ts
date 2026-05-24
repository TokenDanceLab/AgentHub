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

/** True when viewport width < 768px (mobile). */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 767px)');
}

/** True when 768px <= viewport width < 1024px (tablet). */
export function useIsTablet(): boolean {
  return useMediaQuery('(min-width: 768px) and (max-width: 1023px)');
}
