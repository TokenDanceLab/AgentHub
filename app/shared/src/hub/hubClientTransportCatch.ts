/**
 * Hub client transport catch / abort / request-context residuals.
 * Peel companion of hubClientTransportUtils (#1102). Pure only; zero behavior change.
 */

import { AppError, reportApiError } from '../errors';
import {
  buildHubUrl,
  createAuthOnlyHeaders,
  createJsonAuthHeaders,
  createNetworkAppError,
  createTimeoutAppError,
  isAbortError,
  isNetworkFetchTypeError,
  requestMethodOf,
  resolveHubTimeoutMs,
  shouldAttemptTokenRefresh,
  toReportableError,
} from './hubClientTransportBasics';

/**
 * Classify request catch values for timeout / network remapping.
 * Pure decision only — side effects stay in createHubClient.
 */
export function classifyHubRequestCatch(
  error: unknown,
):
  | { kind: 'timeout' }
  | { kind: 'app'; error: AppError }
  | { kind: 'network'; message: string }
  | { kind: 'other'; error: unknown } {
  if (isAbortError(error)) {
    return { kind: 'timeout' };
  }
  if (error instanceof AppError) {
    return { kind: 'app', error };
  }
  if (isNetworkFetchTypeError(error)) {
    return { kind: 'network', message: (error as TypeError).message };
  }
  return { kind: 'other', error };
}

/** AbortController + auto-abort timer for one Hub fetch attempt. */
export type HubAbortTimeout = {
  signal: AbortSignal;
  clear: () => void;
};

/** Create a timeout-bound AbortSignal; caller must clear after settle. */
export function createHubAbortTimeout(timeoutMs: number): HubAbortTimeout {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId),
  };
}

/**
 * Run a Hub fetch under a timeout abort signal.
 * Clears the timer on both success and failure (exactOptional-safe residual).
 */
export async function withHubAbortTimeout<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const abort = createHubAbortTimeout(timeoutMs);
  try {
    const result = await run(abort.signal);
    abort.clear();
    return result;
  } catch (error) {
    abort.clear();
    throw error;
  }
}

/** Non-empty refresh token → proceed with single retry. */
export function shouldRetryWithRefreshedToken(
  newToken: string | null | undefined,
): newToken is string {
  return Boolean(newToken);
}

/** reportApiError context for failed onRefreshToken handlers. */
export function buildTokenRefreshReportContext(path: string): {
  path: string;
  context: 'token_refresh';
} {
  return { path, context: 'token_refresh' };
}

export type HubRequestCatchContext = {
  timeoutMs: number;
  method: string;
  path: string;
};

/**
 * Map a request catch into throw/report payloads.
 * Side effects (console / reportApiError) stay in createHubClient.
 */
export type HubRequestCatchResolution =
  | {
      kind: 'timeout';
      error: AppError;
      logMessage: string;
      reportContext: { path: string; method: string; timeoutMs: number };
    }
  | {
      kind: 'app';
      error: AppError;
      reportContext: { path: string; method: string };
    }
  | {
      kind: 'network';
      error: AppError;
      logMessage: string;
      reportContext: { path: string; method: string };
    }
  | {
      kind: 'other';
      error: unknown;
    };

export function resolveHubRequestCatch(
  error: unknown,
  ctx: HubRequestCatchContext,
): HubRequestCatchResolution {
  const classified = classifyHubRequestCatch(error);
  if (classified.kind === 'timeout') {
    const timeoutError = createTimeoutAppError(ctx);
    return {
      kind: 'timeout',
      error: timeoutError,
      logMessage: `[HubClient] ${timeoutError.message}`,
      reportContext: {
        path: ctx.path,
        method: ctx.method,
        timeoutMs: ctx.timeoutMs,
      },
    };
  }
  if (classified.kind === 'app') {
    return {
      kind: 'app',
      error: classified.error,
      reportContext: { path: ctx.path, method: ctx.method },
    };
  }
  if (classified.kind === 'network') {
    const netError = createNetworkAppError(classified.message);
    return {
      kind: 'network',
      error: netError,
      logMessage: `[HubClient] ${netError.message}`,
      reportContext: { path: ctx.path, method: ctx.method },
    };
  }
  return { kind: 'other', error: classified.error };
}

/** Pure residual: assemble headers/timeout/method/url for one JSON Hub request. */
export type HubRequestContext = {
  headers: Headers;
  timeoutMs: number;
  method: string;
  url: string;
};

export function prepareHubRequestContext(args: {
  baseUrl: string;
  path: string;
  options: RequestInit;
  token?: string | null;
  timeoutMs?: number;
}): HubRequestContext {
  return {
    headers: createJsonAuthHeaders(args.options.headers, args.token),
    timeoutMs: resolveHubTimeoutMs(args.timeoutMs),
    method: requestMethodOf(args.options),
    url: buildHubUrl(args.baseUrl, args.path),
  };
}

/** Pure residual: assemble auth-only headers/timeout/url for multipart upload. */
export type HubMultipartUploadContext = {
  headers: Headers;
  timeoutMs: number;
  url: string;
};

export function prepareMultipartUploadContext(args: {
  baseUrl: string;
  path: string;
  token?: string | null;
  timeoutMs?: number;
}): HubMultipartUploadContext {
  return {
    headers: createAuthOnlyHeaders(args.token),
    timeoutMs: resolveHubTimeoutMs(args.timeoutMs),
    url: buildHubUrl(args.baseUrl, args.path),
  };
}

/** Pure residual: opts.onRefreshToken presence predicate. */
export function hasTokenRefreshHandler(
  onRefreshToken?: (() => Promise<string | null>) | null | undefined,
): boolean {
  return Boolean(onRefreshToken);
}

/**
 * Pure residual of request catch side-effect planning (#978).
 * logMessage/report are omitted (exactOptional-safe) when not needed.
 */
export type HubRequestCatchEffects =
  | {
      error: AppError;
      logMessage: string;
      report: {
        error: AppError;
        context: { path: string; method: string; timeoutMs: number };
      };
    }
  | {
      error: AppError;
      report: {
        error: AppError;
        context: { path: string; method: string };
      };
    }
  | {
      error: unknown;
    };

export function planHubRequestCatchEffects(
  error: unknown,
  ctx: HubRequestCatchContext,
): HubRequestCatchEffects {
  const resolved = resolveHubRequestCatch(error, ctx);
  if (resolved.kind === 'timeout') {
    return {
      error: resolved.error,
      logMessage: resolved.logMessage,
      report: { error: resolved.error, context: resolved.reportContext },
    };
  }
  if (resolved.kind === 'network') {
    return {
      error: resolved.error,
      logMessage: resolved.logMessage,
      report: { error: resolved.error, context: resolved.reportContext },
    };
  }
  if (resolved.kind === 'app') {
    return {
      error: resolved.error,
      report: { error: resolved.error, context: resolved.reportContext },
    };
  }
  return { error: resolved.error };
}

/** Token-refresh failure log line (console.error residual). */
export function buildTokenRefreshFailedLogPrefix(): string {
  return '[HubClient] Token refresh failed';
}

// ── Residual pure peels (#990) ────────────────────────────────────────────────

/**
 * exactOptional-safe prepareHubRequestContext entry for createHubClient.request.
 * Accepts explicit undefined from opts getters; omits those keys before prepare
 * (exactOptionalPropertyTypes-safe for the inner HubRequestContext builder).
 */
export function prepareHubRequestContextFromClient(args: {
  baseUrl: string;
  path: string;
  options: RequestInit;
  token?: string | null | undefined;
  timeoutMs?: number | undefined;
}): HubRequestContext {
  const input: {
    baseUrl: string;
    path: string;
    options: RequestInit;
    token?: string | null;
    timeoutMs?: number;
  } = {
    baseUrl: args.baseUrl,
    path: args.path,
    options: args.options,
  };
  if (args.token !== undefined) {
    input.token = args.token;
  }
  if (args.timeoutMs !== undefined) {
    input.timeoutMs = args.timeoutMs;
  }
  return prepareHubRequestContext(input);
}

/**
 * exactOptional-safe prepareMultipartUploadContext entry for uploadMultipart.
 * Accepts explicit undefined from opts getters; omits those keys before prepare.
 */
export function prepareMultipartUploadContextFromClient(args: {
  baseUrl: string;
  path: string;
  token?: string | null | undefined;
  timeoutMs?: number | undefined;
}): HubMultipartUploadContext {
  const input: {
    baseUrl: string;
    path: string;
    token?: string | null;
    timeoutMs?: number;
  } = {
    baseUrl: args.baseUrl,
    path: args.path,
  };
  if (args.token !== undefined) {
    input.token = args.token;
  }
  if (args.timeoutMs !== undefined) {
    input.timeoutMs = args.timeoutMs;
  }
  return prepareMultipartUploadContext(input);
}

/** Pure residual: after onRefreshToken settles, retry once or abort. */
export type RefreshedTokenRetryPlan =
  | { action: 'retry'; token: string }
  | { action: 'abort' };

export function planRefreshedTokenRetry(
  newToken: string | null | undefined,
): RefreshedTokenRetryPlan {
  if (shouldRetryWithRefreshedToken(newToken)) {
    return { action: 'retry', token: newToken };
  }
  return { action: 'abort' };
}

/** Pure residual: console/report payloads for failed onRefreshToken. */
export function planTokenRefreshFailureReport(
  path: string,
  refreshErr: unknown,
): {
  logPrefix: string;
  error: Error;
  context: { path: string; context: 'token_refresh' };
} {
  return {
    logPrefix: buildTokenRefreshFailedLogPrefix(),
    error: toReportableError(refreshErr),
    context: buildTokenRefreshReportContext(path),
  };
}

/**
 * Pure residual: whether the primary response should enter token-refresh recovery.
 * Combines status + handler presence so createHubClient stays a thin if-branch.
 */
export function shouldEnterTokenRefreshRecovery(
  status: number,
  onRefreshToken?: (() => Promise<string | null>) | null | undefined,
): boolean {
  return shouldAttemptTokenRefresh(status, hasTokenRefreshHandler(onRefreshToken));
}

/**
 * Apply planned request-catch effects (log / report) then rethrow.
 * Side-effect sinks stay injected so the helper remains testable without I/O coupling.
 */
export function applyHubRequestCatchEffects(
  effects: HubRequestCatchEffects,
  deps: {
    logError: (message: string) => void;
    report: (error: AppError, context: Record<string, unknown>) => void;
  },
): never {
  if ('logMessage' in effects) {
    deps.logError(effects.logMessage);
  }
  if ('report' in effects) {
    deps.report(effects.report.error, effects.report.context);
  }
  throw effects.error;
}

/** Apply planned token-refresh failure log/report residual (no throw). */
export function applyTokenRefreshFailureReport(
  report: {
    logPrefix: string;
    error: Error;
    context: { path: string; context: 'token_refresh' };
  },
  refreshErr: unknown,
  deps: {
    logError: (prefix: string, err: unknown) => void;
    report: (error: Error, context: { path: string; context: 'token_refresh' }) => void;
  },
): void {
  deps.logError(report.logPrefix, refreshErr);
  deps.report(report.error, report.context);
}

/**
 * Default request-catch residual for createHubClient: plan + log/report + rethrow.
 * Keeps console/report sinks collocated so createHubClient catch stays one line.
 */
export function applyDefaultHubRequestCatchEffects(
  error: unknown,
  ctx: HubRequestCatchContext,
): never {
  applyHubRequestCatchEffects(planHubRequestCatchEffects(error, ctx), {
    logError: (message) => console.error(message),
    report: (err, context) => reportApiError(err, context),
  });
}
