import { describe, expect, it } from 'vitest';
import {
  AppError,
  isErrorResponse,
  isTurnInProgressError,
  parseError,
  type ErrorBody,
} from './errors';

describe('isTurnInProgressError', () => {
  const turnBody: ErrorBody = {
    error: { code: 'turn_in_progress', message: 'agent instance already has an active task' },
  };

  it('returns true for a 409 turn_in_progress AppError (#1430)', () => {
    const err = new AppError(turnBody, 409);
    expect(isTurnInProgressError(err)).toBe(true);
  });

  it('returns false for the Edge active_run_exists 409 (different code)', () => {
    const err = new AppError(
      { error: { code: 'active_run_exists', message: 'thread already has an active run' } },
      409,
    );
    expect(isTurnInProgressError(err)).toBe(false);
  });

  it('returns false for a non-409 turn_in_progress (defensive: status must match)', () => {
    const err = new AppError(turnBody, 500);
    expect(isTurnInProgressError(err)).toBe(false);
  });

  it('returns false for plain Errors and unknown values', () => {
    expect(isTurnInProgressError(new Error('boom'))).toBe(false);
    expect(isTurnInProgressError(null)).toBe(false);
    expect(isTurnInProgressError(undefined)).toBe(false);
    expect(isTurnInProgressError({ code: 'turn_in_progress', status: 409 })).toBe(false);
  });
});

// ── 迁入自 app/desktop/src/__tests__/errors.test.ts（11 用例，断言逐字保留）──
// errors.ts 的 SSOT 在本包，桌面包并不拥有它（desktop/src 下没有 errors.ts）；
// 这三个 describe 是 isErrorResponse / AppError / parseError 的**唯一**覆盖，
// 随源码归位，覆盖没有增减，只是不再由不拥有源码的包代跑。

describe('isErrorResponse', () => {
  it('returns true for valid error body', () => {
    expect(
      isErrorResponse({
        error: { code: 'not_found', message: 'Not found' },
      }),
    ).toBe(true);
  });

  it('returns false for null', () => {
    expect(isErrorResponse(null)).toBe(false);
  });

  it('returns false for non-object', () => {
    expect(isErrorResponse('string')).toBe(false);
  });

  it('returns false for object without error field', () => {
    expect(isErrorResponse({ data: 'ok' })).toBe(false);
  });

  it('returns false when error.code is missing', () => {
    expect(isErrorResponse({ error: { message: 'x' } })).toBe(false);
  });

  it('returns false when error.message is missing', () => {
    expect(isErrorResponse({ error: { code: 'x' } })).toBe(false);
  });
});

describe('AppError', () => {
  it('wraps error body', () => {
    const err = new AppError(
      { error: { code: 'runner_offline', message: 'Runner 不在线', traceId: 'trace_1' } },
      409,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AppError');
    expect(err.code).toBe('runner_offline');
    expect(err.status).toBe(409);
    expect(err.message).toBe('Runner 不在线');
    expect(err.traceId).toBe('trace_1');
  });
});

describe('parseError', () => {
  it('parses valid error response', async () => {
    const res = {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: () =>
        Promise.resolve({
          error: { code: 'not_found', message: 'thread not found', traceId: 'trace_abc' },
        }),
    } as Response;

    const err = await parseError(res);
    expect(err.code).toBe('not_found');
    expect(err.status).toBe(404);
    expect(err.message).toBe('thread not found');
    expect(err.traceId).toBe('trace_abc');
  });

  it('preserves top-level active run fields in details', async () => {
    const res = {
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: () =>
        Promise.resolve({
          error: { code: 'active_run_exists', message: 'active run exists' },
          runId: 'run_active_1',
        }),
    } as Response;

    const err = await parseError(res);
    expect(err.code).toBe('active_run_exists');
    expect(err.status).toBe(409);
    expect(err.details?.runId).toBe('run_active_1');
  });

  it('falls back to generic error on malformed body', async () => {
    const res = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({ not: 'an error' }),
    } as Response;

    const err = await parseError(res);
    expect(err.code).toBe('internal_error');
    expect(err.message).toContain('500');
  });

  it('falls back on JSON parse failure', async () => {
    const res = {
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: () => Promise.reject(new Error('invalid json')),
    } as Response;

    const err = await parseError(res);
    expect(err.code).toBe('internal_error');
  });
});
