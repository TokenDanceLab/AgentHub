import { describe, expect, it } from 'vitest';
import { AppError, isTurnInProgressError, type ErrorBody } from './errors';

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
