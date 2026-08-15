/**
 * Hub response envelope / error runtime helpers.
 * Extracted from hubClient.ts (#799) — pure runtime only; re-exported by hubClient.
 * Keep public names stable for web/desktop imports via @shared/hub/hubClient.
 */

import { AppError, isErrorResponse } from '../errors';
import type { HubResponseEnvelope } from './hubClientDomainTypes';

export class HubError extends AppError {
  constructor(status: number, message: string, code = 'hub_error') {
    super({ error: { code, message } }, status);
    this.name = 'HubError';
  }
}

export function isHubResponseEnvelope(
  body: unknown,
): body is HubResponseEnvelope {
  return isRecord(body) && typeof body.code === 'string';
}

export function isHubSuccessCode(code: string): boolean {
  return String(code).toUpperCase() === 'OK';
}

export function unwrapHubResponse<T>(body: unknown, status = 200): T {
  if (!isHubResponseEnvelope(body)) {
    return body as T;
  }

  // Accept case-insensitive OK/ok so fixtures and legacy mocks stay compatible.
  if (!isHubSuccessCode(body.code)) {
    throw new AppError(
      {
        error: {
          code: body.code,
          message: body.message || 'Hub request failed',
        },
      },
      status,
      body,
    );
  }

  return body.data as T;
}

export async function parseHubError(response: Response): Promise<AppError> {
  const body = await readJson(response);
  if (isErrorResponse(body)) {
    return new AppError(body, response.status, body);
  }
  if (isHubResponseEnvelope(body)) {
    return new AppError(
      {
        error: {
          code: body.code || 'HUB_ERROR',
          message:
            body.message ||
            response.statusText ||
            `HTTP ${response.status}`,
        },
      },
      response.status,
      body,
    );
  }
  if (isRecord(body) && typeof body.message === 'string') {
    return new AppError(
      {
        error: {
          code: text(body.code) ?? 'HUB_ERROR',
          message: body.message,
        },
      },
      response.status,
      body,
    );
  }

  return new AppError(
    {
      error: {
        code: response.status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST',
        message: response.statusText || `HTTP ${response.status}`,
      },
    },
    response.status,
    body,
  );
}

/** Package-private helper for createHubClient request/upload paths. */
export async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * Shared success-path response peel for request/upload/retry.
 * Throws parseHubError on non-OK; maps 204 → undefined; otherwise unwraps envelope.
 */
export async function parseHubSuccessResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw await parseHubError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return unwrapHubResponse<T>(await readJson(response), response.status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
