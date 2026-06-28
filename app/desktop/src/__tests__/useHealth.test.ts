import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHealth } from '../hooks/useHealth';
import { HEALTH_POLL_MS } from '../config';

describe('useHealth', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('starts as offline before first poll resolves', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise(() => {}), // never resolves
    );

    const { result } = renderHook(() => useHealth());
    expect(result.current.online).toBe(false);
    expect(result.current.health).toBeNull();
  });

  it('does not poll when disabled', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok', version: 'v1', edgeId: 'local' }),
    } as Response);

    const { result } = renderHook(() => useHealth({ enabled: false }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
      result.current.refetch();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.online).toBe(false);
    expect(result.current.health).toBeNull();
  });

  it('transitions to online on successful health check', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok', version: 'v1', edgeId: 'local' }),
    } as Response);

    const { result } = renderHook(() => useHealth());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.online).toBe(true);
    expect(result.current.health?.status).toBe('ok');
  });

  it('polls repeatedly', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok', version: 'v1', edgeId: 'local' }),
    } as Response);

    renderHook(() => useHealth());

    // Let the initial poll + any immediate interval callback fire.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const afterFirst = fetchSpy.mock.calls.length;

    // Advance by one poll interval.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEALTH_POLL_MS);
    });

    expect(fetchSpy).toHaveBeenCalledTimes(afterFirst + 1);
  });

  it('goes offline on failed health check', async () => {
    // Start online.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok', version: 'v1', edgeId: 'local' }),
    } as Response);

    const { result } = renderHook(() => useHealth());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.online).toBe(true);

    // Now make it fail.
    fetchSpy.mockRejectedValue(new Error('connection refused'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEALTH_POLL_MS);
    });

    expect(result.current.online).toBe(false);
    expect(result.current.health).toBeNull();
    expect(result.current.lastError).toBe('connection refused');
  });
});
