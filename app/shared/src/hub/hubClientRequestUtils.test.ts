import { describe, expect, it } from 'vitest';
import { AppError } from '../errors';
import {
  invokeNormalizedRegisterDeviceRequest,
  invokePathFormDataUpload,
  invokePathInitRequest,
  invokePathsInitRequest,
  isRouteFallbackError,
  normalizeRegisterDeviceRequest,
  qs,
  resolveRouteFallbackStep,
  runNormalizedExecutionTargetsListRequest,
  runRequestWithRouteFallback,
  shouldContinueRouteFallback,
  unresolvedRouteFallbackError,
} from './hubClientRequestUtils';

describe('hubClientRequestUtils (#799 / #935 / #957 / #978 / #990 / #1023 / #1044)', () => {
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

  it('peels unresolved route residual (#957)', () => {
    const notFound = new AppError({ error: { code: 'x', message: 'm' } }, 404);

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

  it('runs requestWithFallback route residual (#990)', async () => {
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
  });

  it('peels path+init / path+formData / paths+init invokers (#1023)', async () => {
    const requestCalls: Array<{ path: string; method?: string }> = [];
    const value = await invokePathInitRequest(
      async (path, init) => {
        const call: { path: string; method?: string } = { path };
        if (init.method !== undefined) {
          call.method = init.method;
        }
        requestCalls.push(call);
        return 'ok' as const;
      },
      { path: '/client/auth/refresh', init: { method: 'POST', body: '{}' } },
    );
    expect(value).toBe('ok');
    expect(requestCalls).toEqual([{ path: '/client/auth/refresh', method: 'POST' }]);

    const form = new FormData();
    form.set('hash', 'h1');
    const uploadCalls: Array<{ path: string; hash: FormDataEntryValue | null }> = [];
    const uploaded = await invokePathFormDataUpload(
      async (path, formData) => {
        uploadCalls.push({ path, hash: formData.get('hash') });
        return { id: 'a1' } as const;
      },
      { path: '/client/attachments', formData: form },
    );
    expect(uploaded).toEqual({ id: 'a1' });
    expect(uploadCalls).toEqual([{ path: '/client/attachments', hash: 'h1' }]);

    // exactOptional: omit options entirely when init is undefined
    const fallbackCalls: Array<{ paths: readonly string[]; hasOptions: boolean }> = [];
    await invokePathsInitRequest(
      async (paths, options) => {
        fallbackCalls.push({
          paths,
          hasOptions: options !== undefined,
        });
        return undefined;
      },
      ['/a:route', '/a/route'],
    );
    expect(fallbackCalls).toEqual([{ paths: ['/a:route', '/a/route'], hasOptions: false }]);

    await invokePathsInitRequest(
      async (paths, options) => {
        fallbackCalls.push({
          paths,
          hasOptions: options !== undefined,
        });
        return undefined;
      },
      ['/a:route', '/a/route'],
      { method: 'POST' },
    );
    expect(fallbackCalls[1]).toEqual({
      paths: ['/a:route', '/a/route'],
      hasOptions: true,
    });
  });

  it('peels register-device normalize + execution-target normalize residual (#1044)', async () => {
    const calls: Array<{ paths: readonly string[]; body?: string }> = [];
    const device = await invokeNormalizedRegisterDeviceRequest(
      async (paths, options) => {
        calls.push({
          paths,
          body: typeof options?.body === 'string' ? options.body : undefined,
        });
        return { id: 'dev-1' } as const;
      },
      { device_id: 'dev1', capabilities: ['run'] },
      () => ['/edge/devices:register', '/edge/devices/register'] as const,
      (normalized) => ({
        method: 'POST' as const,
        body: JSON.stringify(normalized),
      }),
    );
    expect(device).toEqual({ id: 'dev-1' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.paths).toEqual(['/edge/devices:register', '/edge/devices/register']);
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      device_id: 'dev1',
      device_name: 'dev1',
      device_type: 'desktop',
      capabilities: { run: true },
    });

    const normalized = await runNormalizedExecutionTargetsListRequest(
      async (path) => {
        expect(path).toBe('/web/execution-targets');
        return [{ id: 't1' }] as Array<{ id: string }>;
      },
      '/web/execution-targets',
      (data) =>
        Array.isArray(data)
          ? { items: data as Array<{ id: string }>, page: { hasMore: false } }
          : { items: [], page: { hasMore: false } },
    );
    expect(normalized).toEqual({ items: [{ id: 't1' }], page: { hasMore: false } });
  });
});
