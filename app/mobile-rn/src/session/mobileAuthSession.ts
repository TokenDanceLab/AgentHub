// Mobile OIDC + SecureStore auth assembly — driven by the shared Hub auth
// state machine (#1537, createHubAuthCore).
//
// Previously a hand-rolled mobile state machine (Wave6 follow-up note). Port
// contract review (2026-08-23, lane C-1824): HubAuthPorts is stable — Web and
// Desktop ship production adapters (webPorts.ts / desktopPorts.ts with tests)
// and the shared core carries the refresh-fallback and session-cleanup
// semantics. Mobile now wires the same core through Expo ports
// (expoAuthPorts.ts): SecureStore token persistence, deep-link OIDC callback
// channel, in-process device identity, expo-web-browser redirect opener, and
// a no-op session UI sync (Mobile UI subscribes through this shell).
//
// Semantic notes (demo-honesty):
// - Callback path: authorization responses arrive via the agenthub://
//   deep-link bridge and are pushed into the core callback channel through
//   handleIncomingOidcCallback. State match + 10-minute expiry are validated
//   against the in-memory PKCE pending record (see expoAuthPorts.ts header).
// - If the OS kills the app mid-login the pending verifier is gone and login
//   must be restarted — parity with Desktop Tauri mode.

import {
  createHubAuthCore,
  type HubAuth,
  type HubAuthState,
} from '@agenthub/shared/api/auth';
import { createHubClient, type HubClient } from '@/api/hubClient';
import { createMobileAuthCorePorts } from '@/session/expoAuthPorts';
import {
  createHubSessionStorage,
  reduceHubSession,
  type HubSessionSnapshot,
  type HubSessionStorage,
} from '@/session/sessionState';
import { createExpoSecureStoreAdapter } from '@/session/secureStoreAdapter';

export const MOBILE_AUTH_CALLBACK_URI = 'agenthub://auth/callback';

/**
 * Mobile session shell: HubAuth + MobileAuthSession snapshot surface.
 */
export interface MobileAuthSession {
  /**
   * Full TokenDance ID login: PKCE start (Hub authorize) → system browser →
   * deep-link callback → code exchange → persisted session. The promise
   * settles on completion or an OidcError (state mismatch / expiry /
   * exchange failure).
   */
  login: () => Promise<HubSessionSnapshot>;
  /**
   * Cold-start restore: processes a queued deep-link callback if present,
   * otherwise restores the stored token and validates it via /me (with
   * refresh fallback; on failure the session is cleaned back to missing).
   */
  restore: () => Promise<HubSessionSnapshot>;
  /** Best-effort Hub logout + full local session cleanup. */
  logout: () => Promise<HubSessionSnapshot>;
  getSession: () => Promise<HubSessionSnapshot>;
  getAccessToken: () => Promise<string | null>;
  getRefreshToken: () => Promise<string | null>;
  subscribe: (listener: (snapshot: HubSessionSnapshot) => void) => () => void;
}

export interface CreateExpoMobileAuthSessionResult {
  authSession: MobileAuthSession;
  hubSessionStorage: HubSessionStorage;
  client: HubClient;
  /**
   * Push an OIDC authorization response parsed by the deep-link bridge into
   * the core callback channel (validate + resolve the in-flight login).
   */
  handleIncomingOidcCallback: (callback: { code: string; state: string }) => void;
}

export async function createExpoMobileAuthSession(
  baseUrl: string,
): Promise<CreateExpoMobileAuthSessionResult> {
  const storageAdapter = await createExpoSecureStoreAdapter();
  const hubSessionStorage = createHubSessionStorage(storageAdapter);
  const corePorts = createMobileAuthCorePorts({
    storageAdapter,
    redirectUri: MOBILE_AUTH_CALLBACK_URI,
    openAuthUrl: async (authorizationUrl) => {
      const webBrowser = await import('expo-web-browser');
      await webBrowser.openAuthSessionAsync(authorizationUrl, MOBILE_AUTH_CALLBACK_URI);
    },
  });
  await corePorts.ensureDeviceIdentityLoaded();

  const auth = createHubAuthCore(corePorts.ports, {
    createClient: (opts) =>
      createExpoAuthBackedHubClient(baseUrl, opts?.getToken, opts?.onRefreshToken, opts?.fetch),
  });

  const authSession = createMobileAuthSession(auth);
  const client = createMobileHubClient({ baseUrl, sessionStorage: hubSessionStorage });

  return {
    authSession,
    hubSessionStorage,
    client,
    handleIncomingOidcCallback: corePorts.handleIncomingOidcCallback,
  };
}

/**
 * Session shell over the shared HubAuth instance. Snapshot semantics:
 * - active: state machine has a validated token;
 * - missing: no usable session (signed out, refresh failed, or never signed in).
 */
export function createMobileAuthSession(auth: HubAuth): MobileAuthSession {
  const listeners = new Set<(snapshot: HubSessionSnapshot) => void>();
  let currentSnapshot = toSessionSnapshot(auth.getState());

  const publish = (state: HubAuthState) => {
    currentSnapshot = toSessionSnapshot(state);
    for (const listener of listeners) {
      listener(currentSnapshot);
    }
  };

  auth.subscribe(publish);
  publish(auth.getState());

  return {
    async login() {
      await auth.loginWithTokenDance();
      publish(auth.getState());
      return currentSnapshot;
    },

    async restore() {
      await auth.tryAutoLogin();
      publish(auth.getState());
      return currentSnapshot;
    },

    async logout() {
      await auth.logout();
      publish(auth.getState());
      return currentSnapshot;
    },

    async getSession() {
      return currentSnapshot;
    },

    async getAccessToken() {
      return auth.getState().token;
    },

    async getRefreshToken() {
      return auth.getState().refreshToken;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function toSessionSnapshot(state: HubAuthState): HubSessionSnapshot {
  return {
    status: state.isAuthenticated ? 'active' : 'missing',
    ...(state.token ? { accessToken: state.token } : {}),
    ...(state.refreshToken ? { refreshToken: state.refreshToken } : {}),
    ...(state.user?.id ? { userSub: state.user.id } : {}),
  };
}

/**
 * Hub client factory used by the auth core. The shared client reads the live
 * token synchronously (getToken) and refreshes on 401 via onRefreshToken; the
 * mobile shell bridges the async SecureStore-side providers it already
 * supports.
 */
function createExpoAuthBackedHubClient(
  baseUrl: string,
  getToken?: () => string | null | undefined,
  onRefreshToken?: () => Promise<string | null>,
  fetchImpl?: typeof fetch,
): HubClient {
  return createHubClient({
    baseUrl,
    ...(getToken ? { getAccessToken: async () => getToken() ?? null } : {}),
    ...(onRefreshToken ? { onRefreshToken } : {}),
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}

/**
 * Build a mobile Hub client whose access-token cache + refresh path are
 * backed by the SecureStore-backed HubSessionStorage. onRefreshToken reads the
 * stored refresh token, calls the shared Hub refresh endpoint, persists the
 * rotated pair, and returns the new access token.
 */
export function createMobileHubClient(options: {
  baseUrl: string;
  sessionStorage: HubSessionStorage;
}): HubClient {
  const { baseUrl, sessionStorage } = options;

  return createHubClient({
    baseUrl,
    async getAccessToken() {
      const snap = await sessionStorage.load();
      return snap.accessToken ?? null;
    },
    async onRefreshToken() {
      const snap = await sessionStorage.load();
      if (!snap.refreshToken) {
        return null;
      }
      const refreshClient = createHubClient({ baseUrl });
      const resp = await refreshClient.refresh(snap.refreshToken);
      const updated = reduceHubSession(
        snap,
        {
          type: 'session.received',
          accessToken: resp.access_token,
          refreshToken: resp.refresh_token,
          userSub: snap.userSub ?? '',
          expiresAt: new Date(Date.now() + resp.expires_in * 1000).toISOString(),
        },
      );
      await sessionStorage.save(updated);
      return resp.access_token;
    },
  });
}
