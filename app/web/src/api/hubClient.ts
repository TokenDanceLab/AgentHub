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

export interface AgentInstance {
  id: string;
  agent_type: string;
  custom_agent_id?: string;
  session_id: string;
  inviter_user_id: string;
  workspace_id?: string;
  display_name: string;
  created_at?: string;
}

export interface PendingAgentTask {
  id: string;
  agent_instance_id: string;
  triggered_by_user_id: string;
  trigger_message_id: string;
  target_id?: string;
  status: string;
  edge_run_id?: string;
  edge_device_id?: string;
  error_message?: string;
  created_at?: string;
  dispatched_at?: string;
  finished_at?: string;
  expire_at?: string;
}
