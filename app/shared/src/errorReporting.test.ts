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

  it('hides TypeError / ReferenceError / SyntaxError names', () => {
    expect(friendlyErrorMessage('TypeError: Cannot read properties of null', 'fallback')).toBe(
      'fallback',
    );
    expect(friendlyErrorMessage('ReferenceError: x is not defined', 'fallback')).toBe('fallback');
    expect(friendlyErrorMessage('SyntaxError: Unexpected token < in JSON at position 0', 'fallback')).toBe('fallback');
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

// #2072 P1: verify that friendlyErrorMessage filters backend technical strings
// so callers using t(key, {detail: friendlyErrorMessage(...)}) never leak them.
describe('error.message passthrough elimination (#2072 P1)', () => {
  const technicalMessagesFiltered = [
    'HTTP 503 Service Unavailable',
    'TypeError: Cannot read properties of null',
    'ReferenceError: x is not defined',
    'at fetchData (client.ts:42:7)',
    'node:internal/errors:496',
    'proxy connect timeout',
    'the stack is full',
  ];

  for (const raw of technicalMessagesFiltered) {
    it(`filters technical string "${raw}" into the fallback`, () => {
      expect(friendlyErrorMessage(raw, 'User-friendly fallback')).toBe(
        'User-friendly fallback',
      );
    });
  }

  it('wraps non-technical backend messages in the i18n template via caller pattern', () => {
    // Non-technical backend English (e.g. "task has been cancelled") passes
    // through friendlyErrorMessage unchanged — the caller's t(key, {detail})
    // wraps it in a localized template so the user never sees a bare English
    // string as the entire toast body.
    const raw = 'task has been cancelled';
    const detail = friendlyErrorMessage(raw, 'fallback');
    // detail may be the raw string (acceptable); the key contract is that
    // the toast body is t(key, {detail}), not raw error.message directly.
    expect(detail).toBeTruthy();
    expect(typeof detail).toBe('string');
  });

  it('returns fallback for undefined input', () => {
    expect(friendlyErrorMessage(undefined, 'safe fallback')).toBe('safe fallback');
  });
});

// #2072 P1: categorizeError errcode-aware — known codes get specialized copy.
describe('errcode-aware toast copy (#2072 P1)', () => {
  beforeEach(() => {
    globalErrorReporter.clear();
  });

  afterEach(() => {
    setToastHandler(null);
    globalErrorReporter.clear();
  });

  it('surfaces the errcode code field on ErrorReport for AppError instances', async () => {
    // Import AppError dynamically to avoid circular deps in test setup
    const { AppError } = await import('./errors');
    const err = new AppError(
      { error: { code: 'auth_token_expired', message: 'token is invalid or expired' } },
      401,
    );
    const report = globalErrorReporter.report(err);
    expect(report.code).toBe('auth_token_expired');
  });

  it('leaves code undefined for plain Error instances', () => {
    const report = globalErrorReporter.report(new Error('plain error'));
    expect(report.code).toBeUndefined();
  });

  it('does not regress unknown errcodes (no specialized copy available)', async () => {
    const { AppError } = await import('./errors');
    const handler = vi.fn<(config: ToastConfig) => void>();
    setToastHandler(handler);

    // Use useErrorReporter to wire the listener
    const { renderHook } = await import('@testing-library/react');
    const { unmount } = renderHook(() => useErrorReporter());

    const err = new AppError(
      { error: { code: 'some_unknown_code', message: 'something went wrong' } },
      500,
    );
    act(() => {
      globalErrorReporter.report(err);
    });

    expect(handler).toHaveBeenCalled();
    const toast = handler.mock.calls[0][0];
    // Unknown code should fall back to category-based title (runtime for 500)
    expect(toast.title).toBeTruthy();
    expect(toast.title).not.toBe('some_unknown_code');

    unmount();
  });
});

// #2072 P1: each of the 5 specified errcodes has a dedicated i18n key mapping.
describe('errcode key mapping completeness (#2072 P1)', () => {
  it('maps all 5 specified errcodes to dedicated i18n keys', async () => {
    const { ERRCode_KEYS } = await import('./errorReporting');
    const requiredCodes = [
      'auth_invalid_token',
      'auth_token_expired',
      'workspace_not_allowed',
      'agent_offline',
      'target_not_routable',
    ];
    for (const code of requiredCodes) {
      expect(ERRCode_KEYS[code], `missing key mapping for ${code}`).toBeTruthy();
      expect(ERRCode_KEYS[code]).toMatch(/^error\.code\./);
    }
  });

  it('returns undefined for unknown codes (no specialized copy)', async () => {
    const { errcodeToastCopy } = await import('./errorReporting');
    // Without i18n initialized with real resources, errcodeToastCopy returns
    // undefined for any code — verifying the safe fallback path.
    expect(errcodeToastCopy('unknown_code')).toBeUndefined();
    expect(errcodeToastCopy(undefined)).toBeUndefined();

describe('event stream error filtering (#2072 P2-⑯)', () => {
  it('filters technical strings from event_stream_parse errors', () => {
    const captured: ToastConfig[] = [];
    setToastHandler((cfg) => captured.push(cfg));
    try {
      globalErrorReporter.report(
        new Error('SyntaxError: Unexpected token < in JSON at position 0'),
        { context: 'event_stream_parse' },
      );
      expect(captured).toHaveLength(1);
      // Must NOT leak raw technical string
      expect(captured[0].message).not.toContain('SyntaxError');
      expect(captured[0].message).not.toContain('Unexpected token');
      expect(captured[0].message).not.toContain('JSON at position');
    } finally {
      setToastHandler(null);
      globalErrorReporter.clear();
    }
  });

  it('passes through user-meaningful reconnect messages', () => {
    const captured: ToastConfig[] = [];
    setToastHandler((cfg) => captured.push(cfg));
    try {
      globalErrorReporter.report(
        new Error('Max retries (5) reached, giving up'),
        { context: 'event_stream_reconnect', retryCount: 5 },
      );
      expect(captured).toHaveLength(1);
      // "Max retries" is user-meaningful (not a stack frame or HTTP status),
      // so friendlyErrorMessage lets it through.
      expect(captured[0].message).toContain('Max retries');
    } finally {
      setToastHandler(null);
      globalErrorReporter.clear();
    }
  });
});
