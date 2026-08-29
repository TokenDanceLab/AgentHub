/**
 * #2072 P3: Resolve a failure toast i18n key based on the error's errcode.
 * Returns a specific key when the backend errcode maps to a user-meaningful
 * distinction; falls back to the generic fallbackKey otherwise.
 *
 * @param err - The caught error (may be AppError with .code, plain Error, or unknown)
 * @param fallbackKey - The generic i18n key to use when no specific mapping applies
 * @returns The i18n key to pass to t()
 */
import { AppError } from '../errors';

export function resolveFailedToastKey(err: unknown, fallbackKey: string): string {
  if (!(err instanceof AppError)) return fallbackKey;
  const code = err.code;

  // Edit failures
  if (fallbackKey === 'toast.editFailed') {
    if (code === 'msg_edit_timeout') return 'toast.editFailed.timeout';
    if (code === 'msg_not_editable') return 'toast.editFailed.notEditable';
  }

  // Pin failures
  if (fallbackKey === 'toast.pinFailed') {
    if (code === 'msg_pin_limit_exceeded') return 'toast.pinFailed.limitExceeded';
  }

  // Recall failures
  if (fallbackKey === 'toast.recallFailed') {
    if (code === 'msg_recall_timeout') return 'toast.recallFailed.timeout';
  }

  // Forward failures
  if (fallbackKey === 'toast.forwardFailed') {
    if (code === 'msg_blocked_by_receiver') return 'toast.forwardFailed.blocked';
  }

  // Regenerate failures
  if (fallbackKey === 'toast.regenerateFailed') {
    if (code === 'agent_task_cancelled') return 'toast.regenerateFailed.cancelled';
    if (code === 'agent_task_timeout') return 'toast.regenerateFailed.timeout';
  }

  // Cancel failures
  if (fallbackKey === 'toast.cancelFailed') {
    if (code === 'agent_task_cancelled') return 'toast.cancelFailed.alreadyCancelled';
  }

  // Cross-cutting codes that apply to any action
  if (code === 'msg_not_found') return 'toast.msgNotFound';
  if (code === 'session_not_member') return 'toast.sessionNotMember';
  if (code === 'session_dissolved') return 'toast.sessionDissolved';

  return fallbackKey;
}
