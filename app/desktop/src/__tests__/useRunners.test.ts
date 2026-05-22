import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRunners } from '../hooks/useRunners';

describe('useRunners', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('returns empty list when offline', () => {
    const { result } = renderHook(() => useRunners(false));
    expect(result.current).toEqual([]);
  });

  it('fetches runners when online', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        items: [{ id: 'r1', name: 'Mock', status: 'online' }],
        page: { hasMore: false },
      }),
    } as Response);

    const { result } = renderHook(() => useRunners(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current).toHaveLength(1);
    expect(result.current[0].id).toBe('r1');
  });

  it('clears runners when going offline', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        items: [{ id: 'r1', name: 'Mock', status: 'online' }],
        page: { hasMore: false },
      }),
    } as Response);

    const { result, rerender } = renderHook(
      ({ online }) => useRunners(online),
      { initialProps: { online: true } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toHaveLength(1);

    rerender({ online: false });
    expect(result.current).toHaveLength(0);
  });

  it('handles fetch error gracefully', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network error'));

    const { result } = renderHook(() => useRunners(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current).toEqual([]);
  });

  it('polls when online', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: [], page: { hasMore: false } }),
    } as Response);

    renderHook(() => useRunners(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const afterFirst = fetchSpy.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(fetchSpy).toHaveBeenCalledTimes(afterFirst + 1);
  });
});
