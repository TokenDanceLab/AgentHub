import { describe, it, expect } from 'vitest';
import { parseError, isErrorResponse, AppError } from '@shared/errors';

describe('errors', () => {
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
});
