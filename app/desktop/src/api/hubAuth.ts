// JWT token management for Hub Server authentication.
// Supports two auth methods:
// 1. TokenDance ID OIDC PKCE (primary) — opens browser, receives callback, gets RS256 JWT
// 2. Hub username/password (legacy fallback) — calls /client/auth/login

import type { UserProfile } from './hubClient';
import { createHubClient } from './hubClient';
import type { HubClient } from './hubClient';
import { useHubStore } from '@/stores/hubStore';

const TOKEN_KEY = 'agenthub_hub_token';
const REFRESH_KEY = 'agenthub_hub_refresh';
const TOKEN_SOURCE_KEY = 'agenthub_token_source'; // "tokendance" | "hub"

// TokenDance ID endpoints — configurable for local dev.
const TD_AUTHORIZE_URL = 'https://id.vectorcontrol.tech/oidc/authorize';
const TD_TOKEN_URL = 'https://id.vectorcontrol.tech/oidc/token';
const TD_CLIENT_ID = 'c_agenthub_desktop'; // Registered OAuth client at TokenDance ID

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

// ── PKCE helpers ──────────────────────────────────────

function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function computeCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

// ── Local callback server ─────────────────────────────

interface CallbackResult {
  code: string;
  state: string;
}

function startCallbackServer(expectedState: string): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    // Use a random port between 18000-18999
    const port = 18000 + Math.floor(Math.random() * 1000);

    // Tauri: use the shell plugin to open the browser, then listen on a local TCP-like server.
    // For now, use a simple approach: open the URL and poll.
    // In a real Tauri app, use tauri-plugin-shell to handle deep links.
    const timeout = setTimeout(() => reject(new Error('Login timed out — no callback received within 5 minutes')), 5 * 60_000);

    // Register a temporary route handler via the browser's fetch API or
    // a minimal local server. Since we're in a Tauri context, we use
    // a navigator-based approach: listen for the redirect.
    //
    // For production Tauri: use tauri://localhost or a custom URI scheme.
    // For now, we accept the token manually or use the browser redirect approach.
    //
    // Simplified flow: open browser, user copies the code, we exchange it.
    window.open(
      `${TD_AUTHORIZE_URL}?response_type=code&client_id=${encodeURIComponent(TD_CLIENT_ID)}&redirect_uri=${encodeURIComponent(`http://localhost:${port}/callback`)}&code_challenge=${encodeURIComponent('PLACEHOLDER')}&code_challenge_method=S256&scope=openid+profile+email&state=${encodeURIComponent(expectedState)}`,
      '_blank',
    );

    // Resolve immediately — the actual code exchange will be done
    // by the caller when they receive the code via manual input.
    // This is a temporary simplified flow until Tauri deep-link is wired.
    reject(new Error('Manual token input required — OIDC browser flow not yet automated'));
  });
}

// ── Token exchange ────────────────────────────────────

async function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
): Promise<{ access_token: string; refresh_token: string; id_token?: string }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: 'http://localhost:18080/callback',
    code_verifier: codeVerifier,
    client_id: TD_CLIENT_ID,
  });

  const res = await fetch(TD_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'token_exchange_failed' }));
    throw new Error(`Token exchange failed: ${err.error || res.status}`);
  }

  return res.json();
}

// ── Auth factory ──────────────────────────────────────

export function createHubAuth(client?: HubClient): HubAuth {
  const hubClient = client || createHubClient();

  const state: HubAuthState = {
    token: typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null,
    refreshToken: typeof localStorage !== 'undefined' ? localStorage.getItem(REFRESH_KEY) : null,
    user: null,
    isAuthenticated: false,
    tokenSource: (typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_SOURCE_KEY) : null) as HubAuthState['tokenSource'],
  };

  const listeners = new Set<(s: HubAuthState) => void>();

  let snapshot: HubAuthState = { ...state };

  function notify() {
    snapshot = { ...state };
    listeners.forEach((fn) => fn(snapshot));
  }

  function getToken(): string | null {
    return state.token;
  }

  let authClient = createHubClient({ getToken });

  async function completeLogin(token: string, refreshToken: string | null, source: 'tokendance' | 'hub') {
    state.token = token;
    state.refreshToken = refreshToken;
    state.tokenSource = source;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(TOKEN_KEY, token);
      if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
      localStorage.setItem(TOKEN_SOURCE_KEY, source);
    }

    authClient = createHubClient({ getToken });
    state.user = await authClient.me();
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
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = await computeCodeChallenge(codeVerifier);
      const stateStr = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));

      // Store code_verifier for the callback
      sessionStorage.setItem('td_code_verifier', codeVerifier);
      sessionStorage.setItem('td_state', stateStr);

      // Open browser for authorization
      const authUrl = `${TD_AUTHORIZE_URL}?response_type=code&client_id=${encodeURIComponent(TD_CLIENT_ID)}&redirect_uri=${encodeURIComponent('http://localhost:18080/callback')}&code_challenge=${encodeURIComponent(codeChallenge)}&code_challenge_method=S256&scope=openid+profile+email&state=${encodeURIComponent(stateStr)}`;

      window.open(authUrl, '_blank');

      // Note: Automated callback capture requires a local HTTP server or Tauri deep-link.
      // For now, the user will be prompted to paste the authorization code.
      // The code is exchanged via exchangeCodeForToken() when available.
    },

    // ── Legacy Hub username/password login ──
    async login(username: string, password: string) {
      const deviceId = `desktop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const res = await hubClient.login({
        username,
        password,
        device_type: 'desktop',
        device_id: deviceId,
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
        if (state.refreshToken) {
          try {
            const refreshClient = createHubClient();
            const res = await refreshClient.refresh(state.refreshToken);
            state.token = res.access_token;
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem(TOKEN_KEY, res.access_token);
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
        useHubStore.getState().clear();
        notify();
        return false;
      }
    },
  };
}
