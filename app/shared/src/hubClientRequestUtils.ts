/**
 * Hub client pure request helpers (query string, route fallback, device normalize).
 * Extracted from hubClient.ts (#799) — pure helpers only; used by createHubClient.
 * Not re-exported from package index unless needed; keep names stable for hubClient import.
 */

import { AppError } from './errors';
import type { HubRegisterDeviceRequest } from './hubClientDomainTypes';

export function isRouteFallbackError(error: unknown): boolean {
  return error instanceof AppError && (error.status === 404 || error.status === 405);
}

/**
 * Whether requestWithFallback should try the next path after this error.
 * Pure residual of the multi-route 404/405 peel.
 */
export function shouldContinueRouteFallback(
  index: number,
  pathCount: number,
  error: unknown,
): boolean {
  return index < pathCount - 1 && isRouteFallbackError(error);
}

/**
 * Change-password dual-route: primary POST may 404/405 on older hubs → PUT fallback.
 * Pure residual of the changePassword peel (methods differ, so not requestWithFallback).
 */
export function shouldUseChangePasswordFallback(error: unknown): boolean {
  return isRouteFallbackError(error);
}

/**
 * Final unresolved error after requestWithFallback exhausts paths.
 * Pure residual so the loop body stays a thin orchestration peel.
 */
export function unresolvedRouteFallbackError(fallbackError: unknown): unknown {
  return fallbackError;
}

/**
 * Pure residual of requestWithFallback catch branch (#978):
 * continue with this error as fallback, or rethrow it.
 */
export type RouteFallbackStep =
  | { action: 'continue'; fallbackError: unknown }
  | { action: 'throw'; error: unknown };

export function resolveRouteFallbackStep(
  index: number,
  pathCount: number,
  error: unknown,
): RouteFallbackStep {
  if (shouldContinueRouteFallback(index, pathCount, error)) {
    return { action: 'continue', fallbackError: error };
  }
  return { action: 'throw', error };
}

/**
 * Residual orchestration peel for requestWithFallback (#990).
 * Tries each path until one succeeds or a non-fallback error is thrown.
 */
export async function runRequestWithRouteFallback<T>(
  paths: readonly string[],
  request: (path: string, options: RequestInit) => Promise<T>,
  options: RequestInit = {},
): Promise<T> {
  let fallbackError: unknown;

  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index]!;
    try {
      return await request(path, options);
    } catch (error) {
      const step = resolveRouteFallbackStep(index, paths.length, error);
      if (step.action === 'continue') {
        fallbackError = step.fallbackError;
        continue;
      }
      throw step.error;
    }
  }

  throw unresolvedRouteFallbackError(fallbackError);
}

/**
 * Residual dual-route peel for changePassword (#990).
 * Primary POST may 404/405 on older hubs → PUT fallback (methods differ).
 */
export async function runChangePasswordWithFallback(
  request: (path: string, init: RequestInit) => Promise<void>,
  primary: { path: string; init: RequestInit },
  fallback: { path: string; init: RequestInit },
): Promise<void> {
  try {
    return await request(primary.path, primary.init);
  } catch (error) {
    if (shouldUseChangePasswordFallback(error)) {
      return request(fallback.path, fallback.init);
    }
    throw error;
  }
}

// ── Residual pure peels (#1023) ───────────────────────────────────────────────

/**
 * Residual path+init invoker for createHubClient methods that already build
 * `{ path, init }` composites. Keeps method bodies one-liners.
 */
export function invokePathInitRequest<T>(
  request: (path: string, init: RequestInit) => Promise<T>,
  built: { path: string; init: RequestInit },
): Promise<T> {
  return request(built.path, built.init);
}

/**
 * Residual path+formData invoker for multipart upload builders.
 */
export function invokePathFormDataUpload<T>(
  upload: (path: string, formData: FormData) => Promise<T>,
  built: { path: string; formData: FormData },
): Promise<T> {
  return upload(built.path, built.formData);
}

/**
 * Residual dual-route invoker when path list + init are prebuilt.
 * exactOptional-safe: options only forwarded when defined.
 */
export function invokePathsInitRequest<T>(
  requestWithFallback: (
    paths: readonly string[],
    options?: RequestInit,
  ) => Promise<T>,
  paths: readonly string[],
  init?: RequestInit,
): Promise<T> {
  if (init === undefined) {
    return requestWithFallback(paths);
  }
  return requestWithFallback(paths, init);
}

export function normalizeRegisterDeviceRequest(
  body: HubRegisterDeviceRequest,
): HubRegisterDeviceRequest & {
  device_name: string;
  device_type: string;
  capabilities?: Record<string, unknown>;
} {
  const normalized = {
    ...body,
    device_name: body.device_name ?? body.device_id,
    device_type: body.device_type ?? 'desktop',
  };

  if (Array.isArray(body.capabilities)) {
    return {
      ...normalized,
      capabilities: Object.fromEntries(body.capabilities.map((capability) => [capability, true])),
    };
  }

  return normalized as HubRegisterDeviceRequest & {
    device_name: string;
    device_type: string;
    capabilities?: Record<string, unknown>;
  };
}

export function qs(
  params: Record<string, string | number | boolean | undefined | null>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      search.set(key, String(value));
    }
  }
  const value = search.toString();
  return value ? `?${value}` : '';
}
