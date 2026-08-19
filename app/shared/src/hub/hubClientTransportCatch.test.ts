// real_tested=true — every export is exercised directly against the real
// AppError / DOMException / Headers implementations. Only side-effect sinks
// are doubled: console.error and globalErrorReporter.report are vi.spyOn'd
// for the default-effects path, and timers are faked (vi.useFakeTimers) for
// abort-timeout behavior. No fetch stub is needed: this module never
// resolves fetch.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError, globalErrorReporter } from '../errors';
import {
  applyDefaultHubRequestCatchEffects,
  applyHubRequestCatchEffects,
  applyTokenRefreshFailureReport,
  buildTokenRefreshFailedLogPrefix,
  buildTokenRefreshReportContext,
  classifyHubRequestCatch,
  createHubAbortTimeout,
  hasTokenRefreshHandler,
  planHubRequestCatchEffects,
  planRefreshedTokenRetry,
  planTokenRefreshFailureReport,
  prepareHubRequestContext,
  prepareHubRequestContextFromClient,
  prepareMultipartUploadContext,
  prepareMultipartUploadContextFromClient,
  resolveHubRequestCatch,
  shouldEnterTokenRefreshRecovery,
  shouldRetryWithRefreshedToken,
  withHubAbortTimeout,
} from './hubClientTransportCatch';

const CATCH_CONTEXT = {
  timeoutMs: 12_000,
  method: 'POST',
  path: '/web/projects',
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('hubClientTransportCatch (#1102)', () => {
  it('classifies AbortError DOMExceptions as timeout catches', () => {
    const abort = new DOMException('Aborted', 'AbortError');
    expect(classifyHubRequestCatch(abort)).toEqual({ kind: 'timeout' });
    expect(classifyHubRequestCatch(new DOMException('other reason', 'AbortError'))).toEqual({
      kind: 'timeout',
    });
    // Non-AbortError DOMExceptions fall through to other.
    expect(classifyHubRequestCatch(new DOMException('late', 'TimeoutError')).kind).toBe(
      'other',
    );
  });

  it('classifies AppError instances as app catches', () => {
    const appError = new AppError({ error: { code: 'UNAUTHORIZED', message: 'nope' } }, 401);
    const classified = classifyHubRequestCatch(appError);
    expect(classified.kind).toBe('app');
    if (classified.kind === 'app') {
      expect(classified.error).toBe(appError);
    }
  });

  it('classifies fetch TypeErrors as network catches with their message', () => {
    const fetchError = new TypeError('Failed to fetch');
    const classified = classifyHubRequestCatch(fetchError);
    expect(classified.kind).toBe('network');
    if (classified.kind === 'network') {
      expect(classified.message).toBe('Failed to fetch');
    }
    const second = classifyHubRequestCatch(new TypeError('network fetch failed'));
    expect(second.kind).toBe('network');
    if (second.kind === 'network') {
      expect(second.message).toBe('network fetch failed');
    }
    // TypeErrors without the fetch marker fall through to other.
    expect(classifyHubRequestCatch(new TypeError('connection refused')).kind).toBe('other');
  });

  it('classifies everything else as other catches', () => {
    const boom = new Error('boom');
    const values: unknown[] = [boom, 'boom', null, undefined, { code: 'X' }];
    for (const value of values) {
      const classified = classifyHubRequestCatch(value);
      expect(classified.kind).toBe('other');
      if (classified.kind === 'other') {
        expect(classified.error).toBe(value);
      }
    }
  });

  it('fires the abort signal on the timer and skips it when cleared', () => {
    vi.useFakeTimers();

    const cleared = createHubAbortTimeout(250);
    expect(cleared.signal.aborted).toBe(false);
    cleared.clear();
    vi.advanceTimersByTime(10_000);
    expect(cleared.signal.aborted).toBe(false);

    const fired = createHubAbortTimeout(250);
    expect(fired.signal.aborted).toBe(false);
    vi.advanceTimersByTime(250);
    expect(fired.signal.aborted).toBe(true);
  });

  it('runs withHubAbortTimeout and returns the run result on success', async () => {
    vi.useFakeTimers();

    let seenSignal: AbortSignal | undefined;
    await expect(
      withHubAbortTimeout(100, async (signal) => {
        seenSignal = signal;
        return 'done';
      }),
    ).resolves.toBe('done');
    expect(seenSignal?.aborted).toBe(false);
    // The abort timer is cleared after a successful settle.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the abort timer and rethrows when the run rejects', async () => {
    vi.useFakeTimers();

    const boom = new Error('boom');
    await expect(
      withHubAbortTimeout(100, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts the run through the timeout signal when it elapses', async () => {
    vi.useFakeTimers();

    const abortError = new DOMException('Aborted', 'AbortError');
    let seenSignal: AbortSignal | undefined;
    const pending = withHubAbortTimeout(150, (signal) => {
      seenSignal = signal;
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(abortError));
      });
    });
    const rejection = expect(pending).rejects.toBe(abortError);
    await vi.advanceTimersByTimeAsync(150);
    await rejection;
    expect(seenSignal?.aborted).toBe(true);
  });

  it('guards retryable refreshed tokens by truthiness', () => {
    const maybeToken: string | null | undefined = 'fresh-tok';
    if (shouldRetryWithRefreshedToken(maybeToken)) {
      expect(maybeToken.toUpperCase()).toBe('FRESH-TOK');
    }
    expect(shouldRetryWithRefreshedToken('fresh-tok')).toBe(true);
    expect(shouldRetryWithRefreshedToken('')).toBe(false);
    expect(shouldRetryWithRefreshedToken(null)).toBe(false);
    expect(shouldRetryWithRefreshedToken(undefined)).toBe(false);
  });

  it('builds token-refresh report context with a fixed context tag', () => {
    expect(buildTokenRefreshReportContext('/web/projects')).toEqual({
      path: '/web/projects',
      context: 'token_refresh',
    });
    expect(buildTokenRefreshFailedLogPrefix()).toBe('[HubClient] Token refresh failed');
  });

  it('resolves timeout catches into TIMEOUT AppError plus log and report context', () => {
    const resolution = resolveHubRequestCatch(
      new DOMException('Aborted', 'AbortError'),
      CATCH_CONTEXT,
    );
    expect(resolution.kind).toBe('timeout');
    if (resolution.kind === 'timeout') {
      expect(resolution.error).toBeInstanceOf(AppError);
      expect(resolution.error.code).toBe('TIMEOUT');
      expect(resolution.error.status).toBe(0);
      expect(resolution.error.message).toBe(
        'Request timed out after 12000ms: POST /web/projects',
      );
      expect(resolution.logMessage).toBe(
        '[HubClient] Request timed out after 12000ms: POST /web/projects',
      );
      expect(resolution.reportContext).toEqual({
        path: '/web/projects',
        method: 'POST',
        timeoutMs: 12_000,
      });
    }
  });

  it('resolves app catches into the original AppError plus report context', () => {
    const appError = new AppError({ error: { code: 'UNAUTHORIZED', message: 'nope' } }, 401);
    const resolution = resolveHubRequestCatch(appError, CATCH_CONTEXT);
    expect(resolution.kind).toBe('app');
    if (resolution.kind === 'app') {
      expect(resolution.error).toBe(appError);
      // No timeoutMs in the app report context.
      expect(resolution.reportContext).toEqual({ path: '/web/projects', method: 'POST' });
    }
  });

  it('resolves network catches into NETWORK_ERROR AppError plus log and report context', () => {
    const resolution = resolveHubRequestCatch(new TypeError('Failed to fetch'), CATCH_CONTEXT);
    expect(resolution.kind).toBe('network');
    if (resolution.kind === 'network') {
      expect(resolution.error).toBeInstanceOf(AppError);
      expect(resolution.error.code).toBe('NETWORK_ERROR');
      expect(resolution.error.status).toBe(0);
      expect(resolution.error.message).toBe('Network request failed: Failed to fetch');
      expect(resolution.logMessage).toBe(
        '[HubClient] Network request failed: Failed to fetch',
      );
      expect(resolution.reportContext).toEqual({ path: '/web/projects', method: 'POST' });
    }
  });

  it('resolves other catches into a bare other payload', () => {
    const boom = new Error('boom');
    expect(resolveHubRequestCatch(boom, CATCH_CONTEXT)).toEqual({ kind: 'other', error: boom });
  });

  it('assembles JSON request context with headers, auth, timeout, method, and url', () => {
    const context = prepareHubRequestContext({
      baseUrl: 'https://hub.example.com',
      path: '/web/projects',
      options: { method: 'POST', headers: { 'X-Test': '1' } },
      token: 'tok-1',
      timeoutMs: 5_000,
    });
    expect(context.url).toBe('https://hub.example.com/web/projects');
    expect(context.method).toBe('POST');
    expect(context.timeoutMs).toBe(5_000);
    expect(context.headers.get('Content-Type')).toBe('application/json');
    expect(context.headers.get('Authorization')).toBe('Bearer tok-1');
    expect(context.headers.get('X-Test')).toBe('1');
  });

  it('defaults JSON request method and timeout and skips auth without a token', () => {
    const context = prepareHubRequestContext({
      baseUrl: '',
      path: '/client/auth/me',
      options: {},
    });
    expect(context.method).toBe('GET');
    expect(context.timeoutMs).toBe(30_000);
    expect(context.url).toBe('/client/auth/me');
    expect(context.headers.get('Content-Type')).toBe('application/json');
    expect(context.headers.has('Authorization')).toBe(false);

    const nullTokenContext = prepareHubRequestContext({
      baseUrl: '',
      path: '/x',
      options: {},
      token: null,
    });
    expect(nullTokenContext.headers.has('Authorization')).toBe(false);
  });

  it('assembles multipart upload context with auth-only headers', () => {
    const context = prepareMultipartUploadContext({
      baseUrl: 'https://hub.example.com',
      path: '/web/uploads',
      token: 'tok-up',
      timeoutMs: 9_000,
    });
    expect(context.url).toBe('https://hub.example.com/web/uploads');
    expect(context.timeoutMs).toBe(9_000);
    expect(context.headers.get('Authorization')).toBe('Bearer tok-up');
    expect(context.headers.has('Content-Type')).toBe(false);

    const defaults = prepareMultipartUploadContext({ baseUrl: '', path: '/u' });
    expect(defaults.timeoutMs).toBe(30_000);
    expect(defaults.headers.has('Authorization')).toBe(false);
  });

  it('omits explicit-undefined token and timeout in the fromClient wrappers', () => {
    const json = prepareHubRequestContextFromClient({
      baseUrl: 'https://hub.example.com',
      path: '/web/projects',
      options: {},
      token: undefined,
      timeoutMs: undefined,
    });
    expect(json.headers.has('Authorization')).toBe(false);
    expect(json.timeoutMs).toBe(30_000);

    const multipart = prepareMultipartUploadContextFromClient({
      baseUrl: 'https://hub.example.com',
      path: '/web/uploads',
      token: undefined,
      timeoutMs: undefined,
    });
    expect(multipart.headers.has('Authorization')).toBe(false);
    expect(multipart.timeoutMs).toBe(30_000);

    const jsonTokenContext = prepareHubRequestContextFromClient({
      baseUrl: '',
      path: '/x',
      options: {},
      token: 'tok-2',
      timeoutMs: 1_000,
    });
    expect(jsonTokenContext.headers.get('Authorization')).toBe('Bearer tok-2');
    expect(jsonTokenContext.timeoutMs).toBe(1_000);

    const multipartTokenContext = prepareMultipartUploadContextFromClient({
      baseUrl: '',
      path: '/x',
      token: 'tok-3',
      timeoutMs: 2_000,
    });
    expect(multipartTokenContext.headers.get('Authorization')).toBe('Bearer tok-3');
    expect(multipartTokenContext.timeoutMs).toBe(2_000);
  });

  it('detects onRefreshToken handler presence', () => {
    const handler = (): Promise<string | null> => Promise.resolve(null);
    expect(hasTokenRefreshHandler(handler)).toBe(true);
    expect(hasTokenRefreshHandler(undefined)).toBe(false);
    expect(hasTokenRefreshHandler(null)).toBe(false);
    expect(hasTokenRefreshHandler()).toBe(false);
  });

  it('enters token-refresh recovery only on 401 with a handler', () => {
    const handler = (): Promise<string | null> => Promise.resolve('tok');
    expect(shouldEnterTokenRefreshRecovery(401, handler)).toBe(true);
    expect(shouldEnterTokenRefreshRecovery(401, undefined)).toBe(false);
    expect(shouldEnterTokenRefreshRecovery(401, null)).toBe(false);
    expect(shouldEnterTokenRefreshRecovery(403, handler)).toBe(false);
    expect(shouldEnterTokenRefreshRecovery(200, handler)).toBe(false);
    expect(shouldEnterTokenRefreshRecovery(0, handler)).toBe(false);
  });

  it('plans a single retry with the refreshed token or aborts', () => {
    expect(planRefreshedTokenRetry('new-tok')).toEqual({ action: 'retry', token: 'new-tok' });
    expect(planRefreshedTokenRetry(null)).toEqual({ action: 'abort' });
    expect(planRefreshedTokenRetry(undefined)).toEqual({ action: 'abort' });
    expect(planRefreshedTokenRetry('')).toEqual({ action: 'abort' });

    const plan = planRefreshedTokenRetry('narrow-me');
    if (plan.action === 'retry') {
      expect(plan.token.toUpperCase()).toBe('NARROW-ME');
    }
  });

  it('plans token-refresh failure report with a normalized error', () => {
    const plan = planTokenRefreshFailureReport('/web/projects', 'raw-failure');
    expect(plan.logPrefix).toBe('[HubClient] Token refresh failed');
    expect(plan.context).toEqual({ path: '/web/projects', context: 'token_refresh' });
    expect(plan.error).toBeInstanceOf(Error);
    expect(plan.error.message).toBe('raw-failure');

    const original = new Error('already-error');
    const identityPlan = planTokenRefreshFailureReport('/x', original);
    expect(identityPlan.error).toBe(original);
  });

  it('plans timeout catch effects with log message and report', () => {
    const effects = planHubRequestCatchEffects(
      new DOMException('Aborted', 'AbortError'),
      CATCH_CONTEXT,
    );
    expect(effects.error).toBeInstanceOf(AppError);
    if ('logMessage' in effects) {
      expect(effects.logMessage).toBe(
        '[HubClient] Request timed out after 12000ms: POST /web/projects',
      );
      expect(effects.report.error).toBe(effects.error);
      expect(effects.report.context).toEqual({
        path: '/web/projects',
        method: 'POST',
        timeoutMs: 12_000,
      });
    }
  });

  it('plans network catch effects with log message and report', () => {
    const effects = planHubRequestCatchEffects(new TypeError('Failed to fetch'), CATCH_CONTEXT);
    expect(effects.error).toBeInstanceOf(AppError);
    if ('logMessage' in effects) {
      expect(effects.logMessage).toBe('[HubClient] Network request failed: Failed to fetch');
      expect(effects.report.error).toBe(effects.error);
      expect(effects.report.context).toEqual({ path: '/web/projects', method: 'POST' });
    }
  });

  it('plans app catch effects with report but no log message', () => {
    const appError = new AppError({ error: { code: 'FORBIDDEN', message: 'no' } }, 403);
    const effects = planHubRequestCatchEffects(appError, CATCH_CONTEXT);
    expect('logMessage' in effects).toBe(false);
    expect(effects.error).toBe(appError);
    if ('report' in effects) {
      expect(effects.report.error).toBe(appError);
      expect(effects.report.context).toEqual({ path: '/web/projects', method: 'POST' });
    }
  });

  it('plans other catch effects as a bare error', () => {
    expect(planHubRequestCatchEffects('plain-string', CATCH_CONTEXT)).toEqual({
      error: 'plain-string',
    });
  });

  it('logs and reports timeout effects, then rethrows the AppError', () => {
    const logError = vi.fn();
    const report = vi.fn();
    const effects = planHubRequestCatchEffects(
      new DOMException('Aborted', 'AbortError'),
      CATCH_CONTEXT,
    );

    let thrown: unknown;
    try {
      applyHubRequestCatchEffects(effects, { logError, report });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(effects.error);
    expect(logError).toHaveBeenCalledTimes(1);
    if ('logMessage' in effects) {
      expect(logError).toHaveBeenCalledWith(effects.logMessage);
      expect(report).toHaveBeenCalledTimes(1);
      expect(report).toHaveBeenCalledWith(effects.error, effects.report.context);
    }
  });

  it('reports app effects without logging, then rethrows', () => {
    const logError = vi.fn();
    const report = vi.fn();
    const appError = new AppError({ error: { code: 'FORBIDDEN', message: 'no' } }, 403);
    const effects = planHubRequestCatchEffects(appError, CATCH_CONTEXT);

    let thrown: unknown;
    try {
      applyHubRequestCatchEffects(effects, { logError, report });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(appError);
    expect(logError).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(appError, { path: '/web/projects', method: 'POST' });
  });

  it('rethrows other effects raw without side effects', () => {
    const logError = vi.fn();
    const report = vi.fn();

    let thrown: unknown;
    try {
      applyHubRequestCatchEffects({ error: 'boom' }, { logError, report });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe('boom');
    expect(logError).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it('applies token-refresh failure report through injected sinks', () => {
    const logError = vi.fn();
    const report = vi.fn();
    const plan = planTokenRefreshFailureReport('/web/projects', 'raw-failure');

    applyTokenRefreshFailureReport(plan, 'raw-failure', { logError, report });
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith('[HubClient] Token refresh failed', 'raw-failure');
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(plan.error, {
      path: '/web/projects',
      context: 'token_refresh',
    });
  });

  it('plans timeout effects through reportApiError and rethrows the AppError', () => {
    const reportSpy = vi.spyOn(globalErrorReporter, 'report');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let thrown: unknown;
    try {
      applyDefaultHubRequestCatchEffects(
        new DOMException('Aborted', 'AbortError'),
        CATCH_CONTEXT,
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe('TIMEOUT');
    expect(reportSpy).toHaveBeenCalledTimes(1);
    expect(reportSpy.mock.calls[0]?.[0]).toBeInstanceOf(AppError);
    expect(reportSpy.mock.calls[0]?.[1]).toEqual({
      path: '/web/projects',
      method: 'POST',
      timeoutMs: 12_000,
    });
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('plans app effects through reportApiError and rethrows the original AppError', () => {
    const reportSpy = vi.spyOn(globalErrorReporter, 'report');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const appError = new AppError({ error: { code: 'FORBIDDEN', message: 'no' } }, 403);

    let thrown: unknown;
    try {
      applyDefaultHubRequestCatchEffects(appError, CATCH_CONTEXT);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(appError);
    expect(reportSpy).toHaveBeenCalledTimes(1);
    expect(reportSpy.mock.calls[0]?.[0]).toBe(appError);
    expect(reportSpy.mock.calls[0]?.[1]).toEqual({ path: '/web/projects', method: 'POST' });
    expect(consoleSpy.mock.calls[0]?.[0]).toContain('[API] FORBIDDEN');
  });

  it('plans network effects through reportApiError and rethrows a NETWORK_ERROR AppError', () => {
    const reportSpy = vi.spyOn(globalErrorReporter, 'report');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let thrown: unknown;
    try {
      applyDefaultHubRequestCatchEffects(new TypeError('Failed to fetch'), CATCH_CONTEXT);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe('NETWORK_ERROR');
    expect(reportSpy).toHaveBeenCalledTimes(1);
    expect(reportSpy.mock.calls[0]?.[0]).toBeInstanceOf(AppError);
    expect(reportSpy.mock.calls[0]?.[1]).toEqual({ path: '/web/projects', method: 'POST' });
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('rethrows non-AppError catches without logging or reporting', () => {
    const reportSpy = vi.spyOn(globalErrorReporter, 'report');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let thrown: unknown;
    try {
      applyDefaultHubRequestCatchEffects('plain-string', CATCH_CONTEXT);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe('plain-string');
    expect(reportSpy).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
