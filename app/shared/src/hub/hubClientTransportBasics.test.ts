// real_tested=true
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

describe('DEFAULT_HUB_TIMEOUT_MS', () => {
  it('is the shared 30s hub request timeout', () => {
    expect(DEFAULT_HUB_TIMEOUT_MS).toBe(30_000);
  });
});

describe('isAbortError', () => {
  it('returns true for a DOMException named AbortError', () => {
    expect(isAbortError(new DOMException('Aborted', 'AbortError'))).toBe(true);
  });

  it('returns false for a DOMException with any other name', () => {
    expect(isAbortError(new DOMException('Timed out', 'TimeoutError'))).toBe(false);
    expect(isAbortError(new DOMException('Aborted'))).toBe(false);
  });

  it('returns false for non-DOMException values that merely look like aborts', () => {
    const namedError = new Error('Aborted');
    namedError.name = 'AbortError';
    expect(isAbortError(namedError)).toBe(false);
    expect(isAbortError({ name: 'AbortError' })).toBe(false);
    expect(isAbortError('AbortError')).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });
});

describe('isNetworkFetchTypeError', () => {
  it('returns true for TypeErrors whose message mentions fetch', () => {
    expect(isNetworkFetchTypeError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkFetchTypeError(new TypeError('network fetch failed'))).toBe(true);
  });

  it('returns false for TypeErrors without fetch in the message', () => {
    expect(isNetworkFetchTypeError(new TypeError('boom'))).toBe(false);
    expect(isNetworkFetchTypeError(new TypeError(''))).toBe(false);
  });

  it('returns false for non-TypeError values even when the message mentions fetch', () => {
    expect(isNetworkFetchTypeError(new Error('fetch failed'))).toBe(false);
    expect(isNetworkFetchTypeError('fetch')).toBe(false);
    expect(isNetworkFetchTypeError(null)).toBe(false);
    expect(isNetworkFetchTypeError(undefined)).toBe(false);
  });
});

describe('createTimeoutAppError', () => {
  it('builds a TIMEOUT AppError with status 0 and an interpolated message', () => {
    const error = createTimeoutAppError({
      timeoutMs: 12_000,
      method: 'POST',
      path: '/web/projects',
    });
    expect(error).toBeInstanceOf(AppError);
    expect(error.name).toBe('AppError');
    expect(error.code).toBe('TIMEOUT');
    expect(error.status).toBe(0);
    expect(error.message).toBe('Request timed out after 12000ms: POST /web/projects');
    expect(error.details).toBeUndefined();
  });

  it('interpolates method and path verbatim for GET requests', () => {
    const error = createTimeoutAppError({
      timeoutMs: DEFAULT_HUB_TIMEOUT_MS,
      method: 'GET',
      path: '/client/auth/me',
    });
    expect(error.message).toBe(
      `Request timed out after ${DEFAULT_HUB_TIMEOUT_MS}ms: GET /client/auth/me`,
    );
  });
});

describe('createNetworkAppError', () => {
  it('builds a NETWORK_ERROR AppError with status 0 and a prefixed message', () => {
    const error = createNetworkAppError('Failed to fetch');
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.status).toBe(0);
    expect(error.message).toBe('Network request failed: Failed to fetch');
  });

  it('keeps the prefix even for an empty cause message', () => {
    expect(createNetworkAppError('').message).toBe('Network request failed: ');
  });
});

describe('normalizeHubBaseUrl', () => {
  it('maps undefined and empty input to an empty string', () => {
    expect(normalizeHubBaseUrl(undefined)).toBe('');
    expect(normalizeHubBaseUrl('')).toBe('');
  });

  it('strips one or many trailing slashes', () => {
    expect(normalizeHubBaseUrl('https://hub.example.com/')).toBe('https://hub.example.com');
    expect(normalizeHubBaseUrl('https://hub.example.com///')).toBe('https://hub.example.com');
  });

  it('leaves scheme double slashes and slash-free URLs untouched', () => {
    expect(normalizeHubBaseUrl('https://hub.example.com')).toBe('https://hub.example.com');
    expect(normalizeHubBaseUrl('http://localhost:3000/api')).toBe('http://localhost:3000/api');
  });
});

describe('resolveHubTimeoutMs', () => {
  it('falls back to the shared default when no timeout is given', () => {
    expect(resolveHubTimeoutMs(undefined)).toBe(DEFAULT_HUB_TIMEOUT_MS);
  });

  it('passes through explicit timeouts, including zero', () => {
    expect(resolveHubTimeoutMs(12_000)).toBe(12_000);
    expect(resolveHubTimeoutMs(1)).toBe(1);
    expect(resolveHubTimeoutMs(0)).toBe(0);
  });
});

describe('requestMethodOf', () => {
  it('defaults to GET when the options carry no method', () => {
    expect(requestMethodOf({})).toBe('GET');
    expect(requestMethodOf({ method: undefined })).toBe('GET');
  });

  it('returns the caller-supplied method verbatim', () => {
    expect(requestMethodOf({ method: 'POST' })).toBe('POST');
    expect(requestMethodOf({ method: 'DELETE' })).toBe('DELETE');
  });
});

describe('buildHubUrl', () => {
  it('joins a normalized base URL with a leading-slash path', () => {
    expect(buildHubUrl('https://hub.example.com', '/client/auth/me')).toBe(
      'https://hub.example.com/client/auth/me',
    );
  });

  it('degenerates to the path or the base when the other part is empty', () => {
    expect(buildHubUrl('', '/web/projects')).toBe('/web/projects');
    expect(buildHubUrl('https://hub.example.com', '')).toBe('https://hub.example.com');
  });
});

describe('resolveHubFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the injected fetch implementation when provided', () => {
    const injected = (async () => new Response()) as typeof globalThis.fetch;
    expect(resolveHubFetch(injected)).toBe(injected);
  });

  it('falls back to the global fetch when nothing is injected', () => {
    const stubbedFetch = vi.fn();
    vi.stubGlobal('fetch', stubbedFetch);
    expect(resolveHubFetch(undefined)).toBe(stubbedFetch);
    expect(resolveHubFetch()).toBe(stubbedFetch);
  });
});

describe('applyDefaultJsonContentType', () => {
  it('sets application/json when Content-Type is missing', () => {
    const headers = new Headers();
    applyDefaultJsonContentType(headers);
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('preserves a caller-supplied Content-Type regardless of header-name casing', () => {
    const headers = new Headers({ 'Content-Type': 'multipart/form-data' });
    applyDefaultJsonContentType(headers);
    expect(headers.get('Content-Type')).toBe('multipart/form-data');

    const lowercase = new Headers({ 'content-type': 'text/plain' });
    applyDefaultJsonContentType(lowercase);
    expect(lowercase.get('Content-Type')).toBe('text/plain');
  });
});

describe('applyBearerAuth', () => {
  it('skips null, undefined, and empty tokens', () => {
    const headers = new Headers();
    applyBearerAuth(headers, null);
    applyBearerAuth(headers, undefined);
    applyBearerAuth(headers, '');
    expect(headers.has('Authorization')).toBe(false);
  });

  it('sets a Bearer token when Authorization is unset', () => {
    const headers = new Headers();
    applyBearerAuth(headers, 'tok-1');
    expect(headers.get('Authorization')).toBe('Bearer tok-1');
  });

  it('never overwrites an existing Authorization header', () => {
    const headers = new Headers({ Authorization: 'Bearer existing' });
    applyBearerAuth(headers, 'tok-2');
    expect(headers.get('Authorization')).toBe('Bearer existing');

    const lowercase = new Headers({ authorization: 'Basic abc' });
    applyBearerAuth(lowercase, 'tok-3');
    expect(lowercase.get('Authorization')).toBe('Basic abc');
  });
});

describe('applyRefreshedBearerAuth', () => {
  it('force-sets Authorization when unset', () => {
    const headers = new Headers();
    applyRefreshedBearerAuth(headers, 'tok-fresh');
    expect(headers.get('Authorization')).toBe('Bearer tok-fresh');
  });

  it('overwrites a stale Authorization for the one-shot refresh retry', () => {
    const headers = new Headers({ Authorization: 'Bearer stale' });
    applyRefreshedBearerAuth(headers, 'tok-fresh');
    expect(headers.get('Authorization')).toBe('Bearer tok-fresh');
  });
});

describe('createJsonAuthHeaders', () => {
  it('defaults to JSON content-type and no Authorization without arguments', () => {
    const headers = createJsonAuthHeaders();
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.has('Authorization')).toBe(false);
  });

  it('preserves caller headers from a record and adds content-type + bearer', () => {
    const headers = createJsonAuthHeaders({ 'X-Test': '1' }, 'tok-1');
    expect(headers.get('X-Test')).toBe('1');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('Authorization')).toBe('Bearer tok-1');
  });

  it('accepts header arrays and Headers instances as input', () => {
    const fromPairs = createJsonAuthHeaders([['X-Pair', 'yes']], 'tok-pair');
    expect(fromPairs.get('X-Pair')).toBe('yes');
    expect(fromPairs.get('Authorization')).toBe('Bearer tok-pair');

    const source = new Headers({ 'X-Source': 'yes' });
    const fromHeaders = createJsonAuthHeaders(source, 'tok-src');
    expect(fromHeaders.get('X-Source')).toBe('yes');
    expect(fromHeaders.get('Content-Type')).toBe('application/json');
    expect(source.has('Content-Type')).toBe(false);
  });

  it('keeps caller-supplied Content-Type and Authorization untouched', () => {
    const headers = createJsonAuthHeaders(
      { 'Content-Type': 'text/plain', Authorization: 'Basic abc' },
      'tok-1',
    );
    expect(headers.get('Content-Type')).toBe('text/plain');
    expect(headers.get('Authorization')).toBe('Basic abc');
  });

  it('omits Authorization for null or empty tokens', () => {
    expect(createJsonAuthHeaders(undefined, null).has('Authorization')).toBe(false);
    expect(createJsonAuthHeaders(undefined, '').has('Authorization')).toBe(false);
  });
});

describe('createAuthOnlyHeaders', () => {
  it('carries only the Bearer token and never a Content-Type', () => {
    const headers = createAuthOnlyHeaders('tok-up');
    expect(headers.get('Authorization')).toBe('Bearer tok-up');
    expect(headers.has('Content-Type')).toBe(false);
  });

  it('returns empty headers when no token is available', () => {
    expect(createAuthOnlyHeaders().has('Authorization')).toBe(false);
    expect(createAuthOnlyHeaders(null).has('Authorization')).toBe(false);
  });
});

describe('buildHubFetchInit', () => {
  it('spreads caller options and attaches headers and signal', () => {
    const headers = createJsonAuthHeaders(undefined, 'tok-1');
    const controller = new AbortController();
    const init = buildHubFetchInit({ method: 'PUT', keepalive: true }, headers, controller.signal);
    expect(init).toEqual({
      method: 'PUT',
      keepalive: true,
      headers,
      signal: controller.signal,
    });
  });

  it('lets the explicit headers and signal win over options-provided ones', () => {
    const headers = createJsonAuthHeaders(undefined, 'tok-1');
    const controller = new AbortController();
    const staleController = new AbortController();
    const init = buildHubFetchInit(
      { method: 'POST', headers: { 'X-Stale': '1' }, signal: staleController.signal },
      headers,
      controller.signal,
    );
    expect(init.headers).toBe(headers);
    expect(init.signal).toBe(controller.signal);
  });
});

describe('buildMultipartFetchInit', () => {
  it('composes a fixed POST init around the FormData body', () => {
    const headers = createAuthOnlyHeaders('tok-up');
    const formData = new FormData();
    formData.append('hash', 'abc');
    const controller = new AbortController();
    const init = buildMultipartFetchInit(headers, formData, controller.signal);
    expect(init).toEqual({
      method: 'POST',
      headers,
      body: formData,
      signal: controller.signal,
    });
  });
});

describe('shouldAttemptTokenRefresh', () => {
  it('is true only for a 401 with a refresh handler present', () => {
    expect(shouldAttemptTokenRefresh(401, true)).toBe(true);
  });

  it('is false without a refresh handler or for any non-401 status', () => {
    expect(shouldAttemptTokenRefresh(401, false)).toBe(false);
    expect(shouldAttemptTokenRefresh(403, true)).toBe(false);
    expect(shouldAttemptTokenRefresh(200, true)).toBe(false);
    expect(shouldAttemptTokenRefresh(500, false)).toBe(false);
  });
});

describe('toReportableError', () => {
  it('passes Error instances through with identity preserved', () => {
    const error = new Error('boom');
    expect(toReportableError(error)).toBe(error);

    const appError = new AppError({ error: { code: 'X', message: 'm' } }, 500);
    expect(toReportableError(appError)).toBe(appError);
  });

  it('wraps non-Error values in an Error using String()', () => {
    const fromString = toReportableError('boom');
    expect(fromString).toBeInstanceOf(Error);
    expect(fromString.message).toBe('boom');

    expect(toReportableError(42).message).toBe('42');
    expect(toReportableError(null).message).toBe('null');
    expect(toReportableError(undefined).message).toBe('undefined');
  });
});
