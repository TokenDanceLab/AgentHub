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
  }

  subscribe(listener: (report: ErrorReport) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
  }
}

export const globalErrorReporter = new ErrorReporter();
