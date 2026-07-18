import { describe, expect, it } from 'vitest';
import { AppError } from './errors';
import {
  isRouteFallbackError,
  normalizeRegisterDeviceRequest,
  qs,
  resolveRouteFallbackStep,
  runChangePasswordWithFallback,
  runRequestWithRouteFallback,
  shouldContinueRouteFallback,
  shouldUseChangePasswordFallback,
  unresolvedRouteFallbackError,
} from './hubClientRequestUtils';

describe('hubClientRequestUtils (#799 / #935 / #957 / #978 / #990)', () => {
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

  it('peels route-fallback continue/throw step residual (#978)', () => {
    const notFound = new AppError({ error: { code: 'x', message: 'm' } }, 404);
    const server = new AppError({ error: { code: 'x', message: 'm' } }, 500);
    expect(resolveRouteFallbackStep(0, 2, notFound)).toEqual({
      action: 'continue',
      fallbackError: notFound,
    });
    expect(resolveRouteFallbackStep(1, 2, notFound)).toEqual({
      action: 'throw',
      error: notFound,
    });
    expect(resolveRouteFallbackStep(0, 2, server)).toEqual({
      action: 'throw',
      error: server,
    });
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

  it('runs requestWithFallback + changePassword dual-route residual (#990)', async () => {
    const notFound = new AppError({ error: { code: 'x', message: 'm' } }, 404);
    const server = new AppError({ error: { code: 'x', message: 'm' } }, 500);

    const calls: string[] = [];
    const ok = await runRequestWithRouteFallback(
      ['/a:route', '/a/route'],
      async (path) => {
        calls.push(path);
        if (path === '/a:route') {
          throw notFound;
        }
        return 'ok' as const;
      },
    );
    expect(ok).toBe('ok');
    expect(calls).toEqual(['/a:route', '/a/route']);

    await expect(
      runRequestWithRouteFallback(['/only'], async () => {
        throw notFound;
      }),
    ).rejects.toBe(notFound);

    await expect(
      runRequestWithRouteFallback(
        ['/a:route', '/a/route'],
        async (path) => {
          if (path === '/a:route') {
            throw server;
          }
          return 'never';
        },
      ),
    ).rejects.toBe(server);

    const pwdCalls: Array<{ path: string; method?: string }> = [];
    await runChangePasswordWithFallback(
      async (path, init) => {
        const call: { path: string; method?: string } = { path };
        if (init.method !== undefined) {
          call.method = init.method;
        }
        pwdCalls.push(call);
        if (path === '/client/auth/change-password') {
          throw notFound;
        }
      },
      { path: '/client/auth/change-password', init: { method: 'POST', body: '{}' } },
      { path: '/client/auth/password', init: { method: 'PUT', body: '{}' } },
    );
    expect(pwdCalls).toEqual([
      { path: '/client/auth/change-password', method: 'POST' },
      { path: '/client/auth/password', method: 'PUT' },
    ]);

    await expect(
      runChangePasswordWithFallback(
        async () => {
          throw server;
        },
        { path: '/client/auth/change-password', init: { method: 'POST', body: '{}' } },
        { path: '/client/auth/password', init: { method: 'PUT', body: '{}' } },
      ),
    ).rejects.toBe(server);
  });
});
