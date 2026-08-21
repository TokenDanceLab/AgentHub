/**
 * Web Hub access-token refresh singleton (P0: wire onRefreshToken site-wide).
 *
 * The shared auth state machine (authStateMachine.ts) refreshes inside
 * tryAutoLogin, but the transport's 401-recovery hook was never wired, so a
 * token-expired access token caused every authenticated request to 401 with no
 * recovery. This module provides the onRefreshToken callback the transport
 * layer already supports (hubClientTransportRun.runUnauthorizedTokenRefreshRecovery).
 *
 * Strategy:
 * - single-flight: N concurrent 401s share one refresh promise.
 * - cache: the last successful access token is served for REFRESH_CACHE_TTL_MS
 *   so subsequent requests whose getToken() still reads the stale in-memory
 *   auth singleton token get the fresh token without another 401 round-trip.
 *
 * Tokens live in tab-scoped sessionStorage (with a memory fallback) via the
 * shared hubTokenStorage module. The refresh endpoint itself is public (no
 * auth header), so the shared client is used directly with no onRefreshToken to
 * avoid recursion.
 */

import {
  loadStoredHubRefreshToken,
  saveStoredHubAccessToken,
  saveStoredHubRefreshToken,
} from '@/api/hubTokenStorage';
import { HUB_URL } from '@/config';
import { resetWebHubSession } from '@/platform/webAuthSessionReset';
import { createHubClient as createSharedHubClient } from '@shared/hub/hubClient';

const REFRESH_CACHE_TTL_MS = 25_000;
let refreshInFlight: Promise<string | null> | null = null;
let cachedRefreshedToken: { token: string; expires: number } | null = null;

/**
 * Returns the most recently refreshed access token if it is still within its
 * cache window. Used to short-circuit getToken() after a refresh so the stale
 * in-memory auth singleton does not cause another 401 storm.
 */
export function getCachedRefreshedAccessToken(): string | null {
  if (cachedRefreshedToken && Date.now() < cachedRefreshedToken.expires) {
    return cachedRefreshedToken.token;
  }
  cachedRefreshedToken = null;
  return null;
}

/**
 * Single-flight Hub access-token refresh for Web. Reads the stored refresh
 * token, exchanges it via the public `/client/auth/refresh` endpoint,
 * persists both tokens to sessionStorage, and returns the new access token
 * (or null when there is no refresh token / the exchange fails). Concurrent
 * callers await the same in-flight promise.
 */
export async function refreshWebHubAccessTokenOnce(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const refreshToken = await loadStoredHubRefreshToken();
    if (!refreshToken) return null;
    try {
      // Public refresh endpoint — no auth header, no onRefreshToken (no recursion).
      const refreshClient = createSharedHubClient({
        baseUrl: HUB_URL.replace(/\/+$/, ''),
      });
      const res = await refreshClient.refresh(refreshToken);
      await saveStoredHubAccessToken(res.access_token);
      if (res.refresh_token) {
        await saveStoredHubRefreshToken(res.refresh_token);
      }
      cachedRefreshedToken = {
        token: res.access_token,
        expires: Date.now() + REFRESH_CACHE_TTL_MS,
      };
      return res.access_token;
    } catch (err) {
      cachedRefreshedToken = null;
      console.warn('[webHubClient] 401 token refresh failed:', err);
      // Refresh token invalid/expired — the Hub session is unrecoverable.
      // Fail closed: drop the stored tokens, reset the auth state, and
      // surface the login entry again (#1816).
      await resetWebHubSession();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}
