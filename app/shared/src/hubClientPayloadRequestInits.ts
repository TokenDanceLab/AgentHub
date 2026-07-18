/**
 * Hub client pure path+init request builders (domain companion).
 * Peel of hubClientPayloadRequests (#1101). Pure only; zero behavior change.
 */

import { buildOptionalJsonBody } from './hubClientPayloadBodies';
import {
  buildChangePasswordFallbackPath,
  buildChangePasswordPath,
} from './hubClientPayloadPaths';

export function buildJsonPostInit(body: unknown): { method: 'POST'; body: string } {
  return { method: 'POST', body: JSON.stringify(body) };
}

export function buildJsonPutInit(body: unknown): { method: 'PUT'; body: string } {
  return { method: 'PUT', body: JSON.stringify(body) };
}

export function buildJsonPatchInit(body: unknown): { method: 'PATCH'; body: string } {
  return { method: 'PATCH', body: JSON.stringify(body) };
}

export function buildJsonDeleteInit(body: unknown): { method: 'DELETE'; body: string } {
  return { method: 'DELETE', body: JSON.stringify(body) };
}

export function buildPostInit(): { method: 'POST' } {
  return { method: 'POST' };
}

export function buildDeleteInit(): { method: 'DELETE' } {
  return { method: 'DELETE' };
}

export function buildPutInit(): { method: 'PUT' } {
  return { method: 'PUT' };
}

/**
 * POST RequestInit with optional JSON body key (exactOptional-safe).
 * Omits `body` entirely when payload is undefined.
 */
export function buildPostWithOptionalJsonBody(
  payload: unknown | undefined,
): { method: 'POST' } | { method: 'POST'; body: string } {
  return {
    ...buildPostInit(),
    ...buildOptionalJsonBody(payload),
  };
}

/** Primary change-password attempt (POST /change-password). */
export function buildChangePasswordPrimary(
  body: unknown,
): { path: string; init: { method: 'POST'; body: string } } {
  return {
    path: buildChangePasswordPath(),
    init: buildJsonPostInit(body),
  };
}

/** Fallback change-password attempt (PUT /password) for older hubs. */
export function buildChangePasswordFallback(
  body: unknown,
): { path: string; init: { method: 'PUT'; body: string } } {
  return {
    path: buildChangePasswordFallbackPath(),
    init: buildJsonPutInit(body),
  };
}

// ── Composite path+init residual (#978) ───────────────────────────────────────

export type HubJsonPathInit = {
  path: string;
  init: { method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body: string };
};

export type HubMethodPathInit = {
  path: string;
  init: { method: 'POST' } | { method: 'POST'; body: string } | { method: 'DELETE' };
};

