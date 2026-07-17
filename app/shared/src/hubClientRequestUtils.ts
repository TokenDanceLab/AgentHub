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
