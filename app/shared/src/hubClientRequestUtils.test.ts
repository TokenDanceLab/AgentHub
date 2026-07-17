import { describe, expect, it } from 'vitest';
import { AppError } from './errors';
import {
  isRouteFallbackError,
  normalizeRegisterDeviceRequest,
  qs,
  shouldContinueRouteFallback,
  shouldUseChangePasswordFallback,
  unresolvedRouteFallbackError,
} from './hubClientRequestUtils';

describe('hubClientRequestUtils (#799 / #935 / #957)', () => {
  it('builds query strings and skips null/undefined values', () => {
    expect(qs({})).toBe('');
    expect(qs({ a: null, b: undefined })).toBe('');
    expect(qs({ limit: 20, unread_only: true, cursor: null })).toBe(
      '?limit=20&unread_only=true',
    );
  });

  it('classifies 404/405 AppError as route fallback errors', () => {
    expect(isRouteFallbackError(new AppError({ error: { code: 'x', message: 'm' } }, 404))).toBe(
      true,
    );
    expect(isRouteFallbackError(new AppError({ error: { code: 'x', message: 'm' } }, 405))).toBe(
      true,
    );
    expect(isRouteFallbackError(new AppError({ error: { code: 'x', message: 'm' } }, 500))).toBe(
      false,
    );
    expect(isRouteFallbackError(new Error('boom'))).toBe(false);
  });

  it('decides whether requestWithFallback should continue (#935)', () => {
    const notFound = new AppError({ error: { code: 'x', message: 'm' } }, 404);
    const server = new AppError({ error: { code: 'x', message: 'm' } }, 500);
    expect(shouldContinueRouteFallback(0, 2, notFound)).toBe(true);
    expect(shouldContinueRouteFallback(1, 2, notFound)).toBe(false);
    expect(shouldContinueRouteFallback(0, 2, server)).toBe(false);
    expect(shouldContinueRouteFallback(0, 1, notFound)).toBe(false);
  });

  it('peels change-password fallback + unresolved route residual (#957)', () => {
    const notFound = new AppError({ error: { code: 'x', message: 'm' } }, 404);
    const methodNotAllowed = new AppError({ error: { code: 'x', message: 'm' } }, 405);
    const server = new AppError({ error: { code: 'x', message: 'm' } }, 500);
    expect(shouldUseChangePasswordFallback(notFound)).toBe(true);
    expect(shouldUseChangePasswordFallback(methodNotAllowed)).toBe(true);
    expect(shouldUseChangePasswordFallback(server)).toBe(false);
    expect(shouldUseChangePasswordFallback(new Error('boom'))).toBe(false);

    expect(unresolvedRouteFallbackError(notFound)).toBe(notFound);
    expect(unresolvedRouteFallbackError(undefined)).toBeUndefined();
  });

  it('normalizes register-device defaults and capabilities arrays', () => {
    expect(
      normalizeRegisterDeviceRequest({
        device_id: 'dev1',
        capabilities: ['run', 'stream'],
      }),
    ).toEqual({
      device_id: 'dev1',
      device_name: 'dev1',
      device_type: 'desktop',
      capabilities: { run: true, stream: true },
    });

    expect(
      normalizeRegisterDeviceRequest({
        device_id: 'dev2',
        device_name: 'My Phone',
        device_type: 'mobile',
        capabilities: { voice: true },
      }),
    ).toEqual({
      device_id: 'dev2',
      device_name: 'My Phone',
      device_type: 'mobile',
      capabilities: { voice: true },
    });
  });
});
