import { describe, expect, it } from 'vitest';
import { AppError } from '../errors';
import { resolveFailedToastKey } from './failedToastKey';

describe('resolveFailedToastKey', () => {
  // Helper to create an AppError with a specific code
  const makeAppError = (code: string, message = 'test error') =>
    new AppError({ error: { code, message } }, 400);

  describe('edit failures', () => {
    it.each([
      ['msg_edit_timeout', 'toast.editFailed.timeout'],
      ['msg_not_editable', 'toast.editFailed.notEditable'],
      ['some_other_code', 'toast.editFailed'],
    ])('maps %s under the edit fallback', (errcode, expected) => {
      expect(resolveFailedToastKey(makeAppError(errcode), 'toast.editFailed')).toBe(expected);
    });
  });

  describe('pin failures', () => {
    it.each([
      ['msg_pin_limit_exceeded', 'toast.pinFailed.limitExceeded'],
      ['some_other_code', 'toast.pinFailed'],
    ])('maps %s under the pin fallback', (errcode, expected) => {
      expect(resolveFailedToastKey(makeAppError(errcode), 'toast.pinFailed')).toBe(expected);
    });
  });

  describe('recall failures', () => {
    it.each([
      ['msg_recall_timeout', 'toast.recallFailed.timeout'],
      ['some_other_code', 'toast.recallFailed'],
    ])('maps %s under the recall fallback', (errcode, expected) => {
      expect(resolveFailedToastKey(makeAppError(errcode), 'toast.recallFailed')).toBe(expected);
    });
  });

  describe('forward failures', () => {
    it.each([
      ['msg_blocked_by_receiver', 'toast.forwardFailed.blocked'],
      ['some_other_code', 'toast.forwardFailed'],
    ])('maps %s under the forward fallback', (errcode, expected) => {
      expect(resolveFailedToastKey(makeAppError(errcode), 'toast.forwardFailed')).toBe(expected);
    });
  });

  describe('regenerate failures', () => {
    it.each([
      ['agent_task_cancelled', 'toast.regenerateFailed.cancelled'],
      ['agent_task_timeout', 'toast.regenerateFailed.timeout'],
      ['some_other_code', 'toast.regenerateFailed'],
    ])('maps %s under the regenerate fallback', (errcode, expected) => {
      expect(resolveFailedToastKey(makeAppError(errcode), 'toast.regenerateFailed')).toBe(expected);
    });
  });

  describe('cancel failures', () => {
    it.each([
      ['agent_task_cancelled', 'toast.cancelFailed.alreadyCancelled'],
      ['some_other_code', 'toast.cancelFailed'],
    ])('maps %s under the cancel fallback', (errcode, expected) => {
      expect(resolveFailedToastKey(makeAppError(errcode), 'toast.cancelFailed')).toBe(expected);
    });
  });

  describe('cross-cutting codes', () => {
    it('returns msgNotFound for msg_not_found regardless of fallback key', () => {
      expect(resolveFailedToastKey(makeAppError('msg_not_found'), 'toast.pinFailed'))
        .toBe('toast.msgNotFound');
      expect(resolveFailedToastKey(makeAppError('msg_not_found'), 'toast.recallFailed'))
        .toBe('toast.msgNotFound');
    });

    it('returns sessionNotMember for session_not_member', () => {
      expect(resolveFailedToastKey(makeAppError('session_not_member'), 'toast.forwardFailed'))
        .toBe('toast.sessionNotMember');
    });

    it('returns sessionDissolved for session_dissolved', () => {
      expect(resolveFailedToastKey(makeAppError('session_dissolved'), 'toast.reactionFailed'))
        .toBe('toast.sessionDissolved');
    });
  });

  describe('fallback behavior', () => {
    it('returns fallback key for non-AppError', () => {
      expect(resolveFailedToastKey(new Error('plain error'), 'toast.editFailed'))
        .toBe('toast.editFailed');
    });

    it('returns fallback key for unknown value', () => {
      expect(resolveFailedToastKey('string error', 'toast.pinFailed'))
        .toBe('toast.pinFailed');
    });

    it('returns fallback key for null/undefined', () => {
      expect(resolveFailedToastKey(null, 'toast.recallFailed'))
        .toBe('toast.recallFailed');
      expect(resolveFailedToastKey(undefined, 'toast.forwardFailed'))
        .toBe('toast.forwardFailed');
    });
  });
});
