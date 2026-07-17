import { describe, expect, it } from 'vitest';
import { AppError } from './errors';
import {
  DEFAULT_HUB_TIMEOUT_MS,
  applyBearerAuth,
  applyDefaultJsonContentType,
  createNetworkAppError,
  createTimeoutAppError,
  isAbortError,
  isNetworkFetchTypeError,
} from './hubClientTransportUtils';

describe('hubClientTransportUtils (#810)', () => {
  it('exports the default hub timeout used by createHubClient', () => {
    expect(DEFAULT_HUB_TIMEOUT_MS).toBe(30_000);
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
