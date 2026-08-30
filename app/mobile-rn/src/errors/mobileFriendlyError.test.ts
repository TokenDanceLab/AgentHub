import { describe, expect, it } from 'vitest';

import { AppError, HubApiError, HubNetworkError } from '@agenthub/shared/errors';

import {
  categorizeMobileError,
  categoryToStringKey,
  mobileFriendlyErrorMessage,
} from './mobileFriendlyError';

describe('categorizeMobileError', () => {
  it('classifies 401/403 as auth', () => {
    expect(categorizeMobileError(new AppError(
      { error: { code: 'unauthorized', message: 'Unauthorized' } },
      401,
    ))).toBe('auth');

    expect(categorizeMobileError(new AppError(
      { error: { code: 'forbidden', message: 'Forbidden' } },
      403,
    ))).toBe('auth');
  });

  it('classifies 5xx as runtime', () => {
    expect(categorizeMobileError(new AppError(
      { error: { code: 'internal_error', message: 'Internal Server Error' } },
      500,
    ))).toBe('runtime');
  });

  it('classifies network_error code as network', () => {
    expect(categorizeMobileError(new HubNetworkError())).toBe('network');
  });

  it('classifies fetch/network/timeout messages as network', () => {
    expect(categorizeMobileError(new Error('fetch failed'))).toBe('network');
    expect(categorizeMobileError(new Error('network timeout'))).toBe('network');
    expect(categorizeMobileError(new Error('request aborted'))).toBe('network');
  });

  it('classifies auth/unauthorized/token messages as auth', () => {
    expect(categorizeMobileError(new Error('unauthorized access'))).toBe('auth');
    expect(categorizeMobileError(new Error('token expired'))).toBe('auth');
  });

  it('classifies agent/runtime messages as agent', () => {
    expect(categorizeMobileError(new Error('agent crashed'))).toBe('agent');
    expect(categorizeMobileError(new Error('runner not found'))).toBe('agent');
  });

  it('returns unknown for non-Error values', () => {
    expect(categorizeMobileError('string error')).toBe('unknown');
    expect(categorizeMobileError(null)).toBe('unknown');
    expect(categorizeMobileError(undefined)).toBe('unknown');
  });

  it('returns unknown for generic errors', () => {
    expect(categorizeMobileError(new Error('something happened'))).toBe('unknown');
  });
});

describe('mobileFriendlyErrorMessage', () => {
  it('returns fallback for undefined or empty raw', () => {
    expect(mobileFriendlyErrorMessage(undefined, 'fallback')).toBe('fallback');
    expect(mobileFriendlyErrorMessage('', 'fallback')).toBe('fallback');
  });

  it('passes friendly messages through unchanged', () => {
    expect(mobileFriendlyErrorMessage('Please check your connection', 'fallback'))
      .toBe('Please check your connection');
    expect(mobileFriendlyErrorMessage('Session expired, please sign in', 'fallback'))
      .toBe('Session expired, please sign in');
  });

  it('replaces HTTP status lines with fallback', () => {
    expect(mobileFriendlyErrorMessage('HTTP 503 Service Unavailable', 'fallback'))
      .toBe('fallback');
    expect(mobileFriendlyErrorMessage('Request failed: HTTP 500 Internal Server Error', 'fallback'))
      .toBe('fallback');
    expect(mobileFriendlyErrorMessage('http 404 not found', 'fallback'))
      .toBe('fallback');
  });

  it('replaces proxy/timeout internals with fallback', () => {
    expect(mobileFriendlyErrorMessage('proxy connect timeout', 'fallback'))
      .toBe('fallback');
  });

  it('replaces JS error types with fallback', () => {
    expect(mobileFriendlyErrorMessage('TypeError: Cannot read properties of null', 'fallback'))
      .toBe('fallback');
    expect(mobileFriendlyErrorMessage('ReferenceError: x is not defined', 'fallback'))
      .toBe('fallback');
  });

  it('replaces stack frames with fallback', () => {
    expect(mobileFriendlyErrorMessage('at fetchData (client.ts:42:7)', 'fallback'))
      .toBe('fallback');
  });

  it('replaces Node internals with fallback', () => {
    expect(mobileFriendlyErrorMessage('node:internal/errors:496', 'fallback'))
      .toBe('fallback');
  });

  it('replaces messages containing "stack" keyword (matches shared behavior)', () => {
    // "the stack is full" is a user-facing message about a data structure
    expect(mobileFriendlyErrorMessage('the stack is full', 'fallback'))
      .toBe('fallback');
  });
});

describe('categoryToStringKey', () => {
  it('maps each category to the correct string key', () => {
    expect(categoryToStringKey('network')).toBe('genericNetworkError');
    expect(categoryToStringKey('auth')).toBe('genericAuthError');
    expect(categoryToStringKey('agent')).toBe('genericServerError');
    expect(categoryToStringKey('runtime')).toBe('genericServerError');
    expect(categoryToStringKey('unknown')).toBe('genericUnknownError');
  });
});
