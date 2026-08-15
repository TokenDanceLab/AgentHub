/**
 * Desktop platform ports for the shared Hub auth state machine (issue #1537).
 *
 * Desktop specifics:
 * - tokens live in the OS credential store via Tauri invoke (memory +
 *   sessionStorage fallback in Vite dev mode); token source hint stays in
 *   localStorage
 * - Tauri mode: the Rust backend starts a local HTTP callback server on a
 *   random loopback port and emits `oidc-callback` / `oidc-callback-error`
 *   events; the PKCE verifier stays memory-only (never sessionStorage)
 * - Vite dev mode: browser redirect like Web, pending state in sessionStorage
 * - authorization URL opens in the system browser (Tauri) or current window
 */

import { getOrCreateDeviceId } from '@shared/api/deviceId';
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
import { OidcError } from '@shared/api/auth';

const TOKEN_SOURCE_KEY = 'agenthub_token_source'; // "tokendance" | "hub"
const OIDC_PENDING_KEY = 'agenthub_oidc_pkce_pending';
const OIDC_CALLBACK_PATH = '/auth/tokendance/callback';

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };

function isTauri(): boolean {
  return typeof window !== 'undefined' && typeof (window as TauriWindow).__TAURI_INTERNALS__ !== 'undefined';
}

function buildBrowserRedirectUri(): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}${OIDC_CALLBACK_PATH}`;
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
  window.history.replaceState({}, document.title, '/');
}

function readTokenSource(): HubTokenSource {
  try {
    return (typeof localStorage !== 'undefined'
      ? localStorage.getItem(TOKEN_SOURCE_KEY)
      : null) as HubTokenSource;
  } catch {
    return null;
  }
}

function saveTokenSource(source: HubTokenSource): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (source) {
      localStorage.setItem(TOKEN_SOURCE_KEY, source);
    } else {
      localStorage.removeItem(TOKEN_SOURCE_KEY);
    }
  } catch {
    /* storage disabled */
  }
}

/**
 * Start a local HTTP callback server to capture the OIDC redirect.
 *
 * In Tauri context: delegates to the Rust backend via `start_oidc_callback_server`,
 * listens for `oidc-callback` / `oidc-callback-error` events, and rejects after
 * a 5-minute timeout. In Vite dev mode this is never called — the browser
 * redirect + tryAutoLogin path handles the callback.
 */
function startCallbackServer(): Promise<{ port: number; result: Promise<OidcCallbackResult> }> {
  return import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke<number>('start_oidc_callback_server'))
    .then(async (port) => {
      const [{ listen }] = await Promise.all([import('@tauri-apps/api/event')]);

      const result = new Promise<OidcCallbackResult>((resolve, reject) => {
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

/** Desktop port bundle; see HubAuthPorts for the contracts. */
export function createDesktopHubAuthPorts(): HubAuthPorts {
  return {
    deviceIdentity: {
      getOrCreateDeviceId,
      deviceType: 'desktop',
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
        // In Tauri mode the PKCE verifier stays in memory only — never written
        // to sessionStorage/localStorage. Browser dev mode persists it so the
        // callback page can complete the exchange in tryAutoLogin.
        if (isTauri()) return;
        if (typeof sessionStorage === 'undefined') return;
        sessionStorage.setItem(OIDC_PENDING_KEY, JSON.stringify(pending));
      },
      load() {
        if (typeof sessionStorage === 'undefined') return null;
        try {
          const raw = sessionStorage.getItem(OIDC_PENDING_KEY);
          if (!raw) return null;
          return JSON.parse(raw) as BrowserOIDCPending;
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
        if (!isTauri()) {
          return {
            redirectUri: buildBrowserRedirectUri(),
            // Vite dev mode: redirect unloads the page; tryAutoLogin processes
            // the callback after the return.
            callback: new Promise<OidcCallbackResult>(() => {}),
          };
        }
        const { port, result } = await startCallbackServer();
        const redirectUri = port > 0 ? `http://127.0.0.1:${port}/callback` : '';
        return { redirectUri, callback: result };
      },
      readBrowserCallback,
      leaveCallbackRoute,
    },
    redirectOpener: {
      async open(authorizationUrl: string) {
        if (isTauri()) {
          try {
            const shell = await import('@tauri-apps/plugin-shell');
            await shell.open(authorizationUrl);
          } catch {
            window.open(authorizationUrl, '_blank');
          }
          return;
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
