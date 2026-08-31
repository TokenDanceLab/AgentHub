/**
 * Shared Hub authentication state machine (issue #1537).
 *
 * Pure TypeScript core covering the Hub auth lifecycle:
 * - mutable auth state with immutable snapshots + listener notify
 * - TokenDance ID OIDC PKCE login flow (authorize → callback validation → code exchange)
 * - access/refresh token persistence and restore
 * - refresh fallback when the profile request fails
 * - user profile fetch, logout server call + full session cleanup
 *
 * Platform differences (browser redirect vs Tauri local callback server, token
 * storage location, device identity, session UI store sync) are injected as
 * ports (see ports.ts). The core performs no direct browser/Tauri access.
 */

import type { HubClient } from '../../hub/hubClient';
import { computeCodeChallenge, generateCodeVerifier } from './pkce';
import type { HubClientFactory, HubAuthPorts } from './ports';
import {
  isOidcBackendErrorCode,
  oidcBackendCodeToI18nCode,
  OidcError,
} from './types';

/**
 * Builds an OidcError for an upstream exchange failure. When the thrown
 * transport error carries a backend OIDC code (AppError.code from the Hub
 * envelope), the single bridge table oidcBackendCodeToI18nCode maps it to the
 * i18n suffix (#2123 P1-2); unknown shapes fall back to the generic code.
 */
function oidcErrorFromExchangeFailure(err: unknown, detail: string): OidcError {
  const backendCode = (err as { code?: unknown } | null | undefined)?.code;
  const code = isOidcBackendErrorCode(backendCode)
    ? oidcBackendCodeToI18nCode[backendCode]
    : 'tokenExchangeFailed';
  return new OidcError(code, `Token exchange failed: ${detail}`, detail);
}
import type {
  BrowserOIDCPending,
  HubAuth,
  HubAuthState,
  HubTokenResponse,
  HubTokenSource,
  OidcCallbackResult,
} from './types';

/** Pending OIDC state is valid for 10 minutes after login start. */
const OIDC_PENDING_EXPIRY_MS = 10 * 60 * 1000;

export interface HubAuthCoreOptions {
  /**
   * Optional pre-built client; when provided it backs all authed/public Hub
   * calls. `| undefined` keeps the interface assignable from consumers that
   * compile with `exactOptionalPropertyTypes: true` (desktop tsconfig).
   */
  client?: HubClient | undefined;
  /** Platform client factory (the app's thin createHubClient shell). */
  createClient: HubClientFactory;
}

export function createHubAuthCore(ports: HubAuthPorts, options: HubAuthCoreOptions): HubAuth {
  const { createClient } = options;
  const { deviceIdentity, tokenStorage, pendingStorage, callbackChannel, redirectOpener, sessionSync } = ports;

  const state: HubAuthState = {
    // Access token is restored from platform storage on tryAutoLogin.
    token: null,
    refreshToken: null,
    user: null,
    isAuthenticated: false,
    tokenSource: tokenStorage.loadTokenSource(),
  };

  const listeners = new Set<(s: HubAuthState) => void>();

  function createSnapshot(): HubAuthState {
    return Object.freeze({ ...state }) as HubAuthState;
  }

  let snapshot: HubAuthState = createSnapshot();

  function notify() {
    snapshot = createSnapshot();
    listeners.forEach((fn) => fn(snapshot));
  }

  function getToken(): string | null {
    return state.token;
  }

  // Client used for authed calls (me/logout); picks up the live token via getToken.
  const authedClient = (): HubClient => options.client ?? createClient({ getToken });
  // Client used for public calls (authorize/refresh).
  const publicClient = (): HubClient => options.client ?? createClient();

  let authClient: HubClient = authedClient();

  async function completeLogin(
    token: string,
    refreshToken: string | null,
    source: HubTokenSource,
    user?: HubTokenResponse['user'],
  ) {
    await tokenStorage.saveRefreshToken(refreshToken);
    state.token = token;
    state.refreshToken = refreshToken;
    state.tokenSource = source;
    await tokenStorage.saveAccessToken(token);
    tokenStorage.saveTokenSource(source);

    authClient = authedClient();
    // If the user profile is already available (OIDC callback), use it directly.
    if (user) {
      state.user = user;
    } else {
      try {
        state.user = await authClient.me();
      } catch {
        // Will be refreshed on next auto-login attempt.
      }
    }
    state.isAuthenticated = true;
    sessionSync.setAuthenticated(state.user?.id ?? null, state.user?.username ?? null);
    notify();
  }

  function markAuthenticated() {
    state.isAuthenticated = true;
    sessionSync.setAuthenticated(state.user?.id ?? null, state.user?.username ?? null);
    notify();
  }

  async function clearSession() {
    state.token = null;
    state.refreshToken = null;
    state.user = null;
    state.isAuthenticated = false;
    state.tokenSource = null;
    tokenStorage.saveTokenSource(null);
    await tokenStorage.clearAccessToken();
    await tokenStorage.clearRefreshToken();
    sessionSync.clear();
    notify();
  }

  /**
   * Exchange the OIDC authorization code for Hub tokens.
   * Always uses a fresh platform client (mirrors legacy web/desktop behavior:
   * the exchange never reuses an injected client).
   */
  async function exchangeCodeForToken(
    code: string,
    stateParam: string,
    codeVerifier: string,
    deviceId: string,
    redirectUri: string,
  ): Promise<HubTokenResponse> {
    const client = createClient();
    const body: {
      code: string;
      state: string;
      code_verifier: string;
      device_type: string;
      device_id: string;
      redirect_uri?: string;
    } = {
      code,
      state: stateParam,
      code_verifier: codeVerifier,
      device_type: deviceIdentity.deviceType,
      device_id: deviceId,
    };
    if (redirectUri) {
      body.redirect_uri = redirectUri;
    }

    const resp = await client.oidcCallback(body);
    const out: HubTokenResponse = {
      access_token: resp.access_token,
      refresh_token: resp.refresh_token,
      expires_in: resp.expires_in,
    };
    if (resp.user) {
      out.user = resp.user;
    }
    return out;
  }

  /** Browser-redirect callback path shared by Web and Desktop dev mode. */
  async function handleBrowserCallback(browserCallback: OidcCallbackResult): Promise<boolean> {
    const pending = pendingStorage.load();
    pendingStorage.clear();
    if (!pending) {
      callbackChannel.leaveCallbackRoute();
      return false;
    }
    if (pending.state !== browserCallback.state) {
      callbackChannel.leaveCallbackRoute();
      throw new OidcError('stateMismatch', 'OIDC state mismatch — possible CSRF attack. Please try again.');
    }
    if (Date.now() - pending.createdAt > OIDC_PENDING_EXPIRY_MS) {
      callbackChannel.leaveCallbackRoute();
      throw new OidcError('timeout', 'OIDC login expired. Please start TokenDance ID login again.');
    }

    try {
      const tokenResp = await exchangeCodeForToken(
        browserCallback.code,
        browserCallback.state,
        pending.codeVerifier,
        pending.deviceId,
        pending.redirectUri,
      );
      await completeLogin(
        tokenResp.access_token,
        tokenResp.refresh_token,
        'tokendance',
        tokenResp.user ?? undefined,
      );
      callbackChannel.leaveCallbackRoute();
      return true;
    } catch (err) {
      callbackChannel.leaveCallbackRoute();
      const detail = err instanceof Error ? err.message : 'Unknown error';
      throw oidcErrorFromExchangeFailure(err, detail);
    }
  }

  return {
    getState: () => snapshot,

    subscribe(fn: (s: HubAuthState) => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    // ── TokenDance ID OIDC PKCE login ──
    async loginWithTokenDance() {
      // 1. Generate PKCE parameters.
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = await computeCodeChallenge(codeVerifier);
      const deviceId = deviceIdentity.getOrCreateDeviceId();

      // 2. Start the platform callback channel; browser mode may navigate away
      //    after the redirect opens (callback promise never settles there).
      const { redirectUri, callback } = await callbackChannel.start();

      // 3. Call Hub to get the authorization URL and server-generated state.
      let authorizeResp: { state: string; authorization_url: string };
      try {
        const authorizeBody: {
          code_challenge: string;
          code_challenge_method: string;
          device_type: string;
          device_id: string;
          redirect_uri?: string;
        } = {
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          device_type: deviceIdentity.deviceType,
          device_id: deviceId,
        };
        if (redirectUri) {
          authorizeBody.redirect_uri = redirectUri;
        }
        authorizeResp = await publicClient().oidcAuthorize(authorizeBody);
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'Unknown error';
        const oidcErr = new OidcError('startFailed', `Failed to start OIDC login: ${detail}`, detail);
        oidcErr.cause = err;
        throw oidcErr;
      }

      const { state: serverState, authorization_url: authUrl } = authorizeResp;

      // The PKCE verifier travels through the pending port — browser mode keeps
      // it in sessionStorage (never persistent localStorage); Tauri keeps it
      // memory-only via the platform implementation.
      const pending: BrowserOIDCPending = {
        state: serverState,
        codeVerifier,
        deviceId,
        redirectUri,
        createdAt: Date.now(),
      };
      pendingStorage.save(pending);

      // 4. Open the authorization URL (navigates away in browser mode).
      await redirectOpener.open(authUrl);

      // 5. Local-callback-server mode (Tauri): wait for the callback.
      const callbackResult = await callback;

      // 6. Validate state matches (CSRF protection).
      if (callbackResult.state !== serverState) {
        throw new OidcError('stateMismatch', 'OIDC state mismatch — possible CSRF attack. Please try again.');
      }

      // 7. Exchange the code for Hub tokens.
      let tokenResp: HubTokenResponse;
      try {
        tokenResp = await exchangeCodeForToken(
          callbackResult.code,
          callbackResult.state,
          codeVerifier,
          deviceId,
          redirectUri,
        );
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'Unknown error';
        const oidcErr = oidcErrorFromExchangeFailure(err, detail);
        oidcErr.cause = err;
        throw oidcErr;
      }

      // 8. Store tokens and update auth state.
      await completeLogin(
        tokenResp.access_token,
        tokenResp.refresh_token,
        'tokendance',
        tokenResp.user ?? undefined,
      );
    },

    async logout() {
      if (state.token) {
        await authClient.request('/client/auth/logout', { method: 'POST' }).catch(() => {});
      }
      await clearSession();
    },

    async tryAutoLogin() {
      // Browser-redirect mode: process the OIDC callback landing on this page.
      const browserCallback = callbackChannel.readBrowserCallback();
      if (browserCallback) {
        return handleBrowserCallback(browserCallback);
      }

      // Restore the access token from platform storage.
      if (!state.token) {
        const stored = await tokenStorage.loadAccessToken();
        if (stored) {
          state.token = stored;
          state.tokenSource = tokenStorage.loadTokenSource();
        }
      }
      if (!state.token) return false;
      authClient = authedClient();
      try {
        state.user = await authClient.me();
        markAuthenticated();
        return true;
      } catch {
        const refreshToken = state.refreshToken ?? (await tokenStorage.loadRefreshToken());
        if (refreshToken) {
          try {
            const refreshClient = publicClient();
            const res = await refreshClient.refresh(refreshToken);
            state.token = res.access_token;
            state.refreshToken = res.refresh_token;
            await tokenStorage.saveAccessToken(res.access_token);
            await tokenStorage.saveRefreshToken(res.refresh_token);
            authClient = authedClient();
            state.user = await authClient.me();
            markAuthenticated();
            return true;
          } catch {
            // Refresh failed — fall through to full cleanup.
          }
        }
        await clearSession();
        return false;
      }
    },
  };
}
