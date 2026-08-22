// Mobile Expo adapter ports for the shared Hub auth state machine (#1537).
//
// The shared core (createHubAuthCore) is pure TS; it receives platform
// behavior through HubAuthPorts. Web and Desktop already ship adapters
// (app/web/src/api/auth/webPorts.ts, app/desktop/src/api/auth/desktopPorts.ts)
// with tests. This module wires the Expo RN runtime: expo-secure-store token
// persistence, a deep-link-driven OIDC callback channel, in-process device
// identity, and a no-op session UI sync (Mobile reads state via the
// MobileAuthSession shell instead of a zustand hubStore).
//
// Boundary decisions — recorded so nothing half-wired looks complete:
// - Device identity: persisted in expo-secure-store, loaded once at startup
//   into the sync cache the DeviceIdentityPort contract requires. If the
//   load has not run yet, a fresh UUID is generated and persisted best-effort.
// - OIDC pending state (code verifier): memory-only. openAuthSessionAsync
//   returns to the same process, so the verifier never needs to survive a
//   process restart — parity with the Desktop Tauri local-callback-server
//   mode. If the OS kills the app mid-login, the user restarts login.
// - Token source label: memory-only (UI label only; restore does not need it).
// - Callback validation: state match + 10-minute expiry are checked here when
//   the deep-link callback arrives (the core re-checks state after await).

import {
  OidcError,
  type BrowserOIDCPending,
  type DeviceIdentityPort,
  type HubAuthPorts,
  type HubSessionSyncPort,
  type HubTokenStoragePort,
  type OidcCallbackChannelPort,
  type OidcCallbackResult,
  type OidcPendingPort,
  type OidcRedirectPort,
} from '@agenthub/shared/api/auth';
import {
  createHubSessionStorage,
  type HubSessionSnapshot,
  type HubSessionStorageAdapter,
} from '@/session/sessionState';

const DEVICE_ID_KEY = 'agenthub.mobile.deviceId.v1';
const OIDC_PENDING_EXPIRY_MS = 10 * 60 * 1000;

const DEVICE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MobileAuthCorePortsOptions {
  /** SecureStore-backed string storage (Hub session + device id). */
  storageAdapter: HubSessionStorageAdapter;
  /** Deep-link URL the OIDC provider returns the authorization response to. */
  redirectUri: string;
  /** Opens the authorization URL (expo-web-browser openAuthSessionAsync). */
  openAuthUrl: (authorizationUrl: string) => Promise<void>;
  now?: () => number;
  randomDeviceId?: () => string;
}

export interface MobileAuthCorePorts {
  /** Port bundle for createHubAuthCore. */
  ports: HubAuthPorts;
  /**
   * Push an incoming OIDC authorization response (from the deep-link bridge)
   * into the mobile callback channel. Validates state + pending expiry before
   * resolving the in-flight login.
   */
  handleIncomingOidcCallback: (callback: OidcCallbackResult) => void;
  /**
   * Load the persisted device id into the sync cache. Call once during
   * session assembly (an async step) so getOrCreateDeviceId never fabricates
   * a second identity after a restart.
   */
  ensureDeviceIdentityLoaded: () => Promise<void>;
}

export function createMobileAuthCorePorts(
  options: MobileAuthCorePortsOptions,
): MobileAuthCorePorts {
  const now = () => options.now?.() ?? Date.now();
  const randomDeviceId = () => options.randomDeviceId?.() ?? generateUuid();

  // ── Device identity (sync port over async SecureStore) ──
  let cachedDeviceId: string | undefined;

  async function ensureDeviceIdentityLoaded(): Promise<void> {
    const raw = await options.storageAdapter.getItemAsync(DEVICE_ID_KEY);
    if (raw && DEVICE_ID_RE.test(raw.trim())) {
      cachedDeviceId = raw.trim().toLowerCase();
    }
  }

  function getOrCreateDeviceId(): string {
    if (cachedDeviceId) {
      return cachedDeviceId;
    }
    cachedDeviceId = randomDeviceId();
    const persisted = cachedDeviceId;
    void options.storageAdapter.setItemAsync(DEVICE_ID_KEY, persisted).catch(() => {
      // Best-effort persistence: a fresh identity is still usable this session.
    });
    return persisted;
  }

  const deviceIdentity: DeviceIdentityPort = {
    getOrCreateDeviceId,
    deviceType: 'mobile',
  };

  // ── Token storage (hub session v1 JSON in SecureStore) ──
  // Shares the HubSessionStorage key so data-plane clients restored from the
  // same slot; the token state machine stays the only writer of auth tokens.
  const hubSessionStorage = createHubSessionStorage(options.storageAdapter);
  const memoryTokenSource: { source: 'tokendance' | 'hub' | null } = { source: null };

  const tokenStorage: HubTokenStoragePort = {
    async loadAccessToken() {
      return (await hubSessionStorage.load()).accessToken ?? null;
    },
    async saveAccessToken(token) {
      const snap = await hubSessionStorage.load();
      const next: HubSessionSnapshot = { ...snap, status: token ? 'active' : 'missing' };
      delete next.accessToken;
      if (token) {
        next.accessToken = token;
      }
      await hubSessionStorage.save(next);
    },
    async clearAccessToken() {
      const snap = await hubSessionStorage.load();
      const next: HubSessionSnapshot = { ...snap };
      delete next.accessToken;
      await hubSessionStorage.save(next);
    },
    async loadRefreshToken() {
      return (await hubSessionStorage.load()).refreshToken ?? null;
    },
    async saveRefreshToken(token) {
      const snap = await hubSessionStorage.load();
      const next: HubSessionSnapshot = { ...snap, status: token ? 'active' : 'missing' };
      delete next.refreshToken;
      if (token) {
        next.refreshToken = token;
      }
      await hubSessionStorage.save(next);
    },
    async clearRefreshToken() {
      const snap = await hubSessionStorage.load();
      const next: HubSessionSnapshot = { ...snap };
      delete next.refreshToken;
      await hubSessionStorage.save(next);
    },
    loadTokenSource() {
      return memoryTokenSource.source;
    },
    saveTokenSource(source) {
      memoryTokenSource.source = source;
    },
  };

  // ── OIDC pending state (memory-only, see header note) ──
  let pending: BrowserOIDCPending | null = null;

  const pendingStorage: OidcPendingPort = {
    save(value) {
      pending = value;
    },
    load() {
      return pending;
    },
    clear() {
      pending = null;
    },
  };

  // ── OIDC callback channel (deep-link bridge → login await) ──
  let queuedCallback: OidcCallbackResult | null = null;
  const waiters: Array<{
    resolve: (callback: OidcCallbackResult) => void;
    reject: (error: Error) => void;
  }> = [];

  function rejectWaiters(error: Error) {
    for (const waiter of waiters.splice(0)) {
      waiter.reject(error);
    }
  }

  function handleIncomingOidcCallback(callback: OidcCallbackResult) {
    if (pending) {
      if (pending.state !== callback.state) {
        rejectWaiters(new OidcError('stateMismatch', 'OIDC state mismatch — possible CSRF attack. Please try again.'));
        return;
      }
      if (now() - pending.createdAt > OIDC_PENDING_EXPIRY_MS) {
        rejectWaiters(new OidcError('timeout', 'OIDC login expired. Please start TokenDance ID login again.'));
        return;
      }
    }

    const waiter = waiters.shift();
    if (waiter) {
      waiter.resolve(callback);
      return;
    }

    // No in-flight login: keep the latest callback for the cold-start path
    // (tryAutoLogin reads it via readBrowserCallback and drops it after).
    queuedCallback = callback;
  }

  const callbackChannel: OidcCallbackChannelPort = {
    start() {
      const redirectUri = options.redirectUri;
      return Promise.resolve({
        redirectUri,
        callback: new Promise<OidcCallbackResult>((resolve, reject) => {
          waiters.push({ resolve, reject });
        }),
      });
    },
    readBrowserCallback() {
      const next = queuedCallback;
      queuedCallback = null;
      return next;
    },
    leaveCallbackRoute() {
      // Mobile has no callback route to leave; the deep-link bridge keeps
      // listening (it is the single callback entry point).
    },
  };

  // ── Redirect opener / session sync / bundle ──
  const redirectOpener: OidcRedirectPort = {
    async open(authorizationUrl) {
      await options.openAuthUrl(authorizationUrl);
    },
  };

  const sessionSync: HubSessionSyncPort = {
    setAuthenticated() {
      // Mobile UI subscribes through MobileAuthSession instead of a zustand
      // hubStore — nothing to sync into.
    },
    clear() {
      // See setAuthenticated.
    },
  };

  return {
    ports: {
      deviceIdentity,
      tokenStorage,
      pendingStorage,
      callbackChannel,
      redirectOpener,
      sessionSync,
    },
    handleIncomingOidcCallback,
    ensureDeviceIdentityLoaded,
  };
}

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return '00000000-0000-4000-8000-' + `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 8)}`.padStart(12, '0');
}
