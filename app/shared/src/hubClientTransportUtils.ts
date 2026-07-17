/**
 * Hub client pure transport helpers (timeout defaults, abort/network classification, headers).
 * Extracted from hubClient.ts (#810) — pure only; control flow stays in createHubClient.
 */

import { AppError } from './errors';

export const DEFAULT_HUB_TIMEOUT_MS = 30_000;

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function isNetworkFetchTypeError(error: unknown): boolean {
  return error instanceof TypeError && error.message.includes('fetch');
}

export function createTimeoutAppError(args: {
  timeoutMs: number;
  method: string;
  path: string;
}): AppError {
  return new AppError(
    {
      error: {
        code: 'TIMEOUT',
        message: `Request timed out after ${args.timeoutMs}ms: ${args.method} ${args.path}`,
      },
    },
    0,
  );
}

export function createNetworkAppError(message: string): AppError {
  return new AppError(
    {
      error: {
        code: 'NETWORK_ERROR',
        message: `Network request failed: ${message}`,
      },
    },
    0,
  );
}

/** Set JSON content-type only when the caller did not supply one. */
export function applyDefaultJsonContentType(headers: Headers): void {
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
}

/** Apply Bearer auth only when a token is present and Authorization is unset. */
export function applyBearerAuth(headers: Headers, token?: string | null): void {
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
}
