// real_tested=true
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useIsMaxWidth, useIsMinWidth, useMediaQuery } from './useMediaQuery';

/* ═══════════════════════════════════════════════════════════════════
   useMediaQuery — matchMedia subscription (#1827 breakpoint hook).

   jsdom implements no matchMedia, so every suite stubs the global and
   drives the hook through a fake MediaQueryList that can fire `change`.
   ═══════════════════════════════════════════════════════════════════ */

interface FakeMediaQueryList {
  media: string;
  matches: boolean;
  onchange: null;
  addEventListener: (type: string, listener: (event: MediaQueryListEvent) => void) => void;
  removeEventListener: (type: string, listener: (event: MediaQueryListEvent) => void) => void;
  addListener: (listener: (event: MediaQueryListEvent) => void) => void;
  removeListener: (listener: (event: MediaQueryListEvent) => void) => void;
  dispatchEvent: (event: Event) => boolean;
  fireChange: (matches: boolean) => void;
  listenerCount: () => number;
}

function createFakeMediaQueryList(initialMatches: boolean): FakeMediaQueryList {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  return {
    media: '(fake)',
    matches,
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void): void => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void): void => {
      listeners.delete(listener);
    },
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
    fireChange: (nextMatches: boolean): void => {
      matches = nextMatches;
      for (const listener of listeners) {
        listener({ matches: nextMatches } as MediaQueryListEvent);
      }
    },
    listenerCount: () => listeners.size,
  };
}

function stubMatchMedia(initialMatches: boolean): {
  mql: FakeMediaQueryList;
  matchMediaStub: ReturnType<typeof vi.fn>;
} {
  const mql = createFakeMediaQueryList(initialMatches);
  const matchMediaStub = vi.fn().mockReturnValue(mql);
  vi.stubGlobal('matchMedia', matchMediaStub);
  return { mql, matchMediaStub };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useMediaQuery', () => {
  it('initializes from the current media query match', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    expect(result.current).toBe(true);

    stubMatchMedia(false);
    const { result: unmatched } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    expect(unmatched.current).toBe(false);
  });

  it('tracks matchMedia change events', () => {
    const { mql } = stubMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery('(max-width: 768px)'));
    expect(result.current).toBe(false);

    act(() => {
      mql.fireChange(true);
    });
    expect(result.current).toBe(true);

    act(() => {
      mql.fireChange(false);
    });
    expect(result.current).toBe(false);
  });

  it('re-subscribes when the query changes and drops the old listener', () => {
    const first = stubMatchMedia(true);
    const { result, rerender } = renderHook(
      ({ query }: { query: string }) => useMediaQuery(query),
      { initialProps: { query: '(max-width: 480px)' } },
    );
    expect(first.matchMediaStub).toHaveBeenCalledWith('(max-width: 480px)');
    expect(first.mql.listenerCount()).toBe(1);
    expect(result.current).toBe(true);

    stubMatchMedia(false);
    rerender({ query: '(min-width: 1280px)' });
    expect(first.mql.listenerCount()).toBe(0);
    expect(result.current).toBe(false);
  });

  it('returns false when matchMedia is unavailable (server / old browser)', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    expect(result.current).toBe(false);
  });

  it('cleans up its change listener on unmount', () => {
    const { mql } = stubMatchMedia(true);
    const { unmount } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    expect(mql.listenerCount()).toBe(1);

    unmount();
    expect(mql.listenerCount()).toBe(0);
  });
});

describe('breakpoint convenience hooks', () => {
  it('builds the query from a breakpoint key for the max-width form', () => {
    const { matchMediaStub } = stubMatchMedia(true);
    const { result } = renderHook(() => useIsMaxWidth('narrow'));
    expect(matchMediaStub).toHaveBeenCalledWith('(max-width: 768px)');
    expect(result.current).toBe(true);
  });

  it('builds the query from a breakpoint key for the min-width form', () => {
    const { matchMediaStub } = stubMatchMedia(false);
    const { result } = renderHook(() => useIsMinWidth('standard'));
    expect(matchMediaStub).toHaveBeenCalledWith('(min-width: 1280px)');
    expect(result.current).toBe(false);
  });
});
