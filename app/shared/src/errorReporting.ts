import { useCallback, useRef, useSyncExternalStore } from 'react';
import { globalErrorReporter, type ErrorReport } from './errors';

export type ToastSeverity = 'error' | 'warning' | 'info';

export interface ToastConfig {
  severity: ToastSeverity;
  title: string;
  message: string;
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
  const labels: Record<string, string> = {
    network: 'Network error',
    auth: 'Authentication error',
    agent: 'Agent error',
    runtime: 'Runtime error',
    unknown: 'Unknown error',
  };
  return labels[category] ?? 'Unknown error';
}

const errorReporterListener = (report: ErrorReport) => {
  if (!toastHandler) return;
  toastHandler({
    severity: 'error',
    title: categoryLabel(report.category),
    message: report.message,
  });
};

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
      latest: recent.length > 0 ? recent[0] : null,
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
