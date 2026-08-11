import { useCallback, useRef, useSyncExternalStore } from 'react';
import { getI18n } from 'react-i18next';
import { globalErrorReporter, type ErrorReport } from './errors';

export type ToastSeverity = 'error' | 'warning' | 'info';

export interface ToastAction {
  /** Localized label shown on the action button. */
  label: string;
  /** Invoked when the user clicks the action (e.g. retry the failed request). */
  onClick: () => void;
}

export interface ToastConfig {
  severity: ToastSeverity;
  title: string;
  message: string;
  /** Optional primary action, e.g. a "Retry" button on network errors. */
  action?: ToastAction;
  /** Server-side trace id, surfaced as secondary text when available so the
   *  user can quote it to support without seeing the raw technical message. */
  traceId?: string;
}

export interface ErrorStats {
  total: number;
  byCategory: Record<string, number>;
  latest: ErrorReport | null;
}

type ToastHandler = (config: ToastConfig) => void;

let toastHandler: ToastHandler | null = null;

export function setToastHandler(handler: ToastHandler | null): void {
  toastHandler = handler;
}

function categoryLabel(category: string): string {
  // Resolve the label through the global i18n instance so the toast title
  // localizes once the `common` namespace ships the error.* keys; until then
  // the friendly English fallbacks below are used (no raw server strings).
  const keyForCategory: Record<string, string> = {
    network: 'error.network',
    auth: 'error.auth',
    agent: 'error.agent',
    runtime: 'error.runtime',
    unknown: 'error.unknown',
  };
  const fallbackForCategory: Record<string, string> = {
    network: 'Network error',
    auth: 'Authentication error',
    agent: 'Agent error',
    runtime: 'Runtime error',
    unknown: 'Unknown error',
  };
  const key = keyForCategory[category] ?? 'error.unknown';
  const fallback = fallbackForCategory[category] ?? 'Unknown error';
  try {
    const i18n = getI18n();
    if (i18n?.isInitialized) {
      return i18n.t(key, fallback);
    }
  } catch {
    // i18n not ready — fall through to the friendly English fallback
  }
  return fallback;
}

/** Friendly fallback message used when an AppError message looks technical
 *  (HTTP status, proxy internals, stack frames). Keeps the raw string out of
 *  the toast body; the traceId is surfaced separately by the caller. */
export function friendlyErrorMessage(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const technical = /HTTP\s+\d{3}|proxy|stack|at\s+[^\s]+\s+\(|node:|TypeError|ReferenceError/i.test(raw);
  return technical ? fallback : raw;
}

const errorReporterListener = (report: ErrorReport) => {
  if (!toastHandler) return;
  const fallback = categoryLabel(report.category);
  const traceId = typeof report.context?.traceId === 'string'
    ? (report.context.traceId as string)
    : undefined;
  toastHandler({
    severity: 'error',
    title: fallback,
    // Avoid leaking raw server/technical strings into the toast body; the
    // traceId is surfaced separately so the user can quote it to support.
    message: friendlyErrorMessage(report.message, fallback),
    ...(traceId !== undefined && { traceId }),
    // Network errors are recoverable — offer a Retry affordance if a handler
    // is wired (the toast host owns the actual retry callback).
    ...(report.category === 'network' && {
      action: { label: getRetryLabel(), onClick: () => window.location.reload() },
    }),
  });
};

function getRetryLabel(): string {
  try {
    const i18n = getI18n();
    if (i18n?.isInitialized) return i18n.t('error.retry', 'Retry');
  } catch {
    // i18n not ready
  }
  return 'Retry';
}

export function useErrorReporter() {
  const subscribed = useRef(false);

  if (!subscribed.current) {
    subscribed.current = true;
    globalErrorReporter.subscribe(errorReporterListener);
  }

  const subscribe = useCallback(
    (onStoreChange: () => void) => globalErrorReporter.subscribe(() => onStoreChange()),
    [],
  );

  const getSnapshot = useCallback((): ErrorStats => {
    const recent = globalErrorReporter.getRecent(50);
    const byCategory: Record<string, number> = {};
    for (const r of recent) {
      byCategory[r.category] = (byCategory[r.category] ?? 0) + r.count;
    }
    return {
      total: recent.reduce((sum, r) => sum + r.count, 0),
      byCategory,
      latest: recent[0] ?? null,
    };
  }, []);

  const stats = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const reportError = useCallback(
    (error: Error, context?: Record<string, unknown>) =>
      globalErrorReporter.report(error, context),
    [],
  );

  const clearErrors = useCallback(() => globalErrorReporter.clear(), []);

  return { stats, reportError, clearErrors };
}
