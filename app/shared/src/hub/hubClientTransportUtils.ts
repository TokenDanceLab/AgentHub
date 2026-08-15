/**
 * Hub client pure transport helpers (timeout defaults, abort/network classification, headers).
 * Extracted from hubClient.ts (#810) — pure only; control flow stays in createHubClient.
 *
 * #1102 residual peel: implementations live in companion modules; this file is the
 * public barrel so existing `import { ... } from './hubClientTransportUtils'` stays unchanged.
 */

export {
  DEFAULT_HUB_TIMEOUT_MS,
  isAbortError,
  isNetworkFetchTypeError,
  createTimeoutAppError,
  createNetworkAppError,
  normalizeHubBaseUrl,
  resolveHubTimeoutMs,
  requestMethodOf,
  buildHubUrl,
  resolveHubFetch,
  applyDefaultJsonContentType,
  applyBearerAuth,
  applyRefreshedBearerAuth,
  createJsonAuthHeaders,
  createAuthOnlyHeaders,
  buildHubFetchInit,
  buildMultipartFetchInit,
  shouldAttemptTokenRefresh,
  toReportableError,
} from './hubClientTransportBasics';

export {
  classifyHubRequestCatch,
  type HubAbortTimeout,
  createHubAbortTimeout,
  withHubAbortTimeout,
  shouldRetryWithRefreshedToken,
  buildTokenRefreshReportContext,
  type HubRequestCatchContext,
  type HubRequestCatchResolution,
  resolveHubRequestCatch,
  type HubRequestContext,
  prepareHubRequestContext,
  type HubMultipartUploadContext,
  prepareMultipartUploadContext,
  hasTokenRefreshHandler,
  type HubRequestCatchEffects,
  planHubRequestCatchEffects,
  buildTokenRefreshFailedLogPrefix,
  prepareHubRequestContextFromClient,
  prepareMultipartUploadContextFromClient,
  type RefreshedTokenRetryPlan,
  planRefreshedTokenRetry,
  planTokenRefreshFailureReport,
  shouldEnterTokenRefreshRecovery,
  applyHubRequestCatchEffects,
  applyTokenRefreshFailureReport,
  applyDefaultHubRequestCatchEffects,
} from './hubClientTransportCatch';

export {
  fetchHubJsonWithTimeout,
  fetchHubMultipartWithTimeout,
  type UnauthorizedRefreshResult,
  runUnauthorizedTokenRefreshRecovery,
  runHubJsonRequest,
  runHubMultipartUploadRequest,
  resolveHubClientRuntime,
  runHubClientJsonRequest,
  runHubClientMultipartUploadRequest,
  type HubClientTransport,
  type HubClientTransportOptions,
  resolveHubClientTransportOptions,
  createHubClientTransport,
} from './hubClientTransportRun';
