/**
 * Shared Hub authentication state machine (issue #1537).
 *
 * Pure TypeScript core covering the Hub auth lifecycle:
 * - mutable auth state with immutable snapshots + listener notify
 * - TokenDance Account OIDC PKCE login flow (authorize → callback validation → code exchange)
 * - access/refresh token persistence and restore
 * - refresh fallback when the profile request fails
 * - user profile fetch, logout server call + full session cleanup
 *
 * Platform differences (browser redirect vs Tauri local callback server, token
 * storage location, device identity, session UI store sync) are injected as
 * ports (see ports.ts). The core performs no direct browser/Tauri access.
 */

import type { HubClient } from '../../hub/hubClient';
import { isTerminalHubAuthError } from '../../errors';
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
 * i18n suffix (#2123); unknown shapes fall back to the generic code.
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

export function createHubAuthCore(ports: HubAuthPorts, options: HubAuthCoreOptions): HubAuth & { invalidate: () => Promise<void> } {
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

  // An in-flight request belongs to its captured credential, not a newer login.
  const authedClient = (token: string): HubClient => options.client ?? createClient({ getToken: () => token });
  // Client used for public calls (authorize/refresh).
  const publicClient = (): HubClient => options.client ?? createClient();

  let generation = 0;
  let restoreBlocked = false;
  const isCurrent = (attempt: number) => generation === attempt;

  // Keychain writes cannot be cancelled. Drain every older write/clear before
  // persisting a newer login, even when one of the storage operations fails.
  let credentialQueue: Promise<void> = Promise.resolve();
  function withCredentials<T>(operation: () => Promise<T>): Promise<T> {
    const result = credentialQueue.then(operation);
    credentialQueue = result.then(() => {}, () => {});
    return result;
  }

  async function clearStoredCredentials() {
    // Mobile ports update one shared credential blob. Even within the outer
    // queue these operations must remain sequential to avoid lost updates.
    const failures: unknown[] = [];
    for (const clear of [
      () => tokenStorage.saveTokenSource(null),
      () => tokenStorage.clearAccessToken(),
      () => tokenStorage.clearRefreshToken(),
    ]) {
      try { await clear(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw failures[0];
  }

  async function persistCredentials(attempt: number, token: string, refreshToken: string | null, source: HubTokenSource) {
    try {
      return await withCredentials(async () => {
        if (!isCurrent(attempt)) return false;
        try {
          await tokenStorage.saveRefreshToken(refreshToken);
          if (!isCurrent(attempt)) return false;
          await tokenStorage.saveAccessToken(token);
          if (!isCurrent(attempt)) return false;
          tokenStorage.saveTokenSource(source);
          return true;
        } finally {
          // A superseding login can fail before writing anything. Remove this
          // attempt's partial writes while still owning the queue, never after
          // a newer credential commit has been allowed to start.
          if (!isCurrent(attempt)) await clearStoredCredentials();
        }
      });
    } catch (error) {
      if (isCurrent(attempt)) await clearSession().catch(() => {});
      throw error;
    }
  }

  async function completeLogin(
    attempt: number,
    token: string,
    refreshToken: string | null,
    source: HubTokenSource,
    user?: HubTokenResponse['user'],
  ) {
    if (!isCurrent(attempt)) return false;
    let profile = user ?? null;
    // If the user profile is already available (OIDC callback), use it directly.
    if (!profile) {
      try {
        profile = await authedClient(token).me();
      } catch {
        // Will be refreshed on next auto-login attempt.
      }
    }
    if (!isCurrent(attempt) || !await persistCredentials(attempt, token, refreshToken, source)) return false;
    if (!isCurrent(attempt)) return false;
    Object.assign(state, { token, refreshToken, tokenSource: source, user: profile });
    markAuthenticated();
    return true;
  }

  function markAuthenticated() {
    restoreBlocked = false;
    state.isAuthenticated = true;
    sessionSync.setAuthenticated(state.user?.id ?? null, state.user?.username ?? null);
    notify();
  }

  async function clearSession() {
    generation += 1;
    restoreBlocked = true;
    state.token = null;
    state.refreshToken = null;
    state.user = null;
    state.isAuthenticated = false;
    state.tokenSource = null;
    sessionSync.clear();
    notify();
    pendingStorage.clear();
    await withCredentials(clearStoredCredentials);
  }

  /**
   * Exchange the OIDC authorization code for Hub tokens.
   * Always uses a fresh platform client (mirrors legacy web/desktop behavior:
   * the exchange never reuses an injected client).
   */
  async function exchangeCodeForToken(
    code: string,
    stateParam: string,
    issuer: string,
    codeVerifier: string,
    deviceId: string,
    redirectUri: string,
  ): Promise<HubTokenResponse> {
    const client = createClient();
    const body: {
      code: string;
      state: string;
      iss: string;
      code_verifier: string;
      device_type: string;
      device_id: string;
      redirect_uri?: string;
    } = {
      code,
      state: stateParam,
      iss: issuer,
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
  async function handleBrowserCallback(browserCallback: OidcCallbackResult, attempt: number): Promise<boolean> {
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
    if (pending.issuer !== browserCallback.iss) {
      callbackChannel.leaveCallbackRoute();
      throw new OidcError('issuerInvalid', 'OIDC issuer mismatch — refusing to exchange the authorization code.');
    }
    if (Date.now() - pending.createdAt > OIDC_PENDING_EXPIRY_MS) {
      callbackChannel.leaveCallbackRoute();
      throw new OidcError('timeout', 'OIDC login expired. Please start Account login again.');
    }

    try {
      const tokenResp = await exchangeCodeForToken(
        browserCallback.code,
        browserCallback.state,
        browserCallback.iss,
        pending.codeVerifier,
        pending.deviceId,
        pending.redirectUri,
      );
      if (!isCurrent(attempt)) return false;
      const completed = await completeLogin(
        attempt,
        tokenResp.access_token,
        tokenResp.refresh_token,
        'account',
        tokenResp.user ?? undefined,
      );
      if (isCurrent(attempt)) callbackChannel.leaveCallbackRoute();
      return completed;
    } catch (err) {
      if (!isCurrent(attempt)) return false;
      callbackChannel.leaveCallbackRoute();
      const detail = err instanceof Error ? err.message : 'Unknown error';
      throw oidcErrorFromExchangeFailure(err, detail);
    }
  }

  return {
    invalidate: clearSession,
    getState: () => snapshot,

    subscribe(fn: (s: HubAuthState) => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    // ── TokenDance Account OIDC PKCE login ──
    async loginWithAccount() {
      const attempt = ++generation;
      restoreBlocked = true;
      pendingStorage.clear();
      // 1. Generate PKCE parameters.
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = await computeCodeChallenge(codeVerifier);
      if (!isCurrent(attempt)) return;
      const deviceId = deviceIdentity.getOrCreateDeviceId();

      // 2. Start the platform callback channel; browser mode may navigate away
      //    after the redirect opens (callback promise never settles there).
      const { redirectUri, callback } = await callbackChannel.start();
      if (!isCurrent(attempt)) return;

      // 3. Call Hub to get the authorization URL and server-generated state.
      let authorizeResp: { state: string; authorization_url: string; issuer: string };
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
        if (!isCurrent(attempt)) return;
        const detail = err instanceof Error ? err.message : 'Unknown error';
        const oidcErr = new OidcError('startFailed', `Failed to start OIDC login: ${detail}`, detail);
        oidcErr.cause = err;
        throw oidcErr;
      }
      if (!isCurrent(attempt)) return;

      const { state: serverState, authorization_url: authUrl, issuer } = authorizeResp;
      if (!issuer) {
        throw new OidcError('issuerInvalid', 'Hub did not pin an Account OIDC issuer.');
      }

      // The PKCE verifier travels through the pending port — browser mode keeps
      // it in sessionStorage (never persistent localStorage); Tauri keeps it
      // memory-only via the platform implementation.
      const pending: BrowserOIDCPending = {
        state: serverState,
        codeVerifier,
        deviceId,
        redirectUri,
        issuer,
        createdAt: Date.now(),
      };
      pendingStorage.save(pending);

      // 4. Open the authorization URL (navigates away in browser mode).
      await redirectOpener.open(authUrl);
      if (!isCurrent(attempt)) return;

      // 5. Local-callback-server mode (Tauri): wait for the callback.
      const callbackResult = await callback;
      if (!isCurrent(attempt)) return;
      pendingStorage.clear();

      // 6. Validate state matches (CSRF protection).
      if (callbackResult.state !== serverState) {
        throw new OidcError('stateMismatch', 'OIDC state mismatch — possible CSRF attack. Please try again.');
      }
      if (callbackResult.iss !== issuer) {
        throw new OidcError('issuerInvalid', 'OIDC issuer mismatch — refusing to exchange the authorization code.');
      }

      // 7. Exchange the code for Hub tokens.
      let tokenResp: HubTokenResponse;
      try {
        tokenResp = await exchangeCodeForToken(
          callbackResult.code,
          callbackResult.state,
          callbackResult.iss,
          codeVerifier,
          deviceId,
          redirectUri,
        );
      } catch (err) {
        if (!isCurrent(attempt)) return;
        const detail = err instanceof Error ? err.message : 'Unknown error';
        const oidcErr = oidcErrorFromExchangeFailure(err, detail);
        oidcErr.cause = err;
        throw oidcErr;
      }

      // 8. Store tokens and update auth state.
      await completeLogin(
        attempt,
        tokenResp.access_token,
        tokenResp.refresh_token,
        'account',
        tokenResp.user ?? undefined,
      );
    },

    async logout() {
      const remote = state.token
        ? authedClient(state.token).request('/client/auth/logout', { method: 'POST' }).catch(() => {})
        : Promise.resolve();
      await Promise.all([clearSession(), remote]);
    },

    async tryAutoLogin() {
      // Browser-redirect mode: process the OIDC callback landing on this page.
      const browserCallback = callbackChannel.readBrowserCallback();
      if (!browserCallback && restoreBlocked) return false;
      const attempt = ++generation;
      if (browserCallback) {
        restoreBlocked = true;
        return handleBrowserCallback(browserCallback, attempt);
      }

      // Restore the access token from platform storage.
      await credentialQueue;
      if (!isCurrent(attempt)) return false;
      const token = state.token ?? await tokenStorage.loadAccessToken();
      if (!isCurrent(attempt) || !token) return false;
      const source = state.tokenSource ?? tokenStorage.loadTokenSource();
      try {
        const user = await authedClient(token).me();
        if (!isCurrent(attempt)) return false;
        Object.assign(state, { token, tokenSource: source, user });
        markAuthenticated();
        return true;
      } catch (authErr) {
        if (!isCurrent(attempt)) return false;
        const refreshToken = state.refreshToken ?? (await tokenStorage.loadRefreshToken());
        if (!isCurrent(attempt)) return false;
        if (refreshToken) {
          try {
            const refreshClient = publicClient();
            const res = await refreshClient.refresh(refreshToken);
            if (!isCurrent(attempt) || !await persistCredentials(attempt, res.access_token, res.refresh_token, source)) return false;
            if (!isCurrent(attempt)) return false;
            // Preserve a rotated refresh credential even if /me is transiently unavailable.
            Object.assign(state, { token: res.access_token, refreshToken: res.refresh_token, tokenSource: source });
            const user = await authedClient(res.access_token).me();
            if (!isCurrent(attempt)) return false;
            state.user = user;
            markAuthenticated();
            return true;
          } catch (refreshErr) {
            if (!isCurrent(attempt)) return false;
            if (isTerminalHubAuthError(refreshErr)) {
              await clearSession();
            }
            // Transient refresh failures keep the stored token for a later
            // restore attempt instead of treating an outage as a logout.
            return false;
          }
        }
        if (isTerminalHubAuthError(authErr)) {
          await clearSession();
        }
        return false;
      }
    },
  };
}
