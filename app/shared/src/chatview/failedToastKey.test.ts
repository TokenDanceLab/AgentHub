import { describe, expect, it } from 'vitest';
import { AppError } from '../errors';
import { resolveFailedToastKey } from './failedToastKey';

describe('resolveFailedToastKey', () => {
  // Helper to create an AppError with a specific code
  const makeAppError = (code: string, message = 'test error') =>
    new AppError({ error: { code, message } }, 400);

  describe('edit failures', () => {
    it('returns timeout key for msg_edit_timeout', () => {
      expect(resolveFailedToastKey(makeAppError('msg_edit_timeout'), 'toast.editFailed'))
        .toBe('toast.editFailed.timeout');
    });

    it('returns notEditable key for msg_not_editable', () => {
      expect(resolveFailedToastKey(makeAppError('msg_not_editable'), 'toast.editFailed'))
        .toBe('toast.editFailed.notEditable');
    });

    it('falls back for unknown edit errcode', () => {
      expect(resolveFailedToastKey(makeAppError('some_other_code'), 'toast.editFailed'))
        .toBe('toast.editFailed');
    });
  });

  describe('pin failures', () => {
    it('returns limitExceeded key for msg_pin_limit_exceeded', () => {
      expect(resolveFailedToastKey(makeAppError('msg_pin_limit_exceeded'), 'toast.pinFailed'))
        .toBe('toast.pinFailed.limitExceeded');
    });

    it('falls back for unknown pin errcode', () => {
      expect(resolveFailedToastKey(makeAppError('some_other_code'), 'toast.pinFailed'))
        .toBe('toast.pinFailed');
    });
  });

  describe('recall failures', () => {
    it('returns timeout key for msg_recall_timeout', () => {
      expect(resolveFailedToastKey(makeAppError('msg_recall_timeout'), 'toast.recallFailed'))
        .toBe('toast.recallFailed.timeout');
    });

    it('falls back for unknown recall errcode', () => {
      expect(resolveFailedToastKey(makeAppError('some_other_code'), 'toast.recallFailed'))
        .toBe('toast.recallFailed');
    });
  });

  describe('forward failures', () => {
    it('returns blocked key for msg_blocked_by_receiver', () => {
      expect(resolveFailedToastKey(makeAppError('msg_blocked_by_receiver'), 'toast.forwardFailed'))
        .toBe('toast.forwardFailed.blocked');
    });

    it('falls back for unknown forward errcode', () => {
      expect(resolveFailedToastKey(makeAppError('some_other_code'), 'toast.forwardFailed'))
        .toBe('toast.forwardFailed');
    });
  });

  describe('regenerate failures', () => {
    it('returns cancelled key for agent_task_cancelled', () => {
      expect(resolveFailedToastKey(makeAppError('agent_task_cancelled'), 'toast.regenerateFailed'))
        .toBe('toast.regenerateFailed.cancelled');
    });

    it('returns timeout key for agent_task_timeout', () => {
      expect(resolveFailedToastKey(makeAppError('agent_task_timeout'), 'toast.regenerateFailed'))
        .toBe('toast.regenerateFailed.timeout');
    });

    it('falls back for unknown regenerate errcode', () => {
      expect(resolveFailedToastKey(makeAppError('some_other_code'), 'toast.regenerateFailed'))
        .toBe('toast.regenerateFailed');
    });
  });

  describe('cancel failures', () => {
    it('returns alreadyCancelled key for agent_task_cancelled', () => {
      expect(resolveFailedToastKey(makeAppError('agent_task_cancelled'), 'toast.cancelFailed'))
        .toBe('toast.cancelFailed.alreadyCancelled');
    });

    it('falls back for unknown cancel errcode', () => {
      expect(resolveFailedToastKey(makeAppError('some_other_code'), 'toast.cancelFailed'))
        .toBe('toast.cancelFailed');
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
