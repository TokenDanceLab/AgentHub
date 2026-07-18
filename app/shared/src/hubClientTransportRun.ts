/**
 * Hub client transport fetch runners + createHubClient transport factory.
 * Peel companion of hubClientTransportUtils (#1102). Pure residual; zero behavior change.
 */

import { reportApiError } from './errors';
import { parseHubSuccessResponse } from './hubClientEnvelope';
import { runRequestWithRouteFallback } from './hubClientRequestUtils';
import {
  applyRefreshedBearerAuth,
  buildHubFetchInit,
  buildMultipartFetchInit,
  normalizeHubBaseUrl,
  resolveHubFetch,
} from './hubClientTransportBasics';
import {
  applyDefaultHubRequestCatchEffects,
  applyTokenRefreshFailureReport,
  planRefreshedTokenRetry,
  planTokenRefreshFailureReport,
  prepareHubRequestContextFromClient,
  prepareMultipartUploadContextFromClient,
  shouldEnterTokenRefreshRecovery,
  withHubAbortTimeout,
} from './hubClientTransportCatch';

// ── Residual pure peels (#1023) ───────────────────────────────────────────────

/** JSON/auth fetch under abort timeout (request primary + refresh retry residual). */
export async function fetchHubJsonWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
  options: RequestInit,
  headers: Headers,
): Promise<Response> {
  return withHubAbortTimeout(timeoutMs, (signal) =>
    fetchImpl(url, buildHubFetchInit(options, headers, signal)),
  );
}

/** Multipart POST fetch under abort timeout (uploadMultipart residual). */
export async function fetchHubMultipartWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
  headers: Headers,
  formData: FormData,
): Promise<Response> {
  return withHubAbortTimeout(timeoutMs, (signal) =>
    fetchImpl(url, buildMultipartFetchInit(headers, formData, signal)),
  );
}

/**
 * Residual 401 recovery peel: optionally refresh once, then retry via injected runner.
 * Side-effect sinks (onRefreshToken, retry, log/report) stay injected.
 */
export type UnauthorizedRefreshResult<T> =
  | { action: 'retry_result'; value: T }
  | { action: 'continue' };

export async function runUnauthorizedTokenRefreshRecovery<T>(args: {
  status: number;
  onRefreshToken?: (() => Promise<string | null>) | null | undefined;
  headers: Headers;
  path: string;
  retry: () => Promise<T>;
  logError: (prefix: string, err: unknown) => void;
  report: (error: Error, context: { path: string; context: 'token_refresh' }) => void;
}): Promise<UnauthorizedRefreshResult<T>> {
  if (!shouldEnterTokenRefreshRecovery(args.status, args.onRefreshToken)) {
    return { action: 'continue' };
  }

  try {
    const retryPlan = planRefreshedTokenRetry(await args.onRefreshToken!());
    if (retryPlan.action === 'retry') {
      applyRefreshedBearerAuth(args.headers, retryPlan.token);
      return { action: 'retry_result', value: await args.retry() };
    }
  } catch (refreshErr) {
    applyTokenRefreshFailureReport(
      planTokenRefreshFailureReport(args.path, refreshErr),
      refreshErr,
      {
        logError: args.logError,
        report: args.report,
      },
    );
  }

  return { action: 'continue' };
}

// ── Residual pure peels (#1044) ───────────────────────────────────────────────

/**
 * Residual JSON request peel for createHubClient.request (#1044).
 * prepare → fetch → optional 401 refresh retry → parse; catch → default effects.
 * exactOptional-safe via prepareHubRequestContextFromClient.
 */
export async function runHubJsonRequest<T>(args: {
  baseUrl: string;
  path: string;
  options?: RequestInit;
  token?: string | null | undefined;
  timeoutMs?: number | undefined;
  fetchImpl: typeof fetch;
  onRefreshToken?: (() => Promise<string | null>) | null | undefined;
  parseSuccess: (response: Response) => Promise<T>;
}): Promise<T> {
  const options = args.options ?? {};
  const { headers, timeoutMs, method, url } = prepareHubRequestContextFromClient({
    baseUrl: args.baseUrl,
    path: args.path,
    options,
    token: args.token,
    timeoutMs: args.timeoutMs,
  });

  try {
    const response = await fetchHubJsonWithTimeout(
      args.fetchImpl,
      url,
      timeoutMs,
      options,
      headers,
    );

    const recovery = await runUnauthorizedTokenRefreshRecovery({
      status: response.status,
      onRefreshToken: args.onRefreshToken,
      headers,
      path: args.path,
      retry: async () =>
        args.parseSuccess(
          await fetchHubJsonWithTimeout(
            args.fetchImpl,
            url,
            timeoutMs,
            options,
            headers,
          ),
        ),
      logError: (prefix, err) => console.error(prefix, err),
      report: (error, context) => reportApiError(error, context),
    });
    if (recovery.action === 'retry_result') {
      return recovery.value;
    }

    return await args.parseSuccess(response);
  } catch (error) {
    applyDefaultHubRequestCatchEffects(error, {
      timeoutMs,
      method,
      path: args.path,
    });
  }
}

/**
 * Residual multipart upload peel for createHubClient.uploadMultipart (#1044).
 * prepare auth-only context → multipart fetch → parse success.
 */
export async function runHubMultipartUploadRequest<T>(args: {
  baseUrl: string;
  path: string;
  formData: FormData;
  token?: string | null | undefined;
  timeoutMs?: number | undefined;
  fetchImpl: typeof fetch;
  parseSuccess: (response: Response) => Promise<T>;
}): Promise<T> {
  const { headers, timeoutMs, url } = prepareMultipartUploadContextFromClient({
    baseUrl: args.baseUrl,
    path: args.path,
    token: args.token,
    timeoutMs: args.timeoutMs,
  });
  return args.parseSuccess(
    await fetchHubMultipartWithTimeout(
      args.fetchImpl,
      url,
      timeoutMs,
      headers,
      args.formData,
    ),
  );
}

// ── Residual pure peels (#1055) ───────────────────────────────────────────────

/** Residual createHubClient runtime peel: normalize baseUrl + resolve fetch impl. */
export function resolveHubClientRuntime(opts: {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}): {
  baseUrl: string;
  fetchImpl: typeof globalThis.fetch;
} {
  return {
    baseUrl: normalizeHubBaseUrl(opts.baseUrl),
    fetchImpl: resolveHubFetch(opts.fetch),
  };
}

/**
 * Residual JSON request peel with Hub envelope parseSuccess baked in (#1055).
 * exactOptional-safe: only assign optional keys when defined (no `opt: undefined`).
 */
export async function runHubClientJsonRequest<T>(args: {
  baseUrl: string;
  path: string;
  options?: RequestInit;
  token?: string | null | undefined;
  timeoutMs?: number | undefined;
  fetchImpl: typeof fetch;
  onRefreshToken?: (() => Promise<string | null>) | null | undefined;
}): Promise<T> {
  const requestArgs: {
    baseUrl: string;
    path: string;
    options?: RequestInit;
    token?: string | null | undefined;
    timeoutMs?: number | undefined;
    fetchImpl: typeof fetch;
    onRefreshToken?: (() => Promise<string | null>) | null | undefined;
    parseSuccess: (response: Response) => Promise<T>;
  } = {
    baseUrl: args.baseUrl,
    path: args.path,
    fetchImpl: args.fetchImpl,
    parseSuccess: (response) => parseHubSuccessResponse<T>(response),
  };
  if (args.options !== undefined) {
    requestArgs.options = args.options;
  }
  if (args.token !== undefined) {
    requestArgs.token = args.token;
  }
  if (args.timeoutMs !== undefined) {
    requestArgs.timeoutMs = args.timeoutMs;
  }
  if (args.onRefreshToken !== undefined) {
    requestArgs.onRefreshToken = args.onRefreshToken;
  }
  return runHubJsonRequest(requestArgs);
}

/**
 * Residual multipart upload peel with Hub envelope parseSuccess baked in (#1055).
 * exactOptional-safe: only assign optional keys when defined.
 */
export async function runHubClientMultipartUploadRequest<T>(args: {
  baseUrl: string;
  path: string;
  formData: FormData;
  token?: string | null | undefined;
  timeoutMs?: number | undefined;
  fetchImpl: typeof fetch;
}): Promise<T> {
  const requestArgs: {
    baseUrl: string;
    path: string;
    formData: FormData;
    token?: string | null | undefined;
    timeoutMs?: number | undefined;
    fetchImpl: typeof fetch;
    parseSuccess: (response: Response) => Promise<T>;
  } = {
    baseUrl: args.baseUrl,
    path: args.path,
    formData: args.formData,
    fetchImpl: args.fetchImpl,
    parseSuccess: (response) => parseHubSuccessResponse<T>(response),
  };
  if (args.token !== undefined) {
    requestArgs.token = args.token;
  }
  if (args.timeoutMs !== undefined) {
    requestArgs.timeoutMs = args.timeoutMs;
  }
  return runHubMultipartUploadRequest(requestArgs);
}

/** Transport surface used by createHubClient method table. */
export type HubClientTransport = {
  request: <T>(path: string, options?: RequestInit) => Promise<T>;
  requestWithFallback: <T>(
    paths: readonly string[],
    options?: RequestInit,
  ) => Promise<T>;
  uploadMultipart: <T>(path: string, formData: FormData) => Promise<T>;
};

export type HubClientTransportOptions = {
  baseUrl: string;
  fetchImpl: typeof fetch;
  getToken?: () => string | null | undefined;
  timeoutMs?: number | undefined;
  onRefreshToken?: (() => Promise<string | null>) | null | undefined;
};

/**
 * exactOptional-safe residual: assemble transport options from createHubClient opts.
 * Omits optional keys when undefined (exactOptionalPropertyTypes).
 */
export function resolveHubClientTransportOptions(
  runtime: { baseUrl: string; fetchImpl: typeof fetch },
  opts: {
    getToken?: (() => string | null | undefined) | undefined;
    timeoutMs?: number | undefined;
    onRefreshToken?: (() => Promise<string | null>) | null | undefined;
  },
): HubClientTransportOptions {
  const resolved: HubClientTransportOptions = {
    baseUrl: runtime.baseUrl,
    fetchImpl: runtime.fetchImpl,
  };
  if (opts.getToken !== undefined) {
    resolved.getToken = opts.getToken;
  }
  if (opts.timeoutMs !== undefined) {
    resolved.timeoutMs = opts.timeoutMs;
  }
  if (opts.onRefreshToken !== undefined) {
    resolved.onRefreshToken = opts.onRefreshToken;
  }
  return resolved;
}

/**
 * Residual createHubClient transport peel (#1055):
 * request / requestWithFallback / uploadMultipart with envelope parse baked in.
 */
export function createHubClientTransport(
  opts: HubClientTransportOptions,
): HubClientTransport {
  async function request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const jsonArgs: {
      baseUrl: string;
      path: string;
      options: RequestInit;
      token?: string | null | undefined;
      timeoutMs?: number | undefined;
      fetchImpl: typeof fetch;
      onRefreshToken?: (() => Promise<string | null>) | null | undefined;
    } = {
      baseUrl: opts.baseUrl,
      path,
      options,
      fetchImpl: opts.fetchImpl,
    };
    if (opts.getToken !== undefined) {
      jsonArgs.token = opts.getToken();
    }
    if (opts.timeoutMs !== undefined) {
      jsonArgs.timeoutMs = opts.timeoutMs;
    }
    if (opts.onRefreshToken !== undefined) {
      jsonArgs.onRefreshToken = opts.onRefreshToken;
    }
    return runHubClientJsonRequest(jsonArgs);
  }

  async function requestWithFallback<T>(
    paths: readonly string[],
    options: RequestInit = {},
  ): Promise<T> {
    return runRequestWithRouteFallback(
      paths,
      (path, init) => request<T>(path, init),
      options,
    );
  }

  async function uploadMultipart<T>(
    path: string,
    formData: FormData,
  ): Promise<T> {
    const uploadArgs: {
      baseUrl: string;
      path: string;
      formData: FormData;
      token?: string | null | undefined;
      timeoutMs?: number | undefined;
      fetchImpl: typeof fetch;
    } = {
      baseUrl: opts.baseUrl,
      path,
      formData,
      fetchImpl: opts.fetchImpl,
    };
    if (opts.getToken !== undefined) {
      uploadArgs.token = opts.getToken();
    }
    if (opts.timeoutMs !== undefined) {
      uploadArgs.timeoutMs = opts.timeoutMs;
    }
    return runHubClientMultipartUploadRequest(uploadArgs);
  }

  return {
    request,
    requestWithFallback,
    uploadMultipart,
  };
}
