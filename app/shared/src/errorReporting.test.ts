// real_tested=true
import { renderHook } from '@testing-library/react';
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

describe('useErrorReporter (known production bug)', () => {
  afterEach(() => {
    globalErrorReporter.clear();
  });

  it('crashes on mount: unstable getSnapshot loops useSyncExternalStore', () => {
    // getSnapshot() builds a fresh { total, byCategory, latest } object per
    // call, so React's snapshot-consistency check re-renders forever and
    // aborts with "Maximum update depth exceeded". Pinned so the fix
    // (memoizing getSnapshot) turns this test into a regression alert.
    expect(() => renderHook(() => useErrorReporter())).toThrow('Maximum update depth exceeded');
  });
});
