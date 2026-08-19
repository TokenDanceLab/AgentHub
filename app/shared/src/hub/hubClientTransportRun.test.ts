// real_tested=true — every export of hubClientTransportRun is exercised with
// injected fake fetch implementations (no live network). The only globals
// touched are `fetch` (vi.stubGlobal for resolveHubClientRuntime's global
// fallback lookup, unstubbed in afterEach) and `console.error` (spied silent
// where the real catch/report residuals fire); the shared globalErrorReporter
// is cleared after each test.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError, globalErrorReporter } from '../errors';
import {
  createHubClientTransport,
  fetchHubJsonWithTimeout,
  fetchHubMultipartWithTimeout,
  resolveHubClientRuntime,
  resolveHubClientTransportOptions,
  runHubClientJsonRequest,
  runHubClientMultipartUploadRequest,
  runHubJsonRequest,
  runHubMultipartUploadRequest,
  runUnauthorizedTokenRefreshRecovery,
} from './hubClientTransportRun';

const BASE_URL = 'https://hub.example.test';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), { status });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  globalErrorReporter.clear();
});

describe('hubClientTransportRun (#1023 / #1044 / #1055)', () => {
  describe('fetchHubJsonWithTimeout', () => {
    it('composes options + headers + signal into one fetch init and returns the response', async () => {
      const headers = new Headers({ Authorization: 'Bearer tok' });
      const options: RequestInit = {
        method: 'PUT',
        body: JSON.stringify({ a: 1 }),
        credentials: 'include',
      };
      const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ ok: true }));

      const response = await fetchHubJsonWithTimeout(
        fetchImpl,
        `${BASE_URL}/x`,
        5_000,
        options,
        headers,
      );

      expect(response.status).toBe(200);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const url = fetchImpl.mock.calls[0]?.[0];
      const init = fetchImpl.mock.calls[0]?.[1];
      expect(String(url)).toBe(`${BASE_URL}/x`);
      expect(init).toMatchObject({
        method: 'PUT',
        body: JSON.stringify({ a: 1 }),
        credentials: 'include',
      });
      expect(init?.headers).toBe(headers);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.signal?.aborted).toBe(false);
    });

    it('rethrows fetchImpl rejections after clearing the abort timer', async () => {
      const fetchError = new TypeError('Failed to fetch');
      const fetchImpl: typeof fetch = async () => {
        throw fetchError;
      };

      await expect(
        fetchHubJsonWithTimeout(fetchImpl, `${BASE_URL}/x`, 5_000, {}, new Headers()),
      ).rejects.toBe(fetchError);
    });

    it('aborts the passed signal after timeoutMs', async () => {
      vi.useFakeTimers();
      const fetchImpl: typeof fetch = (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });

      const pending = fetchHubJsonWithTimeout(
        fetchImpl,
        `${BASE_URL}/x`,
        5_000,
        {},
        new Headers(),
      );
      const expectation = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      await vi.advanceTimersByTimeAsync(5_000);
      await expectation;
    });
  });

  describe('fetchHubMultipartWithTimeout', () => {
    it('POSTs formData under auth headers and returns the response', async () => {
      const headers = new Headers({ Authorization: 'Bearer tok-up' });
      const form = new FormData();
      form.set('hash', 'h1');
      const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ code: 'OK' }));

      const response = await fetchHubMultipartWithTimeout(
        fetchImpl,
        `${BASE_URL}/up`,
        5_000,
        headers,
        form,
      );

      expect(response.status).toBe(200);
      const url = fetchImpl.mock.calls[0]?.[0];
      const init = fetchImpl.mock.calls[0]?.[1];
      expect(String(url)).toBe(`${BASE_URL}/up`);
      expect(init).toMatchObject({ method: 'POST', body: form });
      expect(init?.headers).toBe(headers);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('runUnauthorizedTokenRefreshRecovery', () => {
    it('continues without invoking refresh or retry for non-401 statuses', async () => {
      const onRefreshToken = vi.fn(async () => 'tok');
      const retry = vi.fn(async () => 'never');

      const forbidden = await runUnauthorizedTokenRefreshRecovery({
        status: 403,
        onRefreshToken,
        headers: new Headers(),
        path: '/client/auth/me',
        retry,
        logError: () => undefined,
        report: () => undefined,
      });
      expect(forbidden).toEqual({ action: 'continue' });
      expect(onRefreshToken).not.toHaveBeenCalled();
      expect(retry).not.toHaveBeenCalled();

      const zeroStatus = await runUnauthorizedTokenRefreshRecovery({
        status: 0,
        onRefreshToken,
        headers: new Headers(),
        path: '/client/auth/me',
        retry,
        logError: () => undefined,
        report: () => undefined,
      });
      expect(zeroStatus).toEqual({ action: 'continue' });
      expect(onRefreshToken).not.toHaveBeenCalled();
    });

    it('continues when the refresh handler is missing or null even on 401', async () => {
      const retry = vi.fn(async () => 'never');

      const noHandler = await runUnauthorizedTokenRefreshRecovery({
        status: 401,
        onRefreshToken: undefined,
        headers: new Headers(),
        path: '/client/auth/me',
        retry,
        logError: () => undefined,
        report: () => undefined,
      });
      expect(noHandler).toEqual({ action: 'continue' });

      const nullHandler = await runUnauthorizedTokenRefreshRecovery({
        status: 401,
        onRefreshToken: null,
        headers: new Headers(),
        path: '/client/auth/me',
        retry,
        logError: () => undefined,
        report: () => undefined,
      });
      expect(nullHandler).toEqual({ action: 'continue' });
      expect(retry).not.toHaveBeenCalled();
    });

    it('refreshes once and returns retry_result with refreshed auth applied', async () => {
      const headers = new Headers({ Authorization: 'Bearer stale' });
      const onRefreshToken = vi.fn(async () => 'fresh');
      const retry = vi.fn(async () => 'retry-value');

      const result = await runUnauthorizedTokenRefreshRecovery({
        status: 401,
        onRefreshToken,
        headers,
        path: '/client/auth/me',
        retry,
        logError: () => undefined,
        report: () => undefined,
      });

      expect(result).toEqual({ action: 'retry_result', value: 'retry-value' });
      expect(headers.get('Authorization')).toBe('Bearer fresh');
      expect(onRefreshToken).toHaveBeenCalledTimes(1);
      expect(retry).toHaveBeenCalledTimes(1);
    });

    it('continues without retry when the refreshed token is null or empty', async () => {
      const retry = vi.fn(async () => 'never');
      const headers = new Headers();

      const nullResult = await runUnauthorizedTokenRefreshRecovery({
        status: 401,
        onRefreshToken: async () => null,
        headers,
        path: '/client/auth/me',
        retry,
        logError: () => undefined,
        report: () => undefined,
      });
      expect(nullResult).toEqual({ action: 'continue' });
      expect(retry).not.toHaveBeenCalled();
      expect(headers.has('Authorization')).toBe(false);

      const emptyResult = await runUnauthorizedTokenRefreshRecovery({
        status: 401,
        onRefreshToken: async () => '',
        headers,
        path: '/client/auth/me',
        retry,
        logError: () => undefined,
        report: () => undefined,
      });
      expect(emptyResult).toEqual({ action: 'continue' });
      expect(retry).not.toHaveBeenCalled();
    });

    it('logs and reports the refresh failure, then continues', async () => {
      const refreshError = new Error('refresh-fail');
      const logs: Array<{ prefix: string; err: unknown }> = [];
      const reports: Array<{
        error: Error;
        context: { path: string; context: 'token_refresh' };
      }> = [];

      const result = await runUnauthorizedTokenRefreshRecovery({
        status: 401,
        onRefreshToken: async () => {
          throw refreshError;
        },
        headers: new Headers(),
        path: '/client/auth/me',
        retry: async () => 'never',
        logError: (prefix, err) => logs.push({ prefix, err }),
        report: (error, context) => reports.push({ error, context }),
      });

      expect(result).toEqual({ action: 'continue' });
      expect(logs).toEqual([{ prefix: '[HubClient] Token refresh failed', err: refreshError }]);
      expect(reports).toEqual([
        { error: refreshError, context: { path: '/client/auth/me', context: 'token_refresh' } },
      ]);
    });

    it('logs and reports when the retry attempt itself throws, then continues', async () => {
      const retryError = new Error('retry-boom');
      const logs: Array<{ prefix: string; err: unknown }> = [];
      const reports: Array<{
        error: Error;
        context: { path: string; context: 'token_refresh' };
      }> = [];
      const headers = new Headers();

      const result = await runUnauthorizedTokenRefreshRecovery({
        status: 401,
        onRefreshToken: async () => 'fresh',
        headers,
        path: '/client/auth/me',
        retry: async () => {
          throw retryError;
        },
        logError: (prefix, err) => logs.push({ prefix, err }),
        report: (error, context) => reports.push({ error, context }),
      });

      expect(result).toEqual({ action: 'continue' });
      expect(headers.get('Authorization')).toBe('Bearer fresh');
      expect(logs[0]?.prefix).toBe('[HubClient] Token refresh failed');
      expect(logs[0]?.err).toBe(retryError);
      expect(reports[0]?.context).toEqual({ path: '/client/auth/me', context: 'token_refresh' });
    });
  });

  describe('runHubJsonRequest', () => {
    it('prepares URL/headers from context and parses the primary response', async () => {
      const calls: Array<{
        url: string;
        method: string | undefined;
        auth: string | null;
        contentType: string | null;
      }> = [];
      const fetchImpl: typeof fetch = async (input, init) => {
        const headers = new Headers(init?.headers);
        calls.push({
          url: String(input),
          method: init?.method,
          auth: headers.get('Authorization'),
          contentType: headers.get('Content-Type'),
        });
        return jsonResponse({ ok: true });
      };

      const parsed = await runHubJsonRequest({
        baseUrl: BASE_URL,
        path: '/client/auth/me',
        token: 'tok-1',
        fetchImpl,
        parseSuccess: async (response) => {
          expect(response.status).toBe(200);
          return 'parsed-ok' as const;
        },
      });

      expect(parsed).toBe('parsed-ok');
      expect(calls).toEqual([
        {
          url: `${BASE_URL}/client/auth/me`,
          method: undefined,
          auth: 'Bearer tok-1',
          contentType: 'application/json',
        },
      ]);
    });

    it('refreshes the token and retries once on a 401 primary response', async () => {
      const seenAuth: string[] = [];
      const fetchImpl: typeof fetch = async (_input, init) => {
        const headers = new Headers(init?.headers);
        const auth = headers.get('Authorization');
        seenAuth.push(auth ?? 'none');
        if (auth === 'Bearer fresh') {
          return jsonResponse({ code: 'OK', data: { id: 'u1' } });
        }
        return errorResponse(401, 'unauthorized', 'expired');
      };
      const parseSuccess = vi.fn(async (response: Response) => {
        expect(response.status).toBe(200);
        return (await response.json()) as { code: string; data: unknown };
      });

      const result = await runHubJsonRequest({
        baseUrl: BASE_URL,
        path: '/client/auth/me',
        token: 'stale',
        timeoutMs: 5_000,
        fetchImpl,
        onRefreshToken: async () => 'fresh',
        parseSuccess,
      });

      expect(result).toEqual({ code: 'OK', data: { id: 'u1' } });
      expect(parseSuccess).toHaveBeenCalledTimes(1);
      expect(seenAuth).toEqual(['Bearer stale', 'Bearer fresh']);
    });

    it('parses the original 401 response when no refresh handler is configured', async () => {
      const parseSuccess = vi.fn(async (response: Response) => `status-${response.status}` as const);
      const fetchImpl: typeof fetch = async () => errorResponse(401, 'unauthorized', 'm');

      const result = await runHubJsonRequest({
        baseUrl: BASE_URL,
        path: '/x',
        fetchImpl,
        parseSuccess,
      });

      expect(result).toBe('status-401');
      expect(parseSuccess).toHaveBeenCalledTimes(1);
    });

    it('reports refresh failure through the default sinks and parses the original response', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const parseSuccess = vi.fn(async (response: Response) => `status-${response.status}` as const);
      const fetchImpl: typeof fetch = async () => errorResponse(401, 'unauthorized', 'expired');

      const result = await runHubJsonRequest({
        baseUrl: BASE_URL,
        path: '/x',
        fetchImpl,
        onRefreshToken: async () => {
          throw new Error('refresh-fail');
        },
        parseSuccess,
      });

      expect(result).toBe('status-401');
      expect(parseSuccess).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledWith('[HubClient] Token refresh failed', expect.any(Error));
    });

    it('remaps abort into a TIMEOUT AppError with log+report', async () => {
      vi.useFakeTimers();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const fetchImpl: typeof fetch = (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });

      const request = runHubJsonRequest({
        baseUrl: BASE_URL,
        path: '/web/projects',
        timeoutMs: 5_000,
        fetchImpl,
        parseSuccess: async () => 'never',
      });
      const expectation = expect(request).rejects.toMatchObject({
        name: 'AppError',
        code: 'TIMEOUT',
        status: 0,
        message: 'Request timed out after 5000ms: GET /web/projects',
      });
      await vi.advanceTimersByTimeAsync(5_000);
      await expectation;
      expect(consoleError).toHaveBeenCalled();
    });

    it('remaps fetch TypeErrors into a NETWORK_ERROR AppError', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const fetchImpl: typeof fetch = async () => {
        throw new TypeError('Failed to fetch');
      };

      await expect(
        runHubJsonRequest({
          baseUrl: BASE_URL,
          path: '/x',
          fetchImpl,
          parseSuccess: async () => 'never',
        }),
      ).rejects.toMatchObject({
        name: 'AppError',
        code: 'NETWORK_ERROR',
        status: 0,
        message: 'Network request failed: Failed to fetch',
      });
      expect(consoleError).toHaveBeenCalled();
    });

    it('rethrows AppError instances untouched (report, no [HubClient] log)', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const appError = new AppError({ error: { code: 'X', message: 'm' } }, 500);
      const fetchImpl: typeof fetch = async () => {
        throw appError;
      };

      await expect(
        runHubJsonRequest({
          baseUrl: BASE_URL,
          path: '/x',
          fetchImpl,
          parseSuccess: async () => 'never',
        }),
      ).rejects.toBe(appError);
      expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('[HubClient]'));
    });

    it('rethrows unknown values untouched without logging or reporting', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const fetchImpl: typeof fetch = async () => {
        throw 'plain-string';
      };

      await expect(
        runHubJsonRequest({
          baseUrl: BASE_URL,
          path: '/x',
          fetchImpl,
          parseSuccess: async () => 'never',
        }),
      ).rejects.toBe('plain-string');
      expect(consoleError).not.toHaveBeenCalled();
    });
  });

  describe('runHubMultipartUploadRequest', () => {
    it('builds auth-only headers + POST formData and parses the response', async () => {
      const calls: Array<{
        url: string;
        method: string | undefined;
        body: FormData | null;
        auth: string | null;
        contentType: string | null;
      }> = [];
      const form = new FormData();
      form.set('hash', 'h1');
      const fetchImpl: typeof fetch = async (input, init) => {
        const headers = new Headers(init?.headers);
        calls.push({
          url: String(input),
          method: init?.method,
          body: (init?.body as FormData | null) ?? null,
          auth: headers.get('Authorization'),
          contentType: headers.get('Content-Type'),
        });
        return jsonResponse({ code: 'OK' });
      };

      const parsed = await runHubMultipartUploadRequest({
        baseUrl: BASE_URL,
        path: '/client/attachments',
        formData: form,
        token: 'tok-up',
        timeoutMs: 5_000,
        fetchImpl,
        parseSuccess: async (response) => {
          expect(response.status).toBe(200);
          return 'parsed-up' as const;
        },
      });

      expect(parsed).toBe('parsed-up');
      expect(calls).toEqual([
        {
          url: `${BASE_URL}/client/attachments`,
          method: 'POST',
          body: form,
          auth: 'Bearer tok-up',
          contentType: null,
        },
      ]);
    });

    it('propagates fetch and parse failures without catch remapping', async () => {
      const fetchError = new TypeError('Failed to fetch');
      const throwingFetch: typeof fetch = async () => {
        throw fetchError;
      };
      await expect(
        runHubMultipartUploadRequest({
          baseUrl: BASE_URL,
          path: '/up',
          formData: new FormData(),
          fetchImpl: throwingFetch,
          parseSuccess: async () => 'never',
        }),
      ).rejects.toBe(fetchError);

      const parseError = new AppError({ error: { code: 'X', message: 'm' } }, 400);
      const okFetch: typeof fetch = async () => jsonResponse({ code: 'OK' });
      await expect(
        runHubMultipartUploadRequest({
          baseUrl: BASE_URL,
          path: '/up',
          formData: new FormData(),
          fetchImpl: okFetch,
          parseSuccess: async () => {
            throw parseError;
          },
        }),
      ).rejects.toBe(parseError);
    });

    it('omits Authorization when no token is provided', async () => {
      const seenHeaders: Headers[] = [];
      const fetchImpl: typeof fetch = async (_input, init) => {
        seenHeaders.push(new Headers(init?.headers));
        return jsonResponse({ code: 'OK' });
      };

      await runHubMultipartUploadRequest({
        baseUrl: BASE_URL,
        path: '/up',
        formData: new FormData(),
        fetchImpl,
        parseSuccess: async () => undefined,
      });

      expect(seenHeaders[0]?.has('Authorization')).toBe(false);
    });
  });

  describe('resolveHubClientRuntime', () => {
    it('normalizes the base URL and prefers the injected fetch', () => {
      const injected = (async () => jsonResponse({ code: 'OK' })) as typeof globalThis.fetch;

      const trailing = resolveHubClientRuntime({
        baseUrl: 'https://hub.example.test///',
        fetch: injected,
      });
      expect(trailing.baseUrl).toBe('https://hub.example.test');
      expect(trailing.fetchImpl).toBe(injected);

      const clean = resolveHubClientRuntime({ baseUrl: BASE_URL, fetch: injected });
      expect(clean).toEqual({ baseUrl: BASE_URL, fetchImpl: injected });
    });

    it('falls back to the global fetch binding when none is injected', () => {
      const stubbed = vi.fn(async () => new Response(null, { status: 200 }));
      vi.stubGlobal('fetch', stubbed);

      const runtime = resolveHubClientRuntime({ baseUrl: `${BASE_URL}/` });
      expect(runtime.fetchImpl).toBe(stubbed);
      expect(runtime.baseUrl).toBe(BASE_URL);

      const noBase = resolveHubClientRuntime({});
      expect(noBase.baseUrl).toBe('');
      expect(noBase.fetchImpl).toBe(stubbed);
    });
  });

  describe('runHubClientJsonRequest', () => {
    it('unwraps OK envelope data into the generic result', async () => {
      const fetchImpl: typeof fetch = async () => jsonResponse({ code: 'OK', data: { id: 'u1' } });

      const result = await runHubClientJsonRequest<{ id: string }>({
        baseUrl: BASE_URL,
        path: '/client/auth/me',
        fetchImpl,
      });

      expect(result).toEqual({ id: 'u1' });
    });

    it('maps 204 no-content responses to undefined', async () => {
      const fetchImpl: typeof fetch = async () => new Response(null, { status: 204 });

      const result = await runHubClientJsonRequest<unknown>({
        baseUrl: BASE_URL,
        path: '/x',
        fetchImpl,
      });

      expect(result).toBeUndefined();
    });

    it('throws the parsed AppError for non-OK error bodies', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const fetchImpl: typeof fetch = async () => errorResponse(404, 'NOT_FOUND', 'missing');

      await expect(
        runHubClientJsonRequest({ baseUrl: BASE_URL, path: '/x', fetchImpl }),
      ).rejects.toMatchObject({
        name: 'AppError',
        code: 'NOT_FOUND',
        status: 404,
        message: 'missing',
      });
      expect(consoleError).toHaveBeenCalled();
    });

    it('throws for non-OK envelope codes even with HTTP 200', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const fetchImpl: typeof fetch = async () =>
        jsonResponse({ code: 'DENIED', message: 'boom' }, 200);

      await expect(
        runHubClientJsonRequest({ baseUrl: BASE_URL, path: '/x', fetchImpl }),
      ).rejects.toMatchObject({
        name: 'AppError',
        code: 'DENIED',
        status: 200,
        message: 'boom',
      });
      expect(consoleError).toHaveBeenCalled();
    });

    it('passes through non-envelope JSON bodies', async () => {
      const fetchImpl: typeof fetch = async () => jsonResponse({ plain: 'body' });

      const result = await runHubClientJsonRequest<{ plain: string }>({
        baseUrl: BASE_URL,
        path: '/x',
        fetchImpl,
      });

      expect(result).toEqual({ plain: 'body' });
    });

    it('treats explicit undefined optional args as omitted', async () => {
      const calls: Array<{ url: string; auth: string | null }> = [];
      const fetchImpl: typeof fetch = async (input, init) => {
        const headers = new Headers(init?.headers);
        calls.push({ url: String(input), auth: headers.get('Authorization') });
        return jsonResponse({ code: 'OK', data: 42 });
      };

      const result = await runHubClientJsonRequest<number>({
        baseUrl: BASE_URL,
        path: '/x',
        options: undefined,
        token: undefined,
        timeoutMs: undefined,
        onRefreshToken: undefined,
        fetchImpl,
      });

      expect(result).toBe(42);
      expect(calls).toEqual([{ url: `${BASE_URL}/x`, auth: null }]);
    });
  });

  describe('runHubClientMultipartUploadRequest', () => {
    it('unwraps OK envelope data from a multipart upload', async () => {
      const fetchImpl: typeof fetch = async () => jsonResponse({ code: 'OK', data: { id: 'a1' } });

      const result = await runHubClientMultipartUploadRequest<{ id: string }>({
        baseUrl: BASE_URL,
        path: '/client/attachments',
        formData: new FormData(),
        fetchImpl,
      });

      expect(result).toEqual({ id: 'a1' });
    });

    it('maps 204 upload responses to undefined', async () => {
      const fetchImpl: typeof fetch = async () => new Response(null, { status: 204 });

      const result = await runHubClientMultipartUploadRequest<unknown>({
        baseUrl: BASE_URL,
        path: '/up',
        formData: new FormData(),
        fetchImpl,
      });

      expect(result).toBeUndefined();
    });
  });

  describe('resolveHubClientTransportOptions', () => {
    it('omits optional keys when undefined (minimal transport)', () => {
      const injected = (async () => jsonResponse({ code: 'OK' })) as typeof globalThis.fetch;
      const runtime = resolveHubClientRuntime({ baseUrl: BASE_URL, fetch: injected });

      const minimal = resolveHubClientTransportOptions(runtime, {});
      expect(minimal).toEqual({ baseUrl: BASE_URL, fetchImpl: injected });
      expect(Object.prototype.hasOwnProperty.call(minimal, 'getToken')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(minimal, 'timeoutMs')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(minimal, 'onRefreshToken')).toBe(false);
    });

    it('preserves provided getter/timeout/refresh references and omits explicit undefined', () => {
      const injected = (async () => jsonResponse({ code: 'OK' })) as typeof globalThis.fetch;
      const runtime = resolveHubClientRuntime({ baseUrl: BASE_URL, fetch: injected });
      const getToken = () => 'tok';
      const onRefreshToken = async () => 'fresh';

      const resolved = resolveHubClientTransportOptions(runtime, {
        getToken,
        timeoutMs: 7_000,
        onRefreshToken,
      });
      expect(resolved.getToken).toBe(getToken);
      expect(resolved.timeoutMs).toBe(7_000);
      expect(resolved.onRefreshToken).toBe(onRefreshToken);

      const withExplicitUndefined = resolveHubClientTransportOptions(runtime, {
        getToken: undefined,
        timeoutMs: undefined,
        onRefreshToken: undefined,
      });
      expect(Object.prototype.hasOwnProperty.call(withExplicitUndefined, 'getToken')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(withExplicitUndefined, 'timeoutMs')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(withExplicitUndefined, 'onRefreshToken')).toBe(
        false,
      );
    });
  });

  describe('createHubClientTransport', () => {
    it('request: composes URL, options, token, and envelope parsing', async () => {
      const calls: Array<{ url: string; method?: string; body: unknown; auth: string | null }> = [];
      const fetchImpl: typeof fetch = async (input, init) => {
        const headers = new Headers(init?.headers);
        calls.push({
          url: String(input),
          method: init?.method,
          body: init?.body ?? null,
          auth: headers.get('Authorization'),
        });
        return jsonResponse({ code: 'OK', data: { ok: true } });
      };
      const transport = createHubClientTransport({
        baseUrl: BASE_URL,
        fetchImpl,
        getToken: () => 'tok',
        timeoutMs: 5_000,
      });

      const body = JSON.stringify({ a: 1 });
      const result = await transport.request<{ ok: boolean }>('/client/auth/me', {
        method: 'POST',
        body,
      });

      expect(result).toEqual({ ok: true });
      expect(calls).toEqual([
        { url: `${BASE_URL}/client/auth/me`, method: 'POST', body, auth: 'Bearer tok' },
      ]);
    });

    it('request: omits auth when getToken is not configured', async () => {
      const calls: Array<{ auth: string | null }> = [];
      const fetchImpl: typeof fetch = async (_input, init) => {
        const headers = new Headers(init?.headers);
        calls.push({ auth: headers.get('Authorization') });
        return jsonResponse({ code: 'OK', data: { ok: true } });
      };
      const transport = createHubClientTransport({ baseUrl: BASE_URL, fetchImpl });

      const result = await transport.request<{ ok: boolean }>('/client/auth/me');

      expect(result).toEqual({ ok: true });
      expect(calls).toEqual([{ auth: null }]);
    });

    it('request: getToken returning undefined behaves like no auth', async () => {
      const calls: Array<{ auth: string | null }> = [];
      const fetchImpl: typeof fetch = async (_input, init) => {
        const headers = new Headers(init?.headers);
        calls.push({ auth: headers.get('Authorization') });
        return jsonResponse({ code: 'OK', data: null });
      };
      const transport = createHubClientTransport({
        baseUrl: BASE_URL,
        fetchImpl,
        getToken: () => undefined,
      });

      await transport.request('/x');
      await transport.request('/x');

      expect(calls).toEqual([{ auth: null }, { auth: null }]);
    });

    it('request: applies the shared 30s default timeout when timeoutMs is omitted', async () => {
      vi.useFakeTimers();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const fetchImpl: typeof fetch = (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      const transport = createHubClientTransport({ baseUrl: BASE_URL, fetchImpl });

      const request = transport.request('/client/auth/me');
      const expectation = expect(request).rejects.toMatchObject({
        code: 'TIMEOUT',
        message: 'Request timed out after 30000ms: GET /client/auth/me',
      });
      await vi.advanceTimersByTimeAsync(30_000);
      await expectation;
      expect(consoleError).toHaveBeenCalled();
    });

    it('request: refreshes the token and retries once on a 401 response', async () => {
      const seenAuth: string[] = [];
      const getToken = vi.fn(() => 'stale');
      const onRefreshToken = vi.fn(async () => 'fresh');
      const fetchImpl: typeof fetch = async (_input, init) => {
        const headers = new Headers(init?.headers);
        const auth = headers.get('Authorization');
        seenAuth.push(auth ?? 'none');
        if (auth === 'Bearer fresh') {
          return jsonResponse({ code: 'OK', data: { id: 'u1' } });
        }
        return errorResponse(401, 'unauthorized', 'expired');
      };
      const transport = createHubClientTransport({
        baseUrl: BASE_URL,
        fetchImpl,
        getToken,
        onRefreshToken,
      });

      const result = await transport.request<{ id: string }>('/client/auth/me');

      expect(result).toEqual({ id: 'u1' });
      expect(seenAuth).toEqual(['Bearer stale', 'Bearer fresh']);
      expect(getToken).toHaveBeenCalledTimes(1);
      expect(onRefreshToken).toHaveBeenCalledTimes(1);
    });

    it('requestWithFallback: returns the first successful path', async () => {
      const seen: string[] = [];
      const fetchImpl: typeof fetch = async (input) => {
        seen.push(String(input));
        return jsonResponse({ code: 'OK', data: { id: 'ok' } });
      };
      const transport = createHubClientTransport({ baseUrl: BASE_URL, fetchImpl });

      const result = await transport.requestWithFallback<{ id: string }>(['/a', '/b']);

      expect(result).toEqual({ id: 'ok' });
      expect(seen).toEqual([`${BASE_URL}/a`]);
    });

    it('requestWithFallback: retries the next path after a 404', async () => {
      const seen: string[] = [];
      const fetchImpl: typeof fetch = async (input) => {
        seen.push(String(input));
        if (String(input).endsWith('/first')) {
          return jsonResponse({ code: 'NOT_FOUND', message: 'missing' }, 404);
        }
        return jsonResponse({ code: 'OK', data: { id: 'x' } });
      };
      const transport = createHubClientTransport({ baseUrl: BASE_URL, fetchImpl });

      const result = await transport.requestWithFallback<{ id: string }>(['/first', '/second']);

      expect(result).toEqual({ id: 'x' });
      expect(seen).toEqual([`${BASE_URL}/first`, `${BASE_URL}/second`]);
    });

    it('requestWithFallback: retries the next path after a 405', async () => {
      const seen: string[] = [];
      const fetchImpl: typeof fetch = async (input) => {
        seen.push(String(input));
        if (String(input).endsWith('/first')) {
          return errorResponse(405, 'METHOD_NOT_ALLOWED', 'nope');
        }
        return jsonResponse({ code: 'OK', data: { id: 'x' } });
      };
      const transport = createHubClientTransport({ baseUrl: BASE_URL, fetchImpl });

      const result = await transport.requestWithFallback<{ id: string }>(['/first', '/second']);

      expect(result).toEqual({ id: 'x' });
      expect(seen).toEqual([`${BASE_URL}/first`, `${BASE_URL}/second`]);
    });

    it('requestWithFallback: rethrows non-fallback AppErrors (500) without retrying', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const seen: string[] = [];
      const fetchImpl: typeof fetch = async (input) => {
        seen.push(String(input));
        return errorResponse(500, 'INTERNAL_ERROR', 'boom');
      };
      const transport = createHubClientTransport({ baseUrl: BASE_URL, fetchImpl });

      await expect(transport.requestWithFallback(['/first', '/second'])).rejects.toMatchObject({
        code: 'INTERNAL_ERROR',
        status: 500,
      });
      expect(seen).toEqual([`${BASE_URL}/first`]);
    });

    it('requestWithFallback: rethrows the last fallback error after exhausting paths', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const seen: string[] = [];
      const fetchImpl: typeof fetch = async (input) => {
        seen.push(String(input));
        return jsonResponse({ code: 'NOT_FOUND', message: String(input) }, 404);
      };
      const transport = createHubClientTransport({ baseUrl: BASE_URL, fetchImpl });

      await expect(transport.requestWithFallback(['/a', '/b'])).rejects.toMatchObject({
        status: 404,
        message: `${BASE_URL}/b`,
      });
      expect(seen).toEqual([`${BASE_URL}/a`, `${BASE_URL}/b`]);
    });

    it('requestWithFallback: rethrows network errors immediately', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const seen: string[] = [];
      const fetchImpl: typeof fetch = async (input) => {
        seen.push(String(input));
        throw new TypeError('Failed to fetch');
      };
      const transport = createHubClientTransport({ baseUrl: BASE_URL, fetchImpl });

      await expect(transport.requestWithFallback(['/a', '/b'])).rejects.toMatchObject({
        code: 'NETWORK_ERROR',
      });
      expect(seen).toEqual([`${BASE_URL}/a`]);
    });

    it('requestWithFallback: forwards options to every attempt', async () => {
      const seen: Array<{ method?: string; body?: unknown }> = [];
      const fetchImpl: typeof fetch = async (input, init) => {
        seen.push({ method: init?.method, body: init?.body });
        if (String(input).endsWith('/first')) {
          return jsonResponse({ code: 'NOT_FOUND', message: 'm' }, 404);
        }
        return jsonResponse({ code: 'OK', data: 'done' });
      };
      const transport = createHubClientTransport({ baseUrl: BASE_URL, fetchImpl });

      const body = JSON.stringify({ a: 1 });
      const result = await transport.requestWithFallback<string>(['/first', '/second'], {
        method: 'POST',
        body,
      });

      expect(result).toBe('done');
      expect(seen).toEqual([
        { method: 'POST', body },
        { method: 'POST', body },
      ]);
    });

    it('uploadMultipart: POSTs formData with token auth', async () => {
      const calls: Array<{
        url: string;
        method?: string;
        body: FormData | null;
        auth: string | null;
      }> = [];
      const form = new FormData();
      form.set('hash', 'h1');
      const fetchImpl: typeof fetch = async (input, init) => {
        const headers = new Headers(init?.headers);
        calls.push({
          url: String(input),
          method: init?.method,
          body: (init?.body as FormData | null) ?? null,
          auth: headers.get('Authorization'),
        });
        return jsonResponse({ code: 'OK', data: { id: 'a1' } });
      };
      const transport = createHubClientTransport({
        baseUrl: BASE_URL,
        fetchImpl,
        getToken: () => 'tok-up',
        timeoutMs: 5_000,
      });

      const result = await transport.uploadMultipart<{ id: string }>('/client/attachments', form);

      expect(result).toEqual({ id: 'a1' });
      expect(calls).toEqual([
        { url: `${BASE_URL}/client/attachments`, method: 'POST', body: form, auth: 'Bearer tok-up' },
      ]);
    });

    it('uploadMultipart: omits auth when no getToken is configured', async () => {
      const calls: Array<{ auth: string | null }> = [];
      const fetchImpl: typeof fetch = async (_input, init) => {
        const headers = new Headers(init?.headers);
        calls.push({ auth: headers.get('Authorization') });
        return jsonResponse({ code: 'OK', data: null });
      };
      const transport = createHubClientTransport({ baseUrl: BASE_URL, fetchImpl });

      const result = await transport.uploadMultipart<null>('/client/attachments', new FormData());

      expect(result).toBeNull();
      expect(calls).toEqual([{ auth: null }]);
    });
  });
});
