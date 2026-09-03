// Web Hub client — thin surface over shared SSOT (#433 / T3.4).
// - Method/DTO SSOT: @shared/hub/hubClient
// - Web-only glue: default HUB_URL
// Do NOT add new Hub REST methods here; add them to app/shared/src/hub/hubClient.ts first.
// AH-SR-043: demo/fixture success paths belong in platform dataMode gates, not this client.

import { HUB_URL } from '@/config';
import {
  createHubClient as createSharedHubClient,
  type HubClient as SharedHubClient,
  type HubClientOptions as SharedHubClientOptions,
} from '@shared/hub/hubClient';
import {
  getCachedRefreshedAccessToken,
  refreshWebHubAccessTokenOnce,
} from '@/platform/webAuthTokenRefresh';

export * from '@shared/hub/hubClient';

export interface HubClientOptions extends SharedHubClientOptions {
  /** Defaults to web HUB_URL when omitted. */
  baseUrl?: string;
}

export function createHubClient(opts: HubClientOptions = {}): SharedHubClient {
  const baseUrl = (opts.baseUrl || HUB_URL).replace(/\/+$/, '');
  const { getToken: userGetToken, ...restOpts } = opts;
  return createSharedHubClient({
    ...restOpts,
    baseUrl,
    // Wire the 401 auto-refresh hook the transport layer already supports.
    // When a request returns 401, refreshHubAccessTokenOnce() exchanges the
    // stored refresh token for a new access token and the transport retries
    // once. Single-flight dedupes concurrent 401s to one refresh.
    onRefreshToken: opts.onRefreshToken ?? refreshWebHubAccessTokenOnce,
    // After a refresh, serve the cached fresh token so subsequent requests
    // whose getToken() reads the stale auth singleton do not 401 again.
    ...(userGetToken
      ? { getToken: () => getCachedRefreshedAccessToken() ?? userGetToken() }
      : {}),
  });
}


// Compatibility shims used by existing web inventory UI (historical shapes).
export type ExecutionTargetHealthState = 'unknown' | 'healthy' | 'degraded' | 'offline' | string;
export type ExecutionTargetTrustLevel = 'local' | 'remote' | 'cloud' | 'relay' | string;

