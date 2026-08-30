/**
 * Mobile-friendly error classification and message sanitization.
 *
 * Thin local wrapper inspired by @agenthub/shared/errorReporting's
 * friendlyErrorMessage + categorizeError. Not re-exported from shared because
 * that module depends on react-i18next which mobile-rn does not use.
 * See /root/agenthub-dev/lanes/lane-gg-mobile-error-ux/BLOCKED.md for rationale.
 */

import type { ErrorCategory } from '@agenthub/shared/errors';

// Re-export the category type so consumers don't need a second import.
export type { ErrorCategory };

/**
 * Classifies an error into a user-facing category. Mirrors the logic in
 * @agenthub/shared/errors.ts categorizeError (private there, replicated here
 * as a pure function without React/i18n dependencies).
 */
export function categorizeMobileError(error: unknown): ErrorCategory {
  if (!(error instanceof Error)) return 'unknown';

  // AppError / HubApiError carry structured status + code
  const err = error as Error & { status?: number; code?: string };

  if (typeof err.status === 'number') {
    if (err.status === 401 || err.status === 403) return 'auth';
    if (err.status >= 500) return 'runtime';
  }

  if (typeof err.code === 'string') {
    if (err.code === 'network_error') return 'network';
    if (err.code === 'internal_error') return 'runtime';
  }

  const msg = (error.message ?? '').toLowerCase();
  if (msg.includes('fetch') || msg.includes('network') || msg.includes('abort') || msg.includes('timeout')) {
    return 'network';
  }
  if (msg.includes('auth') || msg.includes('unauthorized') || msg.includes('forbidden') || msg.includes('token')) {
    return 'auth';
  }
  if (msg.includes('agent') || msg.includes('runtime') || msg.includes('runner')) {
    return 'agent';
  }

  return 'unknown';
}

/**
 * Technical-string detector. Returns true when the raw message looks like
 * internal diagnostics (HTTP status lines, stack frames, Node internals,
 * proxy errors) rather than a user-facing message.
 *
 * Regex copied from @agenthub/shared/errorReporting.ts friendlyErrorMessage.
 */
const TECHNICAL_PATTERN = /HTTP\s+\d{3}|proxy|stack|at\s+[^\s]+\s+\(|node:|TypeError|ReferenceError/i;

/**
 * Sanitizes an error message for user display. If the raw message looks
 * technical, returns the fallback instead. Passes friendly messages through.
 *
 * @param raw - The raw error message (may be undefined or empty).
 * @param fallback - A localized, user-friendly fallback message.
 */
export function mobileFriendlyErrorMessage(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  return TECHNICAL_PATTERN.test(raw) ? fallback : raw;
}

/**
 * Maps an error category to a default i18n string key from the mobile strings
 * table. Callers pass the result through useStrings() to get the localized text.
 */
export function categoryToStringKey(category: ErrorCategory): string {
  switch (category) {
    case 'network':
      return 'genericNetworkError';
    case 'auth':
      return 'genericAuthError';
    case 'agent':
    case 'runtime':
      return 'genericServerError';
    case 'unknown':
    default:
      return 'genericUnknownError';
  }
}
