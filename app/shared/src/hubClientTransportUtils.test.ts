import { describe, expect, it } from 'vitest';
import { AppError } from './errors';
import {
  DEFAULT_HUB_TIMEOUT_MS,
  applyBearerAuth,
  applyDefaultHubRequestCatchEffects,
  applyDefaultJsonContentType,
  applyHubRequestCatchEffects,
  applyRefreshedBearerAuth,
  applyTokenRefreshFailureReport,
  buildHubFetchInit,
  buildHubUrl,
  buildMultipartFetchInit,
  buildTokenRefreshFailedLogPrefix,
  buildTokenRefreshReportContext,
  classifyHubRequestCatch,
  createAuthOnlyHeaders,
  createHubAbortTimeout,
  createJsonAuthHeaders,
  createNetworkAppError,
  createTimeoutAppError,
  fetchHubJsonWithTimeout,
  fetchHubMultipartWithTimeout,
  hasTokenRefreshHandler,
  isAbortError,
  isNetworkFetchTypeError,
  normalizeHubBaseUrl,
  planHubRequestCatchEffects,
  planRefreshedTokenRetry,
  planTokenRefreshFailureReport,
  prepareHubRequestContext,
  prepareHubRequestContextFromClient,
  prepareMultipartUploadContext,
  prepareMultipartUploadContextFromClient,
  requestMethodOf,
  resolveHubFetch,
  resolveHubRequestCatch,
  resolveHubTimeoutMs,
  runHubJsonRequest,
  runHubMultipartUploadRequest,
  runUnauthorizedTokenRefreshRecovery,
  shouldAttemptTokenRefresh,
  shouldEnterTokenRefreshRecovery,
  shouldRetryWithRefreshedToken,
  toReportableError,
  withHubAbortTimeout,
} from './hubClientTransportUtils';

describe('hubClientTransportUtils (#810 / #913 / #935 / #957 / #978 / #990 / #1023 / #1044)', () => {
  it('exports the default hub timeout used by createHubClient', () => {
    expect(DEFAULT_HUB_TIMEOUT_MS).toBe(30_000);
  });

  it('normalizes base URL, timeout, method, and hub URL (#913)', () => {
    expect(normalizeHubBaseUrl(undefined)).toBe('');
    expect(normalizeHubBaseUrl('https://hub.example.com/')).toBe('https://hub.example.com');
    expect(normalizeHubBaseUrl('https://hub.example.com///')).toBe('https://hub.example.com');
    expect(resolveHubTimeoutMs(undefined)).toBe(DEFAULT_HUB_TIMEOUT_MS);
    expect(resolveHubTimeoutMs(12_000)).toBe(12_000);
    expect(requestMethodOf({})).toBe('GET');
    expect(requestMethodOf({ method: 'POST' })).toBe('POST');
    expect(buildHubUrl('https://hub.example.com', '/client/auth/me')).toBe(
      'https://hub.example.com/client/auth/me',
    );
  });

  it('resolves fetch, builds fetch inits, and classifies residual transport (#935)', () => {
    const injected = (async () => new Response()) as typeof globalThis.fetch;
    expect(resolveHubFetch(injected)).toBe(injected);
    expect(resolveHubFetch(undefined)).toBe(globalThis.fetch);

    const headers = createJsonAuthHeaders({ 'X-Test': '1' }, 'tok');
    expect(headers.get('X-Test')).toBe('1');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('Authorization')).toBe('Bearer tok');

    const authOnly = createAuthOnlyHeaders('tok-up');
    expect(authOnly.get('Authorization')).toBe('Bearer tok-up');
    expect(authOnly.has('Content-Type')).toBe(false);

    applyRefreshedBearerAuth(headers, 'tok-2');
    expect(headers.get('Authorization')).toBe('Bearer tok-2');

    const controller = new AbortController();
    expect(buildHubFetchInit({ method: 'PUT' }, headers, controller.signal)).toEqual({
      method: 'PUT',
      headers,
      signal: controller.signal,
    });

    const form = new FormData();
    form.append('hash', 'abc');
    expect(buildMultipartFetchInit(authOnly, form, controller.signal)).toEqual({
      method: 'POST',
      headers: authOnly,
      body: form,
      signal: controller.signal,
    });

    expect(shouldAttemptTokenRefresh(401, true)).toBe(true);
    expect(shouldAttemptTokenRefresh(401, false)).toBe(false);
    expect(shouldAttemptTokenRefresh(403, true)).toBe(false);

    expect(toReportableError(new Error('e'))).toMatchObject({ message: 'e' });
    expect(toReportableError('boom')).toMatchObject({ message: 'boom' });

    expect(classifyHubRequestCatch(new DOMException('Aborted', 'AbortError'))).toEqual({
      kind: 'timeout',
    });
    const appErr = new AppError({ error: { code: 'X', message: 'm' } }, 500);
    expect(classifyHubRequestCatch(appErr)).toEqual({ kind: 'app', error: appErr });
    expect(classifyHubRequestCatch(new TypeError('Failed to fetch'))).toEqual({
      kind: 'network',
      message: 'Failed to fetch',
    });
    expect(classifyHubRequestCatch('other')).toEqual({ kind: 'other', error: 'other' });
  });

  it('peels abort timeout, refresh retry, and catch resolution (#957)', async () => {
    expect(shouldRetryWithRefreshedToken('tok')).toBe(true);
    expect(shouldRetryWithRefreshedToken('')).toBe(false);
    expect(shouldRetryWithRefreshedToken(null)).toBe(false);
    expect(shouldRetryWithRefreshedToken(undefined)).toBe(false);

    expect(buildTokenRefreshReportContext('/client/auth/me')).toEqual({
      path: '/client/auth/me',
      context: 'token_refresh',
    });

    const abort = createHubAbortTimeout(30_000);
    expect(abort.signal.aborted).toBe(false);
    abort.clear();

    const ok = await withHubAbortTimeout(30_000, async (signal) => {
      expect(signal.aborted).toBe(false);
      return 42;
    });
    expect(ok).toBe(42);

    await expect(
      withHubAbortTimeout(30_000, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const ctx = { timeoutMs: 5_000, method: 'GET', path: '/web/projects' };
    const timeoutResolved = resolveHubRequestCatch(
      new DOMException('Aborted', 'AbortError'),
      ctx,
    );
    expect(timeoutResolved.kind).toBe('timeout');
    if (timeoutResolved.kind === 'timeout') {
      expect(timeoutResolved.error).toMatchObject({
        code: 'TIMEOUT',
        message: 'Request timed out after 5000ms: GET /web/projects',
      });
      expect(timeoutResolved.logMessage).toContain('[HubClient]');
      expect(timeoutResolved.reportContext).toEqual(ctx);
    }

    const appErr = new AppError({ error: { code: 'X', message: 'm' } }, 403);
    const appResolved = resolveHubRequestCatch(appErr, ctx);
    expect(appResolved).toEqual({
      kind: 'app',
      error: appErr,
      reportContext: { path: ctx.path, method: ctx.method },
    });

    const netResolved = resolveHubRequestCatch(new TypeError('Failed to fetch'), ctx);
    expect(netResolved.kind).toBe('network');
    if (netResolved.kind === 'network') {
      expect(netResolved.error).toMatchObject({ code: 'NETWORK_ERROR' });
      expect(netResolved.logMessage).toContain('Network request failed');
      expect(netResolved.reportContext).toEqual({ path: ctx.path, method: ctx.method });
    }

    expect(resolveHubRequestCatch('other', ctx)).toEqual({ kind: 'other', error: 'other' });
  });

  it('peels request/upload context + catch effect plan (#978)', () => {
    expect(hasTokenRefreshHandler(undefined)).toBe(false);
    expect(hasTokenRefreshHandler(null as unknown as undefined)).toBe(false);
    expect(hasTokenRefreshHandler(async () => 'tok')).toBe(true);
    expect(buildTokenRefreshFailedLogPrefix()).toBe('[HubClient] Token refresh failed');

    const prepared = prepareHubRequestContext({
      baseUrl: 'https://hub.example.com',
      path: '/client/auth/me',
      options: { method: 'POST' },
      token: 'tok-1',
      timeoutMs: 9_000,
    });
    expect(prepared.method).toBe('POST');
    expect(prepared.timeoutMs).toBe(9_000);
    expect(prepared.url).toBe('https://hub.example.com/client/auth/me');
    expect(prepared.headers.get('Authorization')).toBe('Bearer tok-1');
    expect(prepared.headers.get('Content-Type')).toBe('application/json');

    const multipart = prepareMultipartUploadContext({
      baseUrl: 'https://hub.example.com',
      path: '/client/attachments',
      token: 'tok-up',
    });
    expect(multipart.url).toBe('https://hub.example.com/client/attachments');
    expect(multipart.timeoutMs).toBe(DEFAULT_HUB_TIMEOUT_MS);
    expect(multipart.headers.get('Authorization')).toBe('Bearer tok-up');
    expect(multipart.headers.has('Content-Type')).toBe(false);

    const ctx = { timeoutMs: 5_000, method: 'GET', path: '/web/projects' };
    const timeoutEffects = planHubRequestCatchEffects(
      new DOMException('Aborted', 'AbortError'),
      ctx,
    );
    expect(timeoutEffects).toMatchObject({
      logMessage: expect.stringContaining('[HubClient]'),
      report: { context: ctx },
    });
    expect('logMessage' in timeoutEffects).toBe(true);
    expect('report' in timeoutEffects).toBe(true);

    const appErr = new AppError({ error: { code: 'X', message: 'm' } }, 403);
    const appEffects = planHubRequestCatchEffects(appErr, ctx);
    expect(appEffects).toEqual({
      error: appErr,
      report: { error: appErr, context: { path: ctx.path, method: ctx.method } },
    });
    expect('logMessage' in appEffects).toBe(false);

    const netEffects = planHubRequestCatchEffects(new TypeError('Failed to fetch'), ctx);
    expect(netEffects).toMatchObject({
      logMessage: expect.stringContaining('Network request failed'),
      report: { context: { path: ctx.path, method: ctx.method } },
    });
    expect('logMessage' in netEffects).toBe(true);

    const otherEffects = planHubRequestCatchEffects('other', ctx);
    expect(otherEffects).toEqual({ error: 'other' });
    expect('logMessage' in otherEffects).toBe(false);
    expect('report' in otherEffects).toBe(false);
  });

  it('classifies AbortError and network fetch TypeError', () => {
    expect(isAbortError(new DOMException('Aborted', 'AbortError'))).toBe(true);
    expect(isAbortError(new DOMException('Other', 'TimeoutError'))).toBe(false);
    expect(isAbortError(new Error('AbortError'))).toBe(false);

    expect(isNetworkFetchTypeError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkFetchTypeError(new TypeError('network fetch failed'))).toBe(true);
    expect(isNetworkFetchTypeError(new TypeError('boom'))).toBe(false);
    expect(isNetworkFetchTypeError(new Error('fetch failed'))).toBe(false);
  });

  it('builds TIMEOUT and NETWORK_ERROR AppError shapes with stable messages', () => {
    const timeout = createTimeoutAppError({
      timeoutMs: 12_000,
      method: 'POST',
      path: '/web/projects',
    });
    expect(timeout).toBeInstanceOf(AppError);
    expect(timeout).toMatchObject({
      code: 'TIMEOUT',
      status: 0,
      message: 'Request timed out after 12000ms: POST /web/projects',
    });

    const network = createNetworkAppError('Failed to fetch');
    expect(network).toBeInstanceOf(AppError);
    expect(network).toMatchObject({
      code: 'NETWORK_ERROR',
      status: 0,
      message: 'Network request failed: Failed to fetch',
    });
  });

  it('applies default JSON content-type only when missing', () => {
    const headers = new Headers();
    applyDefaultJsonContentType(headers);
    expect(headers.get('Content-Type')).toBe('application/json');

    const custom = new Headers({ 'Content-Type': 'multipart/form-data' });
    applyDefaultJsonContentType(custom);
    expect(custom.get('Content-Type')).toBe('multipart/form-data');
  });

  it('applies Bearer auth only when token is present and Authorization is unset', () => {
    const headers = new Headers();
    applyBearerAuth(headers, null);
    applyBearerAuth(headers, undefined);
    expect(headers.has('Authorization')).toBe(false);

    applyBearerAuth(headers, 'tok-1');
    expect(headers.get('Authorization')).toBe('Bearer tok-1');

    applyBearerAuth(headers, 'tok-2');
    expect(headers.get('Authorization')).toBe('Bearer tok-1');
  });

  it('peels exactOptional client context + refresh residual (#990)', () => {
    // Explicit undefined from optional getters must not materialize as keys.
    const prepared = prepareHubRequestContextFromClient({
      baseUrl: 'https://hub.example.com',
      path: '/client/auth/me',
      options: { method: 'GET' },
      token: undefined,
      timeoutMs: undefined,
    });
    expect(prepared.timeoutMs).toBe(DEFAULT_HUB_TIMEOUT_MS);
    expect(prepared.headers.has('Authorization')).toBe(false);
    expect(prepared.url).toBe('https://hub.example.com/client/auth/me');

    const preparedWith = prepareHubRequestContextFromClient({
      baseUrl: 'https://hub.example.com',
      path: '/client/auth/me',
      options: {},
      token: 'tok-x',
      timeoutMs: 4_000,
    });
    expect(preparedWith.timeoutMs).toBe(4_000);
    expect(preparedWith.headers.get('Authorization')).toBe('Bearer tok-x');

    const multipart = prepareMultipartUploadContextFromClient({
      baseUrl: 'https://hub.example.com',
      path: '/client/attachments',
      token: undefined,
      timeoutMs: undefined,
    });
    expect(multipart.timeoutMs).toBe(DEFAULT_HUB_TIMEOUT_MS);
    expect(multipart.headers.has('Authorization')).toBe(false);

    expect(shouldEnterTokenRefreshRecovery(401, async () => 'tok')).toBe(true);
    expect(shouldEnterTokenRefreshRecovery(401, undefined)).toBe(false);
    expect(shouldEnterTokenRefreshRecovery(403, async () => 'tok')).toBe(false);

    expect(planRefreshedTokenRetry('tok-2')).toEqual({ action: 'retry', token: 'tok-2' });
    expect(planRefreshedTokenRetry(null)).toEqual({ action: 'abort' });
    expect(planRefreshedTokenRetry(undefined)).toEqual({ action: 'abort' });
    expect(planRefreshedTokenRetry('')).toEqual({ action: 'abort' });

    const failure = planTokenRefreshFailureReport('/client/auth/me', 'refresh-boom');
    expect(failure.logPrefix).toBe('[HubClient] Token refresh failed');
    expect(failure.error).toMatchObject({ message: 'refresh-boom' });
    expect(failure.context).toEqual({ path: '/client/auth/me', context: 'token_refresh' });

    const appErr = new AppError({ error: { code: 'X', message: 'm' } }, 403);
    const logs: string[] = [];
    const reports: Array<{ error: AppError; context: Record<string, unknown> }> = [];
    expect(() =>
      applyHubRequestCatchEffects(
        { error: appErr, report: { error: appErr, context: { path: '/p', method: 'GET' } } },
        {
          logError: (message) => logs.push(message),
          report: (error, context) => reports.push({ error, context }),
        },
      ),
    ).toThrow(appErr);
    expect(logs).toEqual([]);
    expect(reports).toEqual([{ error: appErr, context: { path: '/p', method: 'GET' } }]);

    const timeoutEffects = planHubRequestCatchEffects(new DOMException('Aborted', 'AbortError'), {
      timeoutMs: 1_000,
      method: 'POST',
      path: '/x',
    });
    expect(() =>
      applyHubRequestCatchEffects(timeoutEffects, {
        logError: (message) => logs.push(message),
        report: (error, context) => reports.push({ error, context }),
      }),
    ).toThrow();
    expect(logs.some((line) => line.includes('[HubClient]'))).toBe(true);
  });

  it('peels fetch-with-timeout + unauthorized refresh residual (#1023)', async () => {
    const calls: Array<{ url: string; method?: string; hasAuth: boolean; body?: BodyInit | null }> =
      [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(input),
        method: init?.method,
        hasAuth: headers.get('Authorization') === 'Bearer tok-2',
        body: init?.body ?? null,
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const headers = new Headers({ Authorization: 'Bearer tok-1' });
    await fetchHubJsonWithTimeout(
      fetchImpl,
      'https://hub.example.com/client/auth/me',
      5_000,
      { method: 'GET' },
      headers,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://hub.example.com/client/auth/me');
    expect(calls[0]?.method).toBe('GET');

    const formData = new FormData();
    formData.set('hash', 'abc');
    await fetchHubMultipartWithTimeout(
      fetchImpl,
      'https://hub.example.com/client/attachments',
      5_000,
      headers,
      formData,
    );
    expect(calls).toHaveLength(2);
    expect(calls[1]?.method).toBe('POST');
    expect(calls[1]?.body).toBe(formData);

    const logs: Array<{ prefix: string; err: unknown }> = [];
    const reports: Array<{ error: Error; context: { path: string; context: 'token_refresh' } }> =
      [];
    applyTokenRefreshFailureReport(
      planTokenRefreshFailureReport('/client/auth/me', 'refresh-boom'),
      'refresh-boom',
      {
        logError: (prefix, err) => logs.push({ prefix, err }),
        report: (error, context) => reports.push({ error, context }),
      },
    );
    expect(logs).toEqual([
      { prefix: '[HubClient] Token refresh failed', err: 'refresh-boom' },
    ]);
    expect(reports[0]?.context).toEqual({ path: '/client/auth/me', context: 'token_refresh' });

    // non-401 → continue without calling refresh
    const skip = await runUnauthorizedTokenRefreshRecovery({
      status: 200,
      onRefreshToken: async () => 'tok-2',
      headers,
      path: '/client/auth/me',
      retry: async () => 'never',
      logError: () => undefined,
      report: () => undefined,
    });
    expect(skip).toEqual({ action: 'continue' });

    // 401 + refresh → retry_result
    const retried = await runUnauthorizedTokenRefreshRecovery({
      status: 401,
      onRefreshToken: async () => 'tok-2',
      headers,
      path: '/client/auth/me',
      retry: async () => 'ok-retry',
      logError: () => undefined,
      report: () => undefined,
    });
    expect(retried).toEqual({ action: 'retry_result', value: 'ok-retry' });
    expect(headers.get('Authorization')).toBe('Bearer tok-2');

    // 401 + refresh throws → log/report then continue
    const failLogs: Array<{ prefix: string; err: unknown }> = [];
    const failReports: Array<{ error: Error; context: { path: string; context: 'token_refresh' } }> =
      [];
    const failed = await runUnauthorizedTokenRefreshRecovery({
      status: 401,
      onRefreshToken: async () => {
        throw new Error('refresh-fail');
      },
      headers,
      path: '/client/auth/me',
      retry: async () => 'never',
      logError: (prefix, err) => failLogs.push({ prefix, err }),
      report: (error, context) => failReports.push({ error, context }),
    });
    expect(failed).toEqual({ action: 'continue' });
    expect(failLogs[0]?.prefix).toBe('[HubClient] Token refresh failed');
    expect(failReports[0]?.context).toEqual({
      path: '/client/auth/me',
      context: 'token_refresh',
    });

    // 401 + empty token → abort continue (no retry)
    const aborted = await runUnauthorizedTokenRefreshRecovery({
      status: 401,
      onRefreshToken: async () => null,
      headers,
      path: '/client/auth/me',
      retry: async () => 'never',
      logError: () => undefined,
      report: () => undefined,
    });
    expect(aborted).toEqual({ action: 'continue' });

    const defaultErr = new AppError({ error: { code: 'X', message: 'm' } }, 500);
    expect(() =>
      applyDefaultHubRequestCatchEffects(defaultErr, {
        timeoutMs: 1_000,
        method: 'GET',
        path: '/client/auth/me',
      }),
    ).toThrow(defaultErr);
  });

  it('peels full JSON request + multipart upload residual (#1044)', async () => {
    const jsonCalls: Array<{ url: string; auth: string | null }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      jsonCalls.push({
        url: String(input),
        auth: headers.get('Authorization'),
      });
      const status =
        headers.get('Authorization') === 'Bearer fresh' ? 200 : 401;
      return new Response(JSON.stringify({ ok: true, data: { id: 'u1' } }), {
        status,
      });
    };

    // 401 → refresh → retry_result path
    const refreshed = await runHubJsonRequest({
      baseUrl: 'https://hub.example.com',
      path: '/client/auth/me',
      options: { method: 'GET' },
      token: 'stale',
      timeoutMs: 5_000,
      fetchImpl,
      onRefreshToken: async () => 'fresh',
      parseSuccess: async (response) => {
        expect(response.status).toBe(200);
        return (await response.json()) as { ok: boolean };
      },
    });
    expect(refreshed).toEqual({ ok: true, data: { id: 'u1' } });
    expect(jsonCalls.length).toBeGreaterThanOrEqual(2);
    expect(jsonCalls[0]?.auth).toBe('Bearer stale');
    expect(jsonCalls.some((c) => c.auth === 'Bearer fresh')).toBe(true);

    // non-401 primary success
    const okFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 });
    const ok = await runHubJsonRequest({
      baseUrl: 'https://hub.example.com',
      path: '/client/auth/me',
      fetchImpl: okFetch,
      parseSuccess: async (response) => {
        expect(response.status).toBe(200);
        return 'ok' as const;
      },
    });
    expect(ok).toBe('ok');

    // app error catch residual rethrows
    const appErr = new AppError({ error: { code: 'X', message: 'm' } }, 500);
    const boomFetch: typeof fetch = async () => {
      throw appErr;
    };
    await expect(
      runHubJsonRequest({
        baseUrl: 'https://hub.example.com',
        path: '/client/auth/me',
        fetchImpl: boomFetch,
        parseSuccess: async () => 'never',
      }),
    ).rejects.toBe(appErr);

    // multipart peel
    const form = new FormData();
    form.set('hash', 'h1');
    const multiCalls: Array<{ url: string; method?: string }> = [];
    const multiFetch: typeof fetch = async (input, init) => {
      multiCalls.push({ url: String(input), method: init?.method });
      return new Response(JSON.stringify({ ok: true, data: { id: 'a1' } }), {
        status: 200,
      });
    };
    const uploaded = await runHubMultipartUploadRequest({
      baseUrl: 'https://hub.example.com',
      path: '/client/attachments',
      formData: form,
      token: 'tok',
      timeoutMs: 5_000,
      fetchImpl: multiFetch,
      parseSuccess: async () => ({ id: 'a1' }) as const,
    });
    expect(uploaded).toEqual({ id: 'a1' });
    expect(multiCalls).toEqual([
      { url: 'https://hub.example.com/client/attachments', method: 'POST' },
    ]);
  });
});
