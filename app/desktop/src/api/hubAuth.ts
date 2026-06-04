// JWT token management for Hub Server authentication.
// TokenDance ID OIDC PKCE opens the system browser, captures the local callback,
//    exchanges via Hub /client/auth/oidc/* endpoints, receives Hub-issued JWT tokens.

import type { UserProfile } from './hubClient';
import { createHubClient } from './hubClient';
import type { HubClient } from './hubClient';
import { getOrCreateDeviceId } from './deviceId';
import {
  clearStoredHubRefreshToken,
  loadStoredHubRefreshToken,
  saveStoredHubRefreshToken,
  loadStoredHubAccessToken,
  saveStoredHubAccessToken,
  clearStoredHubAccessToken,
} from './hubTokenStorage';
import { useHubStore } from '@/stores/hubStore';

const TOKEN_SOURCE_KEY = 'agenthub_token_source'; // "tokendance" | "hub"

// ── Types ────────────────────────────────────────

/**
 * OIDC auth error with an i18n code so UI can map to localized messages.
 * `code` is the suffix under `auth.error.oidc.<code>` in locale files.
 * `detail` carries dynamic context (e.g. upstream error text) for interpolation.
 */
export class OidcError extends Error {
  code: string;
  detail?: string;
  cause?: unknown;

  constructor(code: string, fallbackMessage: string, detail?: string) {
    super(fallbackMessage);
    this.name = 'OidcError';
    this.code = code;
    this.detail = detail;
  }
}

export interface HubAuthState {
  token: string | null;
  refreshToken: string | null;
  user: UserProfile | null;
  isAuthenticated: boolean;
  tokenSource: 'tokendance' | 'hub' | null;
}

export interface HubAuth {
  getState: () => HubAuthState;
  subscribe: (fn: (state: HubAuthState) => void) => () => void;
  loginWithTokenDance: () => Promise<void>;
  logout: () => Promise<void>;
  tryAutoLogin: () => Promise<boolean>;
}

interface CallbackResult {
  code: string;
  state: string;
}

// ── Tauri detect ─────────────────────────────────

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };
function isTauri(): boolean {
  return typeof window !== 'undefined' && typeof (window as TauriWindow).__TAURI_INTERNALS__ !== 'undefined';
}

// ── PKCE helpers ──────────────────────────────────

// Module-level state bridge for the browser dev path.
// In Tauri mode PKCE values stay in the async function closure and are never written to storage.
// In Vite dev mode, we persist PKCE to sessionStorage so it survives the browser redirect round-trip.
let pendingOidcState = '';

const OIDC_PENDING_KEY = 'agenthub_oidc_pkce_pending';
const OIDC_CALLBACK_PATH = '/auth/tokendance/callback';

interface BrowserOIDCPending {
  state: string;
  codeVerifier: string;
  deviceId: string;
  redirectUri: string;
  createdAt: number;
}

function buildBrowserRedirectUri(): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}${OIDC_CALLBACK_PATH}`;
}

function savePendingOIDC(pending: BrowserOIDCPending): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(OIDC_PENDING_KEY, JSON.stringify(pending));
}

function loadPendingOIDC(): BrowserOIDCPending | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(OIDC_PENDING_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BrowserOIDCPending;
  } catch {
    return null;
  }
}

function clearPendingOIDC(): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(OIDC_PENDING_KEY);
}

function readBrowserCallbackFromURL(): CallbackResult | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  if (url.pathname !== OIDC_CALLBACK_PATH) return null;
  const code = url.searchParams.get('code')?.trim();
  const state = url.searchParams.get('state')?.trim();
  if (!code || !state) return null;
  return { code, state };
}

function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function computeCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

// ── Local callback server ─────────────────────────

/**
 * Start a local HTTP callback server to capture the OIDC redirect.
 *
 * In Tauri context: delegates to the Rust backend via `start_oidc_callback_server`.
 * In Vite dev mode: uses browser redirect (TokenDance ID → Vite dev URL),
 *   navigates the current page to the authorization URL, then reads code/state
 *   from the URL query params after the redirect lands back.
 */
function startCallbackServer(): Promise<{ port: number; result: Promise<CallbackResult> }> {
  if (!isTauri()) {
    // ---- Vite dev mode: browser redirect via window.location ----
    // The TokenDance ID redirect_uri is http://localhost:5173/auth/tokendance/callback
    // After login, the browser returns to this URL with ?code=xxx&state=yyy.
    // tryAutoLogin() will detect the callback route and process it.
    return Promise.resolve({
      port: 0,
      result: new Promise<CallbackResult>(() => {
        // This promise never resolves here — tryAutoLogin handles the callback.
        // The user is navigated away via window.location in loginWithTokenDance().
      }),
    });
  }

  // ---- Tauri path: Rust HTTP callback server ----
  return import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke<number>('start_oidc_callback_server'))
    .then(async (port) => {
      // Import modules up front so listeners are registered before we return.
      const [{ listen }] = await Promise.all([
        import('@tauri-apps/api/event'),
      ]);

      const result = new Promise<CallbackResult>((resolve, reject) => {
        let settled = false;

        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          unlisten();
          unlistenError();
          reject(new OidcError('timeout', 'Login timed out — no callback received within 5 minutes.'));
        }, 5 * 60_000);

        let unlisten: () => void = () => {};
        let unlistenError: () => void = () => {};

        // Listen for successful callback
        listen<{ code: string; state: string }>('oidc-callback', (event) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          unlistenError();
          resolve({ code: event.payload.code, state: event.payload.state });
        }).then((u) => {
          if (settled) {
            u();
            return;
          }
          unlisten = u;
        });

        listen<{ error: string; description?: string }>(
          'oidc-callback-error',
          (event) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            unlisten();
            reject(
              new OidcError(
                'callbackError',
                `OIDC error: ${event.payload.error}${event.payload.description ? ` — ${event.payload.description}` : ''}`,
                `${event.payload.error}${event.payload.description ? ` — ${event.payload.description}` : ''}`,
              ),
            );
          },
        ).then((u) => {
          if (settled) {
            u();
            return;
          }
          unlistenError = u;
        });
      });

      return { port, result };
    })
    .catch((err) => {
      const detail = err instanceof Error ? err.message : String(err);
      throw new OidcError('listenFailed', `Failed to listen for OIDC callback: ${detail}`, detail);
    });
}

// ── Token exchange via Hub ────────────────────────

interface HubTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: UserProfile;
}

async function exchangeCodeForToken(
  code: string,
  state: string,
  codeVerifier: string,
  redirectUri: string,
  deviceId: string,
): Promise<HubTokenResponse> {
  const client = createHubClient();

  const body: {
    code: string;
    state: string;
    code_verifier: string;
    device_type: string;
    device_id: string;
    redirect_uri?: string;
  } = {
    code,
    state,
    code_verifier: codeVerifier,
    device_type: 'desktop',
    device_id: deviceId,
  };
  if (redirectUri) {
    body.redirect_uri = redirectUri;
  }

  return client.oidcCallback(body);
}

// ── Auth factory ──────────────────────────────────

export function createHubAuth(client?: HubClient): HubAuth {
  const state: HubAuthState = {
    // Access token loaded from secure store on tryAutoLogin.
    // Legacy localStorage read is handled via loadStoredHubAccessToken fallback.
    token: null,
    refreshToken: null,
    user: null,
    isAuthenticated: false,
    tokenSource: (typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_SOURCE_KEY) : null) as HubAuthState['tokenSource'],
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

  const createAuthClient = () => client ?? createHubClient({ getToken });
  const createPublicClient = () => client ?? createHubClient();

  let authClient = createAuthClient();

  async function completeLogin(token: string, refreshToken: string | null, source: 'tokendance' | 'hub', user?: UserProfile) {
    await saveStoredHubRefreshToken(refreshToken);
    state.token = token;
    state.refreshToken = refreshToken;
    state.tokenSource = source;
    await saveStoredHubAccessToken(token);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(TOKEN_SOURCE_KEY, source);
    }

    authClient = createAuthClient();
    // If user profile is already available (from OIDC callback), use it directly
    if (user) {
      state.user = user;
    } else {
      try {
        state.user = await authClient.me();
      } catch {
        // Will be refreshed on next auto-login attempt
      }
    }
    state.isAuthenticated = true;
    useHubStore.getState().setAuthenticated(true, state.user?.id, state.user?.username);
    notify();
  }

  /**
   * Build the redirect_uri used in the OIDC flow.
   * - In Tauri: `http://127.0.0.1:{port}/callback` (captured by local HTTP server)
   * - Browser dev: Vite callback URL, handled by tryAutoLogin after redirect.
   */
  function buildRedirectUri(port: number): string {
    if (port > 0) {
      return `http://127.0.0.1:${port}/callback`;
    }
    return '';
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
      // 1. Generate PKCE parameters
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = await computeCodeChallenge(codeVerifier);
      const deviceId = getOrCreateDeviceId();
      console.debug('[oidc] PKCE generated, code_verifier length:', codeVerifier.length);

      // 2. Start local callback server (Tauri) or prepare browser dev callback.
      //    In Tauri, the Rust backend starts an HTTP server on a random port
      //    and emits `oidc-callback` / `oidc-callback-error` events.
      //    The redirect_uri is `http://127.0.0.1:{port}/callback`.
      let callbackResult: Promise<CallbackResult>;
      let redirectUri = '';

      if (isTauri()) {
        const { port, result } = await startCallbackServer();
        console.debug('[oidc] Callback server on port:', port);
        redirectUri = buildRedirectUri(port);
        callbackResult = result;
      } else {
        // Vite dev mode: redirect back to localhost after login.
        // Save PKCE to sessionStorage, navigate to TokenDance ID,
        // and tryAutoLogin() will process the callback on return.
        redirectUri = buildBrowserRedirectUri();
        savePendingOIDC({
          state: '',
          codeVerifier,
          deviceId,
          redirectUri,
          createdAt: Date.now(),
        });
        // We'll fill in the state after the authorize call returns.
        callbackResult = new Promise<CallbackResult>(() => {
          // Will be resolved by the browser redirect → tryAutoLogin.
        });
      }

      // 3. Call Hub to bind PKCE/state/device and get the authorization URL.
      //    Pass the redirect_uri so Hub and TokenDance ID use the same one.
      const authClient = createPublicClient();

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
          device_type: 'desktop',
          device_id: deviceId,
        };
        if (redirectUri) {
          authorizeBody.redirect_uri = redirectUri;
        }
        authorizeResp = await authClient.oidcAuthorize(authorizeBody);
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'Unknown error';
        const oidcErr = new OidcError('startFailed', `Failed to start OIDC login: ${detail}`, detail);
        oidcErr.cause = err;
        throw oidcErr;
      }

      const { state: serverState, authorization_url: authUrl } = authorizeResp;
      console.debug('[oidc] Hub returned authorization URL, state:', serverState.substring(0, 8) + '...');

      // code_verifier stays in closure — never written to sessionStorage/localStorage
      // In Vite mode, we update the pending state now that we have the server state.
      if (!isTauri()) {
        savePendingOIDC({
          state: serverState,
          codeVerifier,
          deviceId,
          redirectUri,
          createdAt: Date.now(),
        });
      }
      pendingOidcState = serverState;

      // 4. Open browser for user authentication.
      if (isTauri()) {
        try {
          const shell = await import('@tauri-apps/plugin-shell');
          await shell.open(authUrl);
        } catch {
          window.open(authUrl, '_blank');
        }
      } else {
        // Vite dev mode: navigate the current window to TokenDance ID.
        // After login, TokenDance ID redirects back to
        // http://localhost:5173/auth/tokendance/callback?code=xxx&state=yyy
        window.location.assign(authUrl);
        // This unloads the page. tryAutoLogin() will handle the callback on return.
        return;
      }

      console.debug('[oidc] Browser opened for auth URL');

      // 5. Wait for the callback from the local HTTP server.
      const callback = await callbackResult;
      console.debug('[oidc] Callback received, state match:', callback.state === serverState);

      // 6. Validate state matches (CSRF protection)
      if (callback.state !== serverState) {
        throw new OidcError('stateMismatch', 'OIDC state mismatch — possible CSRF attack. Please try again.');
      }

      // 7. Exchange the code for Hub tokens
      let tokenResp: HubTokenResponse;
      console.debug('[oidc] Exchanging code for tokens, redirect_uri:', redirectUri);
      try {
        tokenResp = await exchangeCodeForToken(callback.code, callback.state, codeVerifier, redirectUri, deviceId);
        console.debug('[oidc] Token exchange complete, username:', tokenResp.user?.username);
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'Unknown error';
        const oidcErr = new OidcError('tokenExchangeFailed', `Token exchange failed: ${detail}`, detail);
        oidcErr.cause = err;
        throw oidcErr;
      }

      // 8. Store tokens and update auth state
      await completeLogin(
        tokenResp.access_token,
        tokenResp.refresh_token,
        'tokendance',
        tokenResp.user,
      );
    },

    async logout() {
      if (state.token) {
        await authClient.request('/client/auth/logout', { method: 'POST' }).catch(() => {});
      }
      state.token = null;
      state.refreshToken = null;
      state.user = null;
      state.isAuthenticated = false;
      state.tokenSource = null;
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(TOKEN_SOURCE_KEY);
      }
      await clearStoredHubAccessToken();
      await clearStoredHubRefreshToken();
      useHubStore.getState().clear();
      notify();
    },

    async tryAutoLogin() {
      // Vite dev mode: check if we've returned from TokenDance ID with a code.
      const browserCallback = readBrowserCallbackFromURL();
      if (browserCallback) {
        const pending = loadPendingOIDC();
        clearPendingOIDC();
        if (!pending) {
          window.history.replaceState({}, document.title, '/');
          return false;
        }
        if (pending.state !== browserCallback.state) {
          window.history.replaceState({}, document.title, '/');
          throw new OidcError('stateMismatch', 'OIDC state mismatch — possible CSRF attack. Please try again.');
        }
        if (Date.now() - pending.createdAt > 10 * 60 * 1000) {
          window.history.replaceState({}, document.title, '/');
          throw new OidcError('timeout', 'OIDC login expired. Please start TokenDance ID login again.');
        }

        try {
          const tokenResp = await exchangeCodeForToken(
            browserCallback.code,
            browserCallback.state,
            pending.codeVerifier,
            pending.redirectUri,
            pending.deviceId,
          );
          await completeLogin(
            tokenResp.access_token,
            tokenResp.refresh_token,
            'tokendance',
            tokenResp.user,
          );
          window.history.replaceState({}, document.title, '/');
          return true;
        } catch (err) {
          window.history.replaceState({}, document.title, '/');
          const detail = err instanceof Error ? err.message : 'Unknown error';
          const oidcErr = new OidcError('tokenExchangeFailed', `Token exchange failed: ${detail}`, detail);
          oidcErr.cause = err;
          throw oidcErr;
        }
      }

      // Load access token from secure store (Tauri) or sessionStorage fallback
      if (!state.token) {
        const stored = await loadStoredHubAccessToken();
        if (stored) {
          state.token = stored;
          // Load token source hint (non-sensitive, kept in localStorage for read on subsequent starts)
          if (typeof localStorage !== 'undefined') {
            state.tokenSource = localStorage.getItem(TOKEN_SOURCE_KEY) as HubAuthState['tokenSource'];
          }
        }
      }
      if (!state.token) return false;
      authClient = createAuthClient();
      try {
        state.user = await authClient.me();
        state.isAuthenticated = true;
        useHubStore.getState().setAuthenticated(true, state.user?.id, state.user?.username);
        notify();
        return true;
      } catch {
        const refreshToken = state.refreshToken ?? (await loadStoredHubRefreshToken());
        if (refreshToken) {
          try {
            const refreshClient = createPublicClient();
            const res = await refreshClient.refresh(refreshToken);
            state.token = res.access_token;
            state.refreshToken = res.refresh_token;
            await saveStoredHubAccessToken(res.access_token);
            await saveStoredHubRefreshToken(res.refresh_token);
            authClient = createAuthClient();
            state.user = await authClient.me();
            state.isAuthenticated = true;
            useHubStore.getState().setAuthenticated(true, state.user?.id, state.user?.username);
            notify();
            return true;
          } catch {
            // refresh failed
          }
        }
        state.token = null;
        state.refreshToken = null;
        state.user = null;
        state.isAuthenticated = false;
        state.tokenSource = null;
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(TOKEN_SOURCE_KEY);
        }
        await clearStoredHubAccessToken();
        await clearStoredHubRefreshToken();
        useHubStore.getState().clear();
        notify();
        return false;
      }
    },
  };
}
