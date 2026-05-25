// JWT token management for Hub Server authentication.
// Supports two auth methods:
// 1. TokenDance ID OIDC PKCE (primary) — opens browser, local callback server captures code,
//    exchanges via Hub /client/auth/oidc/* endpoints, receives Hub-issued JWT tokens.
// 2. Hub username/password (legacy fallback) — calls /client/auth/login

import type { UserProfile } from './hubClient';
import { createHubClient } from './hubClient';
import type { HubClient } from './hubClient';
import { getOrCreateDeviceId } from './deviceId';
import {
  clearStoredHubRefreshToken,
  loadStoredHubRefreshToken,
  saveStoredHubRefreshToken,
} from './hubTokenStorage';
import { useHubStore } from '@/stores/hubStore';

const TOKEN_KEY = 'agenthub_hub_token';
const REFRESH_KEY = 'agenthub_hub_refresh';
const TOKEN_SOURCE_KEY = 'agenthub_token_source'; // "tokendance" | "hub"

// ── Types ────────────────────────────────────────

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
  login: (username: string, password: string) => Promise<void>;
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

function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
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
 * The Rust side starts an HTTP server on a random port and emits `oidc-callback`
 * or `oidc-callback-error` events when the redirect arrives.
 *
 * Fallback (non-Tauri / browser dev mode): shows a prompt for manual code entry.
 */
function startCallbackServer(): Promise<{ port: number; result: Promise<CallbackResult> }> {
  if (!isTauri()) {
    // ---- Non-Tauri fallback: manual code entry ----
    return Promise.resolve({
      port: 0,
      result: new Promise<CallbackResult>((resolve, reject) => {
        const code = window.prompt('Enter the authorization code from the login page:');
        if (!code) {
          reject(new Error('No authorization code provided'));
          return;
        }
        // In non-Tauri mode we don't have state from the server redirect,
        // so we use a minimal flow. The state was stored in sessionStorage.
        const state = sessionStorage.getItem('td_state') || '';
        resolve({ code: code.trim(), state });
      }),
    });
  }

  // ---- Tauri path: Rust HTTP callback server ----
  return import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke<number>('start_oidc_callback_server'))
    .then((port) => {
      const result = new Promise<CallbackResult>((resolve, reject) => {
        let settled = false;

        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          unlisten();
          unlistenError();
          reject(new Error('Login timed out — no callback received within 5 minutes'));
        }, 5 * 60_000);

        let unlisten: () => void = () => {};
        let unlistenError: () => void = () => {};

        // Listen for successful callback
        import('@tauri-apps/api/event')
          .then(({ listen }) => {
            const p1 = listen<{ code: string; state: string }>('oidc-callback', (event) => {
              if (settled) return;
              settled = true;
              clearTimeout(timeout);
              unlistenError();
              resolve({ code: event.payload.code, state: event.payload.state });
            });

            const p2 = listen<{ error: string; description?: string }>(
              'oidc-callback-error',
              (event) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                unlisten();
                reject(
                  new Error(
                    `OIDC error: ${event.payload.error}${event.payload.description ? ` — ${event.payload.description}` : ''}`,
                  ),
                );
              },
            );

            return Promise.all([p1, p2]);
          })
          .then(([u1, u2]) => {
            if (settled) {
              u1();
              u2();
              return;
            }
            unlisten = u1;
            unlistenError = u2;
          })
          .catch((err) => {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              reject(new Error(`Failed to listen for OIDC callback: ${err}`));
            }
          });
      });

      return { port, result };
    })
    .catch((err) => {
      // If Tauri command fails (e.g., port in use), fall back to manual code entry
      console.warn('OIDC callback server failed to start, falling back to manual input:', err);
      return {
        port: 0,
        result: new Promise<CallbackResult>((resolve, reject) => {
          const code = window.prompt('Enter the authorization code from the login page:');
          if (!code) {
            reject(new Error('No authorization code provided'));
            return;
          }
          const state = sessionStorage.getItem('td_state') || '';
          resolve({ code: code.trim(), state });
        }),
      };
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
): Promise<HubTokenResponse> {
  const client = createHubClient();

  const body = {
    code,
    state,
    code_verifier: codeVerifier,
    device_type: 'desktop',
    device_id: getOrCreateDeviceId(),
  };

  return client.oidcCallback(body);
}

// ── Auth factory ──────────────────────────────────

export function createHubAuth(client?: HubClient): HubAuth {
  const hubClient = client || createHubClient();

  const state: HubAuthState = {
    token: typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null,
    refreshToken: null,
    user: null,
    isAuthenticated: false,
    tokenSource: (typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_SOURCE_KEY) : null) as HubAuthState['tokenSource'],
  };
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(REFRESH_KEY);
  }

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

  let authClient = createHubClient({ getToken });

  async function completeLogin(token: string, refreshToken: string | null, source: 'tokendance' | 'hub', user?: UserProfile) {
    await saveStoredHubRefreshToken(refreshToken);
    state.token = token;
    state.refreshToken = refreshToken;
    state.tokenSource = source;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.removeItem(REFRESH_KEY);
      localStorage.setItem(TOKEN_SOURCE_KEY, source);
    }

    authClient = createHubClient({ getToken });
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
   * - Fallback: `agenthub://callback` (captured by Tauri deep-link)
   */
  function buildRedirectUri(port: number): string {
    if (port > 0) {
      return `http://127.0.0.1:${port}/callback`;
    }
    // Fallback: use custom URI scheme for deep-link
    return 'agenthub://callback';
  }

  /**
   * Replace the redirect_uri query parameter in an authorization URL.
   * The Hub returns a URL with its own configured redirect_uri;
   * we replace it with our local callback server address.
   */
  function patchRedirectUri(authUrl: string, redirectUri: string): string {
    try {
      const url = new URL(authUrl);
      url.searchParams.set('redirect_uri', redirectUri);
      return url.toString();
    } catch {
      // If URL parsing fails, do a simple string replacement
      return authUrl.replace(
        /redirect_uri=[^&]*/,
        `redirect_uri=${encodeURIComponent(redirectUri)}`,
      );
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
      // 1. Generate PKCE parameters
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = await computeCodeChallenge(codeVerifier);

      // 2. Call Hub to get the authorization URL and server-generated state
      const authClient = createHubClient();
      const deviceId = getOrCreateDeviceId();

      let authorizeResp: { state: string; authorization_url: string };
      try {
        authorizeResp = await authClient.oidcAuthorize({
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          device_type: 'desktop',
          device_id: deviceId,
        });
      } catch (err) {
        throw new Error(
          `Failed to start OIDC login: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
      }

      const { state: serverState, authorization_url: authUrl } = authorizeResp;

      // Store code_verifier and state for callback
      sessionStorage.setItem('td_code_verifier', codeVerifier);
      sessionStorage.setItem('td_state', serverState);

      // 3. Start local callback server
      const { port, result: callbackResult } = await startCallbackServer();

      // 4. Build redirect URI and patch the authorization URL
      const redirectUri = buildRedirectUri(port);
      const finalAuthUrl = patchRedirectUri(authUrl, redirectUri);

      // 5. Open browser for user authentication
      const opened = window.open(finalAuthUrl, '_blank');
      if (!opened) {
        throw new Error(
          'Popup blocked — please allow popups for AgentHub to use TokenDance ID login. ' +
          'You can also use username/password login below.',
        );
      }

      // 6. Wait for the callback to arrive
      let callback: CallbackResult;
      try {
        callback = await callbackResult;
      } catch (err) {
        // Clean up on failure
        sessionStorage.removeItem('td_code_verifier');
        sessionStorage.removeItem('td_state');
        throw err;
      }

      // Validate state matches (CSRF protection)
      if (callback.state !== serverState) {
        sessionStorage.removeItem('td_code_verifier');
        sessionStorage.removeItem('td_state');
        throw new Error('OIDC state mismatch — possible CSRF attack. Please try again.');
      }

      // 7. Exchange the code for Hub tokens
      let tokenResp: HubTokenResponse;
      try {
        tokenResp = await exchangeCodeForToken(callback.code, callback.state, codeVerifier);
      } catch (err) {
        sessionStorage.removeItem('td_code_verifier');
        sessionStorage.removeItem('td_state');
        throw new Error(
          `Token exchange failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
      }

      // 8. Store tokens and update auth state
      sessionStorage.removeItem('td_code_verifier');
      sessionStorage.removeItem('td_state');
      await completeLogin(
        tokenResp.access_token,
        tokenResp.refresh_token,
        'tokendance',
        tokenResp.user,
      );
    },

    // ── Legacy Hub username/password login ──
    async login(username: string, password: string) {
      const res = await hubClient.login({
        username,
        password,
        device_type: 'desktop',
        device_id: getOrCreateDeviceId(),
      });

      await completeLogin(res.access_token, res.refresh_token, 'hub');
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
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(REFRESH_KEY);
        localStorage.removeItem(TOKEN_SOURCE_KEY);
      }
      await clearStoredHubRefreshToken();
      sessionStorage.removeItem('td_code_verifier');
      sessionStorage.removeItem('td_state');
      useHubStore.getState().clear();
      notify();
    },

    async tryAutoLogin() {
      if (!state.token) return false;
      authClient = createHubClient({ getToken });
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
            const refreshClient = createHubClient();
            const res = await refreshClient.refresh(refreshToken);
            state.token = res.access_token;
            state.refreshToken = res.refresh_token;
            await saveStoredHubRefreshToken(res.refresh_token);
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem(TOKEN_KEY, res.access_token);
              localStorage.removeItem(REFRESH_KEY);
            }
            authClient = createHubClient({ getToken });
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
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(REFRESH_KEY);
          localStorage.removeItem(TOKEN_SOURCE_KEY);
        }
        await clearStoredHubRefreshToken();
        useHubStore.getState().clear();
        notify();
        return false;
      }
    },
  };
}
