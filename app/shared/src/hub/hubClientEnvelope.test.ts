import { describe, expect, it } from 'vitest';
import { AppError } from '../errors';
import {
  HubError,
  isHubResponseEnvelope,
  isHubSuccessCode,
  parseHubError,
  parseHubSuccessResponse,
  readJson,
  unwrapHubResponse,
} from './hubClientEnvelope';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('hubClientEnvelope (#799)', () => {
  it('detects envelopes and success codes case-insensitively', () => {
    expect(isHubResponseEnvelope({ code: 'OK', data: 1 })).toBe(true);
    expect(isHubResponseEnvelope({ id: 'raw' })).toBe(false);
    expect(isHubSuccessCode('OK')).toBe(true);
    expect(isHubSuccessCode('ok')).toBe(true);
    expect(isHubSuccessCode('Ok')).toBe(true);
    expect(isHubSuccessCode('ERR')).toBe(false);
  });

  it('unwraps Hub response envelopes and keeps raw bodies compatible', () => {
    expect(unwrapHubResponse<{ id: string }>({ code: 'OK', data: { id: '1' } })).toEqual({
      id: '1',
    });
    expect(unwrapHubResponse<{ id: string }>({ code: 'ok', data: { id: '2' } })).toEqual({
      id: '2',
    });
    expect(unwrapHubResponse<{ id: string }>({ code: 'Ok', data: { id: '3' } })).toEqual({
      id: '3',
    });
    expect(unwrapHubResponse<{ id: string }>({ id: 'raw' })).toEqual({ id: 'raw' });
  });

  it('turns Hub envelope errors into AppError', async () => {
    expect(() =>
      unwrapHubResponse({ code: 'SESSION_NOT_MEMBER', message: 'not a member' }, 403),
    ).toThrow(AppError);

    const error = await parseHubError(
      jsonResponse({ code: 'AGENT_TASK_NOT_FOUND', message: 'missing task' }, { status: 404 }),
    );

    expect(error).toMatchObject({
      code: 'AGENT_TASK_NOT_FOUND',
      message: 'missing task',
      status: 404,
    });

    expect(() =>
      unwrapHubResponse({ code: 'HUB_ENVELOPE_ERROR', message: 'bad envelope' }, 200),
    ).toThrow(AppError);
  });

  it('keeps the legacy HubError shape for Desktop compatibility', () => {
    const error = new HubError(401, 'Unauthorized', 'auth_failed');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('HubError');
    expect(error.status).toBe(401);
    expect(error.code).toBe('auth_failed');
    expect(error.message).toBe('Unauthorized');
  });

  it('readJson returns undefined on invalid JSON', async () => {
    const response = new Response('not-json', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
    await expect(readJson(response)).resolves.toBeUndefined();
  });

  it('parseHubSuccessResponse peels 204 / envelope / error paths (#901)', async () => {
    await expect(
      parseHubSuccessResponse(new Response(null, { status: 204 })),
    ).resolves.toBeUndefined();

    await expect(
      parseHubSuccessResponse<{ id: string }>(
        jsonResponse({ code: 'OK', data: { id: 'ok-1' } }),
      ),
    ).resolves.toEqual({ id: 'ok-1' });

    await expect(
      parseHubSuccessResponse(
        jsonResponse({ code: 'AGENT_TASK_NOT_FOUND', message: 'missing' }, { status: 404 }),
      ),
    ).rejects.toMatchObject({
      code: 'AGENT_TASK_NOT_FOUND',
      message: 'missing',
      status: 404,
    });
  });

  it('parseHubError falls back to HUB_ERROR for plain message bodies', async () => {
    // A body with a message but no string `code` is not a Hub envelope.
    const error = await parseHubError(jsonResponse({ message: 'boom' }, { status: 422 }));
    expect(error).toMatchObject({ code: 'HUB_ERROR', message: 'boom', status: 422 });

    // Non-string code values are ignored the same way.
    const numericCode = await parseHubError(
      jsonResponse({ message: 'still boom', code: 42 }, { status: 422 }),
    );
    expect(numericCode).toMatchObject({ code: 'HUB_ERROR', message: 'still boom' });
  });

  it('parseHubError derives a generic code from the status when no body helps', async () => {
    const serverError = await parseHubError(
      new Response(null, { status: 503, statusText: 'Service Unavailable' }),
    );
    expect(serverError).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Service Unavailable',
      status: 503,
    });

    const clientError = await parseHubError(new Response(null, { status: 400 }));
    expect(clientError).toMatchObject({
      code: 'BAD_REQUEST',
      message: 'HTTP 400',
      status: 400,
    });
  });
});
