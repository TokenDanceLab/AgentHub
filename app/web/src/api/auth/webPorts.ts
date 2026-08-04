/**
 * Web platform ports for the shared Hub auth state machine (issue #1537).
 *
 * Web specifics:
 * - tokens live in tab-scoped sessionStorage (memory fallback); legacy
 *   localStorage token keys are cleared by the storage layer
 * - OIDC callback lands on the Vite callback route; PKCE pending state is kept
 *   in sessionStorage (never persistent localStorage)
 * - authorization URL opens in the current window (full-page redirect)
 */

import { getOrCreateDeviceId } from '@/api/deviceId';
import {
  clearStoredHubAccessToken,
  clearStoredHubRefreshToken,
  loadStoredHubAccessToken,
  loadStoredHubRefreshToken,
  saveStoredHubAccessToken,
  saveStoredHubRefreshToken,
} from '@/api/hubTokenStorage';
import { useHubStore } from '@/stores/hubStore';
import type {
  BrowserOIDCPending,
  HubAuthPorts,
  HubTokenSource,
  OidcCallbackResult,
} from '@shared/api/auth';

const TOKEN_SOURCE_KEY = 'agenthub_token_source'; // "tokendance" | "hub"
const OIDC_PENDING_KEY = 'agenthub_oidc_pkce_pending';
const APP_BASE_PATH = import.meta.env.BASE_URL || '/';
const OIDC_CALLBACK_PATH = import.meta.env.VITE_OIDC_CALLBACK_PATH
  || `${APP_BASE_PATH === '/' ? '' : APP_BASE_PATH.replace(/\/$/, '')}/auth/tokendance/callback`;

function readTokenSource(): HubTokenSource {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(TOKEN_SOURCE_KEY);
    }
    return (typeof sessionStorage !== 'undefined'
      ? sessionStorage.getItem(TOKEN_SOURCE_KEY)
      : null) as HubTokenSource;
  } catch {
    return null;
  }
}

function saveTokenSource(source: HubTokenSource): void {
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

function readBrowserCallback(): OidcCallbackResult | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  if (url.pathname !== OIDC_CALLBACK_PATH) return null;
  const code = url.searchParams.get('code')?.trim();
  const state = url.searchParams.get('state')?.trim();
  if (!code || !state) return null;
  return { code, state };
}

function leaveCallbackRoute(): void {
  if (typeof window === 'undefined') return;
  window.history.replaceState({}, document.title, APP_BASE_PATH);
}

/** Web port bundle; see HubAuthPorts for the contracts. */
export function createWebHubAuthPorts(): HubAuthPorts {
  return {
    deviceIdentity: {
      getOrCreateDeviceId,
      deviceType: 'web',
    },
    tokenStorage: {
      loadAccessToken: loadStoredHubAccessToken,
      saveAccessToken: saveStoredHubAccessToken,
      clearAccessToken: clearStoredHubAccessToken,
      loadRefreshToken: loadStoredHubRefreshToken,
      saveRefreshToken: saveStoredHubRefreshToken,
      clearRefreshToken: clearStoredHubRefreshToken,
      loadTokenSource: readTokenSource,
      saveTokenSource,
    },
    pendingStorage: {
      save(pending: BrowserOIDCPending) {
        if (typeof sessionStorage === 'undefined') return;
        sessionStorage.setItem(OIDC_PENDING_KEY, JSON.stringify(pending));
      },
      load() {
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
      },
      clear() {
        if (typeof sessionStorage === 'undefined') return;
        sessionStorage.removeItem(OIDC_PENDING_KEY);
      },
    },
    callbackChannel: {
      async start() {
        if (typeof window === 'undefined') {
          throw new Error('TokenDance ID login requires a browser window.');
        }
        const redirectUri = `${window.location.origin}${OIDC_CALLBACK_PATH}`;
        return {
          redirectUri,
          // The redirect unloads this document; the callback promise never
          // settles — tryAutoLogin() processes the callback after the return.
          callback: new Promise<OidcCallbackResult>(() => {}),
        };
      },
      readBrowserCallback,
      leaveCallbackRoute,
    },
    redirectOpener: {
      async open(authorizationUrl: string) {
        if (typeof window === 'undefined') {
          throw new Error('TokenDance ID login requires a browser window.');
        }
        window.location.assign(authorizationUrl);
      },
    },
    sessionSync: {
      setAuthenticated(userId, username) {
        useHubStore.getState().setAuthenticated(true, userId, username);
      },
      clear() {
        useHubStore.getState().clear();
      },
    },
  };
}
