// JWT token management for Hub Server authentication.
// Supports two auth methods:
// 1. TokenDance ID OIDC PKCE (primary) — redirects through the browser callback route,
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
  loadStoredHubAccessToken,
  saveStoredHubAccessToken,
  clearStoredHubAccessToken,
} from './hubTokenStorage';
import { useHubStore } from '@/stores/hubStore';

const TOKEN_SOURCE_KEY = 'agenthub_token_source'; // "tokendance" | "hub"
const OIDC_PENDING_KEY = 'agenthub_oidc_pkce_pending';
const OIDC_CALLBACK_PATH = '/auth/tokendance/callback';

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

interface BrowserOIDCPending {
  state: string;
  codeVerifier: string;
  deviceId: string;
  redirectUri: string;
  createdAt: number;
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

// ── Browser callback helpers ──────────────────────

function buildBrowserRedirectUri(): string {
  return `${window.location.origin}${OIDC_CALLBACK_PATH}`;
}

function readBrowserCallback(): CallbackResult | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  if (url.pathname !== OIDC_CALLBACK_PATH) return null;
  const code = url.searchParams.get('code')?.trim();
  const state = url.searchParams.get('state')?.trim();
  if (!code || !state) return null;
  return { code, state };
}

function loadPendingOIDC(): BrowserOIDCPending | null {
  if (typeof sessionStorage === 'undefined') return null;
  const raw = sessionStorage.getItem(OIDC_PENDING_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BrowserOIDCPending;
    if (!parsed.state || !parsed.codeVerifier || !parsed.deviceId || !parsed.redirectUri) return null;
    return parsed;
  } catch {
    return null;
  }
}

function savePendingOIDC(pending: BrowserOIDCPending): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(OIDC_PENDING_KEY, JSON.stringify(pending));
}

function clearPendingOIDC(): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(OIDC_PENDING_KEY);
}

function readTokenSource(): HubAuthState['tokenSource'] {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(TOKEN_SOURCE_KEY);
    }
    return (typeof sessionStorage !== 'undefined'
      ? sessionStorage.getItem(TOKEN_SOURCE_KEY)
      : null) as HubAuthState['tokenSource'];
  } catch {
    return null;
  }
}

function saveTokenSource(source: HubAuthState['tokenSource']): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(TOKEN_SOURCE_KEY);
    }
    if (typeof sessionStorage === 'undefined') return;
    if (source) {
      sessionStorage.setItem(TOKEN_SOURCE_KEY, source);
    } else {
      sessionStorage.removeItem(TOKEN_SOURCE_KEY);
    }
  } catch {
    /* storage disabled */
  }
}

function leaveCallbackRoute(): void {
  if (typeof window === 'undefined') return;
  window.history.replaceState({}, document.title, '/');
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
  deviceType: string,
  deviceId: string,
  redirectUri: string,
): Promise<HubTokenResponse> {
  const client = createHubClient();

  const body = {
    code,
    state,
    code_verifier: codeVerifier,
    device_type: deviceType,
    device_id: deviceId,
    redirect_uri: redirectUri,
  };

  return client.oidcCallback(body);
}

// ── Auth factory ──────────────────────────────────

export function createHubAuth(client?: HubClient): HubAuth {
  const hubClient = client || createHubClient();

  const state: HubAuthState = {
    // Access token is loaded from tab-scoped sessionStorage on tryAutoLogin.
    // Legacy localStorage token keys are cleared by the storage layer.
    token: null,
    refreshToken: null,
    user: null,
    isAuthenticated: false,
    tokenSource: readTokenSource(),
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

  let authClient = createHubClient({ getToken });

  async function completeLogin(token: string, refreshToken: string | null, source: 'tokendance' | 'hub', user?: UserProfile) {
    await saveStoredHubRefreshToken(refreshToken);
    state.token = token;
    state.refreshToken = refreshToken;
    state.tokenSource = source;
    await saveStoredHubAccessToken(token);
    saveTokenSource(source);

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
      if (typeof window === 'undefined') {
        throw new Error('TokenDance ID login requires a browser window.');
      }
      // 1. Generate PKCE parameters
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = await computeCodeChallenge(codeVerifier);
      const redirectUri = buildBrowserRedirectUri();

      // 2. Call Hub to get the authorization URL and server-generated state
      const authClient = createHubClient();
      const deviceId = getOrCreateDeviceId();

      let authorizeResp: { state: string; authorization_url: string };
      try {
        authorizeResp = await authClient.oidcAuthorize({
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          device_type: isTauri() ? 'desktop' : 'web',
          device_id: deviceId,
          redirect_uri: redirectUri,
        });
      } catch (err) {
        throw new Error(
          `Failed to start OIDC login: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
      }

      const { state: serverState, authorization_url: authUrl } = authorizeResp;

      // Browser redirects unload this document, so the PKCE verifier is kept in
      // sessionStorage, never persistent localStorage.
      savePendingOIDC({
        state: serverState,
        codeVerifier,
        deviceId,
        redirectUri,
        createdAt: Date.now(),
      });

      window.location.assign(authUrl);
    },

    // ── Legacy Hub username/password login ──
    async login(username: string, password: string) {
      const res = await hubClient.login({
        username,
        password,
        device_type: 'web',
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
      saveTokenSource(null);
      await clearStoredHubAccessToken();
      await clearStoredHubRefreshToken();
      useHubStore.getState().clear();
      notify();
    },

    async tryAutoLogin() {
      const browserCallback = readBrowserCallback();
      if (browserCallback) {
        const pending = loadPendingOIDC();
        clearPendingOIDC();
        if (!pending) {
          leaveCallbackRoute();
          return false;
        }
        if (pending.state !== browserCallback.state) {
          leaveCallbackRoute();
          throw new Error('OIDC state mismatch — possible CSRF attack. Please try again.');
        }
        if (Date.now() - pending.createdAt > 10 * 60 * 1000) {
          leaveCallbackRoute();
          throw new Error('OIDC login expired. Please start TokenDance ID login again.');
        }

        try {
          const tokenResp = await exchangeCodeForToken(
            browserCallback.code,
            browserCallback.state,
            pending.codeVerifier,
            isTauri() ? 'desktop' : 'web',
            pending.deviceId,
            pending.redirectUri,
          );
          await completeLogin(
            tokenResp.access_token,
            tokenResp.refresh_token,
            'tokendance',
            tokenResp.user,
          );
          leaveCallbackRoute();
          return true;
        } catch (err) {
          leaveCallbackRoute();
          throw new Error(
            `Token exchange failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
        }
      }

      // Load Web Hub access token from tab-scoped sessionStorage.
      if (!state.token) {
        const stored = await loadStoredHubAccessToken();
        if (stored) {
          state.token = stored;
          state.tokenSource = readTokenSource();
        }
      }
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
            await saveStoredHubAccessToken(res.access_token);
            await saveStoredHubRefreshToken(res.refresh_token);
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
        saveTokenSource(null);
        await clearStoredHubAccessToken();
        await clearStoredHubRefreshToken();
        useHubStore.getState().clear();
        notify();
        return false;
      }
    },
  };
}
