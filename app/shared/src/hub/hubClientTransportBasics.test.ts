// real_tested=true — every export exercised directly; the only global mocked is
// `fetch`, stubbed per-test with vi.stubGlobal for the resolveHubFetch lookup path.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors';
import {
  DEFAULT_HUB_TIMEOUT_MS,
  applyBearerAuth,
  applyDefaultJsonContentType,
  applyRefreshedBearerAuth,
  buildHubFetchInit,
  buildHubUrl,
  buildMultipartFetchInit,
  createAuthOnlyHeaders,
  createJsonAuthHeaders,
  createNetworkAppError,
  createTimeoutAppError,
  isAbortError,
  isNetworkFetchTypeError,
  normalizeHubBaseUrl,
  requestMethodOf,
  resolveHubFetch,
  resolveHubTimeoutMs,
  shouldAttemptTokenRefresh,
  toReportableError,
} from './hubClientTransportBasics';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hubClientTransportBasics (#1102)', () => {
  it('exports the shared hub default timeout', () => {
    expect(DEFAULT_HUB_TIMEOUT_MS).toBe(30_000);
  });

  it('classifies abort errors strictly by DOMException instance and name', () => {
    expect(isAbortError(new DOMException('Aborted', 'AbortError'))).toBe(true);
    expect(isAbortError(new DOMException('Some other message', 'AbortError'))).toBe(true);
    expect(isAbortError(new DOMException('Aborted', 'TimeoutError'))).toBe(false);
    expect(isAbortError(new Error('AbortError'))).toBe(false);
    expect(isAbortError({ name: 'AbortError' })).toBe(false);
    expect(isAbortError('AbortError')).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });

  it('classifies network fetch TypeErrors by case-sensitive message substring', () => {
    expect(isNetworkFetchTypeError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkFetchTypeError(new TypeError('network fetch failed'))).toBe(true);
    expect(isNetworkFetchTypeError(new TypeError('connection refused'))).toBe(false);
    // Substring match is case-sensitive: capitalized "Fetch" does not match.
    expect(isNetworkFetchTypeError(new TypeError('Failed to Fetch'))).toBe(false);
    expect(isNetworkFetchTypeError(new Error('Failed to fetch'))).toBe(false);
    expect(isNetworkFetchTypeError('Failed to fetch')).toBe(false);
    expect(isNetworkFetchTypeError(null)).toBe(false);
  });

  it('builds TIMEOUT AppError with status 0 and stable message format', () => {
    const error = createTimeoutAppError({
      timeoutMs: 12_000,
      method: 'POST',
      path: '/web/projects',
    });
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AppError');
    expect(error.code).toBe('TIMEOUT');
    expect(error.status).toBe(0);
    expect(error.message).toBe('Request timed out after 12000ms: POST /web/projects');
    expect(error.rawBody).toEqual({
      error: {
        code: 'TIMEOUT',
        message: 'Request timed out after 12000ms: POST /web/projects',
      },
    });

    const zeroTimeout = createTimeoutAppError({ timeoutMs: 0, method: 'GET', path: '/x' });
    expect(zeroTimeout.message).toBe('Request timed out after 0ms: GET /x');
  });

  it('builds NETWORK_ERROR AppError with status 0 and message prefix', () => {
    const error = createNetworkAppError('Failed to fetch');
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.status).toBe(0);
    expect(error.message).toBe('Network request failed: Failed to fetch');

    const empty = createNetworkAppError('');
    expect(empty.message).toBe('Network request failed: ');
  });

  it('normalizes hub base URLs by stripping trailing slash runs', () => {
    expect(normalizeHubBaseUrl()).toBe('');
    expect(normalizeHubBaseUrl(undefined)).toBe('');
    expect(normalizeHubBaseUrl('')).toBe('');
    expect(normalizeHubBaseUrl('https://hub.example.com')).toBe('https://hub.example.com');
    expect(normalizeHubBaseUrl('https://hub.example.com/')).toBe('https://hub.example.com');
    expect(normalizeHubBaseUrl('https://hub.example.com///')).toBe('https://hub.example.com');
    expect(normalizeHubBaseUrl('https://hub.example.com/api/')).toBe('https://hub.example.com/api');
    expect(normalizeHubBaseUrl('/')).toBe('');
    expect(normalizeHubBaseUrl('///')).toBe('');
  });

  it('resolves timeouts with nullish fallback, preserving 0 and negatives', () => {
    expect(resolveHubTimeoutMs(undefined)).toBe(DEFAULT_HUB_TIMEOUT_MS);
    expect(resolveHubTimeoutMs(0)).toBe(0);
    expect(resolveHubTimeoutMs(5_000)).toBe(5_000);
    expect(resolveHubTimeoutMs(-1)).toBe(-1);
  });

  it('resolves request methods with GET default and no case normalization', () => {
    expect(requestMethodOf({})).toBe('GET');
    expect(requestMethodOf({ method: 'POST' })).toBe('POST');
    expect(requestMethodOf({ method: 'patch' })).toBe('patch');
    expect(requestMethodOf({ method: undefined })).toBe('GET');
  });

  it('joins base URL and path by plain concatenation', () => {
    expect(buildHubUrl('https://hub.example.com', '/web/projects')).toBe(
      'https://hub.example.com/web/projects',
    );
    expect(buildHubUrl('', '/client/auth/me')).toBe('/client/auth/me');
    expect(buildHubUrl('', '')).toBe('');
    // Pure concat: a trailing-slash base yields a double slash — callers normalize first.
    expect(buildHubUrl('https://hub.example.com/', '/x')).toBe('https://hub.example.com//x');
  });

  it('resolves injected fetch or the current global binding', () => {
    const injected = (async () => new Response()) as typeof globalThis.fetch;
    expect(resolveHubFetch(injected)).toBe(injected);

    const stubbed = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', stubbed);
    expect(resolveHubFetch(undefined)).toBe(stubbed);
    expect(resolveHubFetch()).toBe(stubbed);
  });

  it('applies default JSON content-type only when missing, case-insensitively', () => {
    const empty = new Headers();
    applyDefaultJsonContentType(empty);
    expect(empty.get('Content-Type')).toBe('application/json');

    const custom = new Headers({ 'Content-Type': 'text/plain' });
    applyDefaultJsonContentType(custom);
    expect(custom.get('Content-Type')).toBe('text/plain');

    const lowerCase = new Headers({ 'content-type': 'multipart/form-data' });
    applyDefaultJsonContentType(lowerCase);
    expect(lowerCase.get('Content-Type')).toBe('multipart/form-data');
  });

  it('applies Bearer auth only for truthy token when Authorization is unset', () => {
    const headers = new Headers();
    applyBearerAuth(headers, undefined);
    applyBearerAuth(headers, null);
    applyBearerAuth(headers, '');
    expect(headers.has('Authorization')).toBe(false);

    applyBearerAuth(headers, 'tok-1');
    expect(headers.get('Authorization')).toBe('Bearer tok-1');

    // Existing Authorization wins over the provided token.
    applyBearerAuth(headers, 'tok-2');
    expect(headers.get('Authorization')).toBe('Bearer tok-1');

    const prefilled = new Headers({ authorization: 'Bearer custom' });
    applyBearerAuth(prefilled, 'tok-3');
    expect(prefilled.get('Authorization')).toBe('Bearer custom');
  });

  it('force-sets Authorization for a refreshed token', () => {
    const headers = new Headers({ Authorization: 'Bearer stale' });
    applyRefreshedBearerAuth(headers, 'fresh');
    expect(headers.get('Authorization')).toBe('Bearer fresh');

    const empty = new Headers();
    applyRefreshedBearerAuth(empty, 'fresh');
    expect(empty.get('Authorization')).toBe('Bearer fresh');
  });

  it('creates JSON headers preserving caller headers, defaults, and auth', () => {
    const none = createJsonAuthHeaders();
    expect(none.get('Content-Type')).toBe('application/json');
    expect(none.has('Authorization')).toBe(false);

    const headers = createJsonAuthHeaders({ 'X-Test': '1' }, 'tok');
    expect(headers.get('X-Test')).toBe('1');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('Authorization')).toBe('Bearer tok');

    // Caller-supplied Content-Type and Authorization win over defaults.
    const custom = createJsonAuthHeaders(
      { 'Content-Type': 'text/plain', Authorization: 'Bearer custom' },
      'tok',
    );
    expect(custom.get('Content-Type')).toBe('text/plain');
    expect(custom.get('Authorization')).toBe('Bearer custom');

    // HeadersInit array and Headers instance forms are accepted.
    const fromArray = createJsonAuthHeaders([['X-From-Array', 'yes']]);
    expect(fromArray.get('X-From-Array')).toBe('yes');
    expect(fromArray.get('Content-Type')).toBe('application/json');

    const fromHeaders = createJsonAuthHeaders(new Headers({ 'X-From-Headers': 'yes' }), 'tok');
    expect(fromHeaders.get('X-From-Headers')).toBe('yes');
    expect(fromHeaders.get('Authorization')).toBe('Bearer tok');
  });

  it('creates auth-only headers with Bearer and no content-type', () => {
    const headers = createAuthOnlyHeaders('tok-up');
    expect(headers.get('Authorization')).toBe('Bearer tok-up');
    expect(headers.has('Content-Type')).toBe(false);

    const none = createAuthOnlyHeaders();
    expect(Array.from(none.entries())).toHaveLength(0);

    const emptyToken = createAuthOnlyHeaders('');
    expect(emptyToken.has('Authorization')).toBe(false);
  });

  it('builds JSON fetch init by spreading options and overriding headers/signal', () => {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    const controller = new AbortController();
    const init = buildHubFetchInit(
      {
        method: 'PUT',
        body: JSON.stringify({ x: 1 }),
        credentials: 'include',
        headers: { 'X-Old': 'old' },
        signal: new AbortController().signal,
      },
      headers,
      controller.signal,
    );
    expect(init).toEqual({
      method: 'PUT',
      body: JSON.stringify({ x: 1 }),
      credentials: 'include',
      headers,
      signal: controller.signal,
    });
    // Caller options' headers/signal are replaced, not merged.
    expect(init.headers).toBe(headers);
    expect(init.signal).toBe(controller.signal);
  });

  it('builds multipart POST fetch init with form body', () => {
    const headers = createAuthOnlyHeaders('tok-up');
    const form = new FormData();
    form.append('file', new Blob(['hello'], { type: 'text/plain' }), 'hello.txt');
    const controller = new AbortController();
    const init = buildMultipartFetchInit(headers, form, controller.signal);
    expect(init).toEqual({
      method: 'POST',
      headers,
      body: form,
      signal: controller.signal,
    });
    expect(init.body).toBe(form);
  });

  it('decides token-refresh recovery only on 401 with a handler', () => {
    expect(shouldAttemptTokenRefresh(401, true)).toBe(true);
    expect(shouldAttemptTokenRefresh(401, false)).toBe(false);
    expect(shouldAttemptTokenRefresh(403, true)).toBe(false);
    expect(shouldAttemptTokenRefresh(200, true)).toBe(false);
    expect(shouldAttemptTokenRefresh(0, true)).toBe(false);
  });

  it('normalizes unknown catch values into Error instances', () => {
    const error = new Error('boom');
    expect(toReportableError(error)).toBe(error);

    const appError = new AppError({ error: { code: 'X', message: 'm' } }, 403);
    expect(toReportableError(appError)).toBe(appError);

    const fromString = toReportableError('boom');
    expect(fromString).toBeInstanceOf(Error);
    expect(fromString).toMatchObject({ message: 'boom' });

    expect(toReportableError(42)).toMatchObject({ message: '42' });
    expect(toReportableError(null)).toMatchObject({ message: 'null' });
    expect(toReportableError(undefined)).toMatchObject({ message: 'undefined' });
    expect(toReportableError({ code: 'X' })).toMatchObject({ message: '[object Object]' });
  });
});
