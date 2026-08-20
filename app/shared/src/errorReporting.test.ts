// real_tested=true
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { friendlyErrorMessage, setToastHandler, useErrorReporter, type ToastConfig } from './errorReporting';
import { globalErrorReporter, HubNetworkError } from './errors';

describe('friendlyErrorMessage', () => {
  it('returns the fallback for missing input', () => {
    expect(friendlyErrorMessage(undefined, 'fallback')).toBe('fallback');
    expect(friendlyErrorMessage('', 'fallback')).toBe('fallback');
  });

  it('passes a friendly message through unchanged', () => {
    expect(friendlyErrorMessage('Please check your connection', 'fallback')).toBe(
      'Please check your connection',
    );
  });

  it('hides HTTP status strings', () => {
    expect(friendlyErrorMessage('HTTP 503 Service Unavailable', 'fallback')).toBe('fallback');
    expect(friendlyErrorMessage('Request failed: HTTP 500 Internal Server Error', 'fallback')).toBe(
      'fallback',
    );
  });

  it('matches HTTP statuses case-insensitively', () => {
    expect(friendlyErrorMessage('http 404 not found', 'fallback')).toBe('fallback');
  });

  it('hides proxy-internal strings', () => {
    expect(friendlyErrorMessage('proxy connect timeout', 'fallback')).toBe('fallback');
  });

  it('hides TypeError / ReferenceError names', () => {
    expect(friendlyErrorMessage('TypeError: Cannot read properties of null', 'fallback')).toBe(
      'fallback',
    );
    expect(friendlyErrorMessage('ReferenceError: x is not defined', 'fallback')).toBe('fallback');
  });

  it('hides stack-frame text', () => {
    expect(friendlyErrorMessage('at fetchData (client.ts:42:7)', 'fallback')).toBe('fallback');
  });

  it('hides node: internal references', () => {
    expect(friendlyErrorMessage('node:internal/errors:496', 'fallback')).toBe('fallback');
  });

  it('treats a bare "stack" substring as technical', () => {
    expect(friendlyErrorMessage('the stack is full', 'fallback')).toBe('fallback');
  });
});

describe('toast delivery contract', () => {
  beforeEach(() => {
    globalErrorReporter.clear();
  });

  afterEach(() => {
    setToastHandler(null);
    globalErrorReporter.clear();
  });

  it('does not deliver toasts while no mounted component subscribes the listener', () => {
    // errorReporterListener only subscribes from useErrorReporter(); the raw
    // reporter has no direct path to the toast handler.
    const handler = vi.fn<(config: ToastConfig) => void>();
    setToastHandler(handler);

    globalErrorReporter.report(new HubNetworkError());

    expect(handler).not.toHaveBeenCalled();
  });

  it('accepts a null handler without breaking reporting', () => {
    setToastHandler(null);
    expect(() => globalErrorReporter.report(new Error('boom'))).not.toThrow();
  });

  it('keeps reporting safe when the handler is detached after use', () => {
    const handler = vi.fn<(config: ToastConfig) => void>();
    setToastHandler(handler);
    setToastHandler(null);
    expect(() => globalErrorReporter.report(new Error('boom'))).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('useErrorReporter snapshot stability (#1795)', () => {
  afterEach(() => {
    globalErrorReporter.clear();
  });

  it('returns the same snapshot reference across renders without store updates', () => {
    // getSnapshot must be Object.is-stable between store changes, otherwise
    // React's useSyncExternalStore consistency check re-renders forever and
    // aborts with "Maximum update depth exceeded" (#1795). The hook returns
    // the snapshot object itself, so reference equality pins that contract.
    const { result, rerender } = renderHook(() => useErrorReporter());
    const firstSnapshot = result.current.stats;

    rerender();
    expect(result.current.stats).toBe(firstSnapshot);

    rerender();
    expect(result.current.stats).toBe(firstSnapshot);
  });

  it('returns a fresh snapshot with correct content after a store update', () => {
    const { result, rerender } = renderHook(() => useErrorReporter());
    const beforeUpdate = result.current.stats;
    expect(beforeUpdate.total).toBe(0);
    expect(beforeUpdate.latest).toBeNull();

    act(() => {
      globalErrorReporter.report(new HubNetworkError());
    });

    const afterUpdate = result.current.stats;
    expect(afterUpdate).not.toBe(beforeUpdate);
    expect(afterUpdate.total).toBe(1);
    expect(afterUpdate.byCategory.network).toBe(1);
    expect(afterUpdate.latest?.message).toBe(new HubNetworkError().message);

    // Once the update settles the snapshot must be stable again; a fresh
    // object per render would re-trigger the update loop.
    rerender();
    expect(result.current.stats).toBe(afterUpdate);
  });

  it('resets to an empty snapshot after clearErrors', () => {
    const { result, rerender } = renderHook(() => useErrorReporter());
    act(() => {
      globalErrorReporter.report(new HubNetworkError());
    });
    expect(result.current.stats.total).toBe(1);

    act(() => {
      result.current.clearErrors();
    });
    rerender();

    expect(result.current.stats.total).toBe(0);
    expect(result.current.stats.latest).toBeNull();
    expect(result.current.stats.byCategory).toEqual({});
  });

  it('clear notifies change-channel subscribers even without a new report', () => {
    const { result, rerender } = renderHook(() => useErrorReporter());
    act(() => {
      globalErrorReporter.report(new HubNetworkError());
    });
    expect(result.current.stats.total).toBe(1);

    // Direct store clear (no hook in the middle) must still re-render
    // consumers: the change channel fires on clear, not only on report.
    act(() => {
      globalErrorReporter.clear();
    });
    rerender();

    expect(result.current.stats.total).toBe(0);
    expect(result.current.stats.latest).toBeNull();
  });
});
