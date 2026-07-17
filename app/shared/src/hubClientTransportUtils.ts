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

/** Strip trailing slashes from an optional Hub base URL. */
export function normalizeHubBaseUrl(baseUrl?: string): string {
  return (baseUrl ?? '').replace(/\/+$/, '');
}

/** Resolve request timeout with the shared Hub default. */
export function resolveHubTimeoutMs(timeoutMs?: number): number {
  return timeoutMs ?? DEFAULT_HUB_TIMEOUT_MS;
}

/** Request method used for logging / error reporting (defaults to GET). */
export function requestMethodOf(options: RequestInit): string {
  return options.method ?? 'GET';
}

/** Join a normalized base URL with a Hub path (path includes leading `/`). */
export function buildHubUrl(baseUrl: string, path: string): string {
  return `${baseUrl}${path}`;
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
