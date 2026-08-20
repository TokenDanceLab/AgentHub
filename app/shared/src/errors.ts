// Error handling per api/conventions.md §5.
//
// All REST errors use:
//   { "error": { "code": "...", "message": "...", "traceId": "...", "details": {} } }

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    traceId?: string;
    details?: Record<string, unknown>;
  };
  [key: string]: unknown;
}

export class AppError extends Error {
  code: string;
  status: number;
  traceId: string | undefined;
  details: Record<string, unknown> | undefined;
  rawBody?: unknown;

  constructor(body: ErrorBody, status: number, rawBody: unknown = body) {
    super(body.error.message);
    this.name = 'AppError';
    this.code = body.error.code;
    this.status = status;
    this.traceId = body.error.traceId;
    this.details = normalizeDetails(body);
    this.rawBody = rawBody;
  }
}

function normalizeDetails(body: ErrorBody): Record<string, unknown> | undefined {
  const details = { ...(body.error.details ?? {}) };
  for (const key of ['runId', 'projectId', 'threadId']) {
    if (details[key] === undefined && body[key] !== undefined) {
      details[key] = body[key];
    }
  }
  return Object.keys(details).length > 0 ? details : undefined;
}

export function isErrorResponse(body: unknown): body is ErrorBody {
  if (!body || typeof body !== 'object') return false;
  const err = (body as Record<string, unknown>).error;
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  return typeof e.code === 'string' && typeof e.message === 'string';
}

/**
 * True when the error is a recoverable TurnInProgress 409 — the agent instance
 * already has a non-terminal task (queued/dispatched/running, #1430).
 *
 * The frontend treats this as recoverable: keep the draft / optimistic message
 * (it is already persisted — SendMessage is independent), show an info toast
 * rather than a hard error. Granularity is per agent_instance, not per session.
 */
export function isTurnInProgressError(error: unknown): boolean {
  return error instanceof AppError && error.status === 409 && error.code === 'turn_in_progress';
}

export async function parseError(response: Response): Promise<AppError> {
  try {
    const body = await response.json();
    if (isErrorResponse(body)) {
      return new AppError(body, response.status);
    }
  } catch {
    // fall through to generic error
  }
  return new AppError(
    {
      error: {
        code: response.status >= 500 ? 'internal_error' : 'bad_request',
        message: `HTTP ${response.status}: ${response.statusText}`,
      },
    },
    response.status,
  );
}

// ── Mobile Hub error compatibility classes ──────────────────────────────────
// SSOT for the mobile HubApiError/HubNetworkError shapes historically defined
// locally in app/mobile-rn. Mobile re-exports these so test/UI `instanceof`
// checks resolve to one shared class identity (#1338).

export interface HubErrorDetails {
  code: string;
  message: string;
  status?: number;
  retryable: boolean;
  cause?: unknown;
}

export class HubApiError extends Error {
  code: string;
  status: number;
  retryable: boolean;

  constructor(details: Omit<HubErrorDetails, 'cause'> & { status: number }) {
    super(details.message);
    this.name = 'HubApiError';
    this.code = details.code;
    this.status = details.status;
    this.retryable = details.retryable;
  }
}

export class HubNetworkError extends Error {
  code = 'network_error';
  retryable = true;
  cause?: unknown;

  constructor(message = 'Network request to AgentHub failed', cause?: unknown) {
    super(message);
    this.name = 'HubNetworkError';
    this.cause = cause;
  }
}

// ── ErrorReporter ──────────────────────────────

export type ErrorCategory = 'network' | 'auth' | 'agent' | 'runtime' | 'unknown';

export interface ErrorReport {
  id: string;
  category: ErrorCategory;
  message: string;
  timestamp: number;
  count: number;
  stack?: string;
  context?: Record<string, unknown>;
}

function categorizeError(error: Error | AppError): ErrorCategory {
  if (error instanceof AppError) {
    if (error.status === 401 || error.status === 403) return 'auth';
    if (error.status >= 500 || error.code === 'internal_error') return 'runtime';
    if (error.code === 'network_error') return 'network';
    const msg = error.message.toLowerCase();
    if (msg.includes('fetch') || msg.includes('network') || msg.includes('abort')) return 'network';
    if (msg.includes('auth') || msg.includes('unauthorized') || msg.includes('forbidden') || msg.includes('token')) return 'auth';
    if (msg.includes('agent') || msg.includes('runtime') || msg.includes('runner')) return 'agent';
  }
  const msg = error.message?.toLowerCase() ?? '';
  if (msg.includes('fetch') || msg.includes('network') || msg.includes('abort') || msg.includes('timeout')) return 'network';
  if (msg.includes('auth') || msg.includes('unauthorized') || msg.includes('forbidden')) return 'auth';
  if (msg.includes('agent') || msg.includes('runtime') || msg.includes('runner')) return 'agent';
  return 'unknown';
}

function dedupKey(error: Error | AppError, category: ErrorCategory): string {
  const code = error instanceof AppError ? error.code : '';
  return `${category}:${code}:${error.message}`;
}

export class ErrorReporter {
  private errors: Map<string, ErrorReport> = new Map();
  private listeners: Set<(report: ErrorReport) => void> = new Set();
  private changeListeners: Set<() => void> = new Set();
  private throttleTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private throttleMs = 1000;

  report(error: Error | AppError, context?: Record<string, unknown>): ErrorReport {
    const category = categorizeError(error);
    const key = dedupKey(error, category);

    const existing = this.errors.get(key);
    if (existing) {
      existing.count += 1;
      existing.timestamp = Date.now();
      if (context) existing.context = { ...existing.context, ...context };
      this.notify(existing);
      return existing;
    }

    // Throttle: collapse rapid duplicates into one report
    if (this.throttleTimers.has(key)) {
      return this.errors.get(key) ?? this.createReport(error, category, key, context);
    }

    const report = this.createReport(error, category, key, context);

    this.throttleTimers.set(key, setTimeout(() => {
      this.throttleTimers.delete(key);
    }, this.throttleMs));

    return report;
  }

  private createReport(
    error: Error | AppError,
    category: ErrorCategory,
    key: string,
    context?: Record<string, unknown>,
  ): ErrorReport {
    const report: ErrorReport = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      category,
      message: error.message,
      timestamp: Date.now(),
      count: 1,
      ...(error.stack != null && { stack: error.stack }),
      ...(context != null && { context }),
    };
    this.errors.set(key, report);
    this.notify(report);
    return report;
  }

  private notify(report: ErrorReport): void {
    for (const fn of this.listeners) {
      try { fn(report); } catch { /* isolate */ }
    }
    this.notifyChanged();
  }

  private notifyChanged(): void {
    for (const fn of this.changeListeners) {
      try { fn(); } catch { /* isolate */ }
    }
  }

  subscribe(listener: (report: ErrorReport) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Change channel: fires on report and on clear, without a report payload.
   *  For useSyncExternalStore subscriptions that only need to know the store
   *  mutated (e.g. useErrorReporter's snapshot invalidation). */
  subscribeChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  getRecent(limit = 20): ErrorReport[] {
    return Array.from(this.errors.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  clear(): void {
    this.errors.clear();
    for (const timer of this.throttleTimers.values()) clearTimeout(timer);
    this.throttleTimers.clear();
    this.notifyChanged();
  }
}

export const globalErrorReporter = new ErrorReporter();

// ── API client error reporting utility ────────────

/**
 * Report an error caught in an API client to both console.error and the
 * global error reporter.  The reporter deduplicates by category+code+message
 * and throttles to once per second per unique error key.
 *
 * Use this in every .catch() handler throughout hubClient, edgeClient, and
 * eventClient to ensure errors are surfaced to the user via the toast handler
 * wired in errorReporting.ts.
 */
export function reportApiError(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (error instanceof AppError) {
    console.error(
      `[API] ${error.code} (HTTP ${error.status}): ${error.message}`,
      context ?? {},
    );
    globalErrorReporter.report(error, context);
    return;
  }
  if (error instanceof Error) {
    console.error(`[API] ${error.name}: ${error.message}`, context ?? {});
    globalErrorReporter.report(error, context);
    return;
  }
  const msg = String(error);
  console.error(`[API] ${msg}`, context ?? {});
  globalErrorReporter.report(new Error(msg), context);
}
