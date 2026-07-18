/**
 * Hub client transport primitives: timeouts, error constructors, URL/headers/fetch init.
 * Peel companion of hubClientTransportUtils (#1102). Pure only; zero behavior change.
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

/** Resolve fetch implementation (injected or global). */
export function resolveHubFetch(
  fetchImpl?: typeof globalThis.fetch,
): typeof globalThis.fetch {
  return fetchImpl ?? globalThis.fetch;
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

/** Force-set Authorization for a one-shot retry after token refresh. */
export function applyRefreshedBearerAuth(headers: Headers, token: string): void {
  headers.set('Authorization', `Bearer ${token}`);
}

/**
 * JSON request headers: preserve caller headers, default Content-Type, optional Bearer.
 */
export function createJsonAuthHeaders(
  initHeaders?: HeadersInit,
  token?: string | null,
): Headers {
  const headers = new Headers(initHeaders);
  applyDefaultJsonContentType(headers);
  applyBearerAuth(headers, token);
  return headers;
}

/**
 * Multipart/upload headers: Bearer only — runtime must set multipart boundary.
 */
export function createAuthOnlyHeaders(token?: string | null): Headers {
  const headers = new Headers();
  applyBearerAuth(headers, token);
  return headers;
}

/** Compose RequestInit for JSON/auth Hub fetches (caller options + headers + signal). */
export function buildHubFetchInit(
  options: RequestInit,
  headers: Headers,
  signal: AbortSignal,
): RequestInit {
  return {
    ...options,
    headers,
    signal,
  };
}

/** Compose RequestInit for multipart POST uploads. */
export function buildMultipartFetchInit(
  headers: Headers,
  formData: FormData,
  signal: AbortSignal,
): RequestInit {
  return {
    method: 'POST',
    headers,
    body: formData,
    signal,
  };
}

/** 401 + refresh handler present → attempt single token-refresh recovery. */
export function shouldAttemptTokenRefresh(
  status: number,
  hasRefreshHandler: boolean,
): boolean {
  return status === 401 && hasRefreshHandler;
}

/** Normalize unknown catch values for reportApiError / console paths. */
export function toReportableError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
