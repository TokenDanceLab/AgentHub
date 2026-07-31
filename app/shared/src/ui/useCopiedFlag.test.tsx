import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCopiedFlag } from './useCopiedFlag';

describe('useCopiedFlag (fable UIUX #4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with copied = false', () => {
    const { result } = renderHook(() => useCopiedFlag());
    expect(result.current[0]).toBe(false);
  });

  it('flips to true on markCopied and resets after 1500ms', () => {
    const { result } = renderHook(() => useCopiedFlag());
    act(() => {
      result.current[1]();
    });
    expect(result.current[0]).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(result.current[0]).toBe(false);
  });

  it('does not reset before the window elapses', () => {
    const { result } = renderHook(() => useCopiedFlag());
    act(() => {
      result.current[1]();
    });
    act(() => {
      vi.advanceTimersByTime(1499);
    });
    expect(result.current[0]).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current[0]).toBe(false);
  });

  it('restarts the timer on repeated markCopied calls', () => {
    const { result } = renderHook(() => useCopiedFlag());
    act(() => {
      result.current[1]();
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => {
      result.current[1](); // re-trigger restarts the 1500ms window
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current[0]).toBe(true);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current[0]).toBe(false);
  });

  it('honors a custom reset window', () => {
    const { result } = renderHook(() => useCopiedFlag(100));
    act(() => {
      result.current[1]();
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current[0]).toBe(false);
  });
});
