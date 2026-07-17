import { describe, expect, it } from 'vitest';
import { AppError } from './errors';
import {
  DEFAULT_HUB_TIMEOUT_MS,
  applyBearerAuth,
  applyDefaultJsonContentType,
  applyRefreshedBearerAuth,
  buildHubFetchInit,
  buildHubUrl,
  buildMultipartFetchInit,
  classifyHubRequestCatch,
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
} from './hubClientTransportUtils';

describe('hubClientTransportUtils (#810 / #913 / #935)', () => {
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
});
