// Shared Hub report-error helpers for the Desktop task bridge.
// Critical lifecycle calls (done/fail/ack) and best-effort telemetry
// (streamTaskEvent) must never throw into the hook; they still must be
// observable so silent Hub failures do not leave tasks hanging without logs.

/**
 * Format an unknown error into a stable log message.
 * Pure helper — safe to unit-test without DOM/console mocks.
 */
export function formatHubError(err: unknown): string {
  if (err instanceof Error) {
    return err.message || err.name || 'Error';
  }
  if (typeof err === 'string') {
    return err;
  }
  if (err == null) {
    return String(err);
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Log a Hub report failure without rethrowing.
 * Uses the desktop console logger (console.error) so failures surface in
 * DevTools / Tauri logs while the bridge stays non-blocking.
 */
export function logHubError(op: string, err: unknown): void {
  const message = formatHubError(err);
  console.error(`[hubReport] ${op} failed:`, message, err);
}

/**
 * Attach a non-throwing catch logger to a Hub report promise.
 * Returns the same promise so callers can still await/void it if needed.
 */
export function catchHubReport<T>(op: string, promise: Promise<T>): Promise<T | undefined> {
  return promise.catch((err: unknown): T | undefined => {
    logHubError(op, err);
    return undefined;
  });
}
