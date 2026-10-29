// Web Hub client — thin surface over shared SSOT (#433).
// - Method/DTO SSOT: @shared/hub/hubClient
// - Web-only glue: default HUB_URL
// Do NOT add new Hub REST methods here; add them to app/shared/src/hub/hubClient.ts first.
// demo/fixture success paths belong in platform dataMode gates, not this client.

import { HUB_URL } from '@/config';
import {
  createHubClient as createSharedHubClient,
  type HubClient as SharedHubClient,
  type HubClientOptions as SharedHubClientOptions,
} from '@shared/hub/hubClient';
import { getBrowserCsrfToken, getBrowserSessionGeneration, invalidateBrowserSession } from './browserSessionRuntime';

export * from '@shared/hub/hubClient';

export interface HubClientOptions extends SharedHubClientOptions {
  /** Defaults to web HUB_URL when omitted. */
  baseUrl?: string;
}

export function createHubClient(opts: HubClientOptions = {}): SharedHubClient {
  const baseUrl = (opts.baseUrl ?? HUB_URL).replace(/\/+$/, '');
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  return createSharedHubClient({
    ...opts,
    baseUrl,
    authTransport: {
      kind: 'browser-session',
      origin: window.location.origin,
      getCsrfToken: getBrowserCsrfToken,
    },
    fetch: async (input, init) => {
      const generation = getBrowserSessionGeneration();
      const response = await fetchImpl(input, init);
      const body = response.status === 204 ? null : await response.arrayBuffer();
      if (generation !== getBrowserSessionGeneration()) throw new DOMException('Session changed', 'AbortError');
      if (response.status === 401) invalidateBrowserSession();
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    },
  });
}


// Compatibility shims used by existing web inventory UI (historical shapes).
export type ExecutionTargetHealthState = 'unknown' | 'online' | 'healthy' | 'degraded' | 'offline' | 'stale' | 'mismatch' | 'registered';
export type ExecutionTargetTrustLevel = 'local' | 'remote' | 'cloud' | 'relay';
