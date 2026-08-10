// Mobile OIDC + SecureStore auth assembly.
//
// Reuses the shared Hub SSOT for the OIDC code-exchange API
// (client.oidcAuthorize / client.oidcCallback / client.refresh) and the
// shared PKCE helpers (@agenthub/shared/api/auth). The mobile-only glue here:
//   - persist the PKCE pending state + device id in expo-secure-store
//   - open the server-issued authorization_url via expo-web-browser
//   - validate the deep-link callback (parseOidcCallback from deepLinking.ts)
//   - exchange the code for Hub tokens and persist the Hub session
//   - wire createHubClient's getAccessToken / onRefreshToken to SecureStore
//
// Why not the shared authStateMachine (createHubAuthCore)? It requires full
// port wiring (tokenStorage, pendingStorage, callbackChannel, redirectOpener,
// deviceIdentity, sessionSync) that is heavier than the mobile surface needs
// today. The Hub client methods used here ARE the shared SSOT for the network
// surface; only the platform glue is mobile-local. Migrating to
// createHubAuthCore is a Wave6 follow-up once the port contract stabilizes
// (see BLOCKED).

import {
  computeCodeChallenge,
  generateCodeVerifier,
} from '@agenthub/shared/api/auth';
import { createHubClient, type HubClient } from '@/api/hubClient';
import {
  parseOidcCallback,
} from '@/integrations/deepLinking';
import {
  createExpoSecureStoreAdapter,
} from '@/session/secureStoreAdapter';
import {
  createHubSessionStorage,
  reduceHubSession,
  type HubSessionStorage,
  type HubSessionStorageAdapter,
  type HubSessionSnapshot,
} from '@/session/sessionState';

const PENDING_KEY = 'agenthub.mobile.oidcPending.v1';
const DEVICE_ID_KEY = 'agenthub.mobile.deviceId.v1';
const DEVICE_TYPE = 'mobile';
const OIDC_PENDING_EXPIRY_MS = 10 * 60 * 1000;

export interface MobileOidcPending {
  state: string;
  codeVerifier: string;
  deviceId: string;
  redirectUri: string;
  createdAt: number;
}

export interface MobileAuthClient {
  oidcAuthorize: (body: {
    code_challenge: string;
    code_challenge_method: string;
    device_type: string;
    device_id: string;
    redirect_uri: string;
  }) => Promise<{ state: string; authorization_url: string }>;
  oidcCallback: (body: {
    code: string;
    state: string;
    code_verifier: string;
    device_type: string;
    device_id: string;
    redirect_uri: string;
  }) => Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user?: { id: string; username: string; nickname: string };
  }>;
  refresh: (refreshToken: string) => Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }>;
  logout: () => Promise<unknown>;
}

export interface MobileAuthPorts {
  storageAdapter: HubSessionStorageAdapter;
  openAuthUrl: (url: string, redirectUri: string) => Promise<void>;
  createClient: (options: {
    baseUrl: string;
    getAccessToken?: () => Promise<string | null>;
    onRefreshToken?: () => Promise<string | null>;
  }) => MobileAuthClient;
  randomDeviceId?: () => string;
  now?: () => number;
}

export interface StartMobileLoginOptions {
  baseUrl: string;
  redirectUri: string;
}

export interface HandleMobileCallbackOptions {
  baseUrl: string;
  redirectUri: string;
}

export interface MobileAuthSession {
  startLogin: (options: StartMobileLoginOptions) => Promise<{ authorizationUrl: string }>;
  handleCallback: (
    callbackUrl: string,
    options: HandleMobileCallbackOptions,
  ) => Promise<HubSessionSnapshot>;
  logout: (baseUrl: string) => Promise<void>;
  getAccessToken: () => Promise<string | null>;
  getRefreshToken: () => Promise<string | null>;
  getSession: () => Promise<HubSessionSnapshot>;
}

class MobileOidcError extends Error {
  constructor(
    public readonly code:
      | 'invalid_callback'
      | 'missing_code'
      | 'missing_state'
      | 'callback_error'
      | 'no_pending'
      | 'state_mismatch'
      | 'expired'
      | 'exchange_failed',
    message: string,
  ) {
    super(message);
    this.name = 'MobileOidcError';
  }
}

export function createMobileAuthSession(ports: MobileAuthPorts): MobileAuthSession {
  // Named hubSessionStorage to avoid shadowing the browser sessionStorage
  // global flagged by the boundary verifier.
  const hubSessionStorage = createHubSessionStorage(ports.storageAdapter);
  const now = () => ports.now?.() ?? Date.now();

  async function readJson<T>(key: string): Promise<T | null> {
    const raw = await ports.storageAdapter.getItemAsync(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async function writeJson(key: string, value: unknown): Promise<void> {
    await ports.storageAdapter.setItemAsync(key, JSON.stringify(value));
  }

  async function ensureDeviceId(): Promise<string> {
    const existing = await readJson<string>(DEVICE_ID_KEY);
    if (existing) return existing;
    const generated = ports.randomDeviceId?.() ?? generateDeviceIdFallback();
    await writeJson(DEVICE_ID_KEY, generated);
    return generated;
  }

  async function readPending(): Promise<MobileOidcPending | null> {
    return readJson<MobileOidcPending>(PENDING_KEY);
  }

  async function clearPending(): Promise<void> {
    await ports.storageAdapter.deleteItemAsync(PENDING_KEY);
  }

  return {
    async startLogin({ baseUrl, redirectUri }) {
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = await computeCodeChallenge(codeVerifier);
      const deviceId = await ensureDeviceId();
      const client = ports.createClient({ baseUrl });

      const authorizeResp = await client.oidcAuthorize({
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        device_type: DEVICE_TYPE,
        device_id: deviceId,
        redirect_uri: redirectUri,
      });

      const pending: MobileOidcPending = {
        state: authorizeResp.state,
        codeVerifier,
        deviceId,
        redirectUri,
        createdAt: now(),
      };
      await writeJson(PENDING_KEY, pending);

      await ports.openAuthUrl(authorizeResp.authorization_url, redirectUri);
      return { authorizationUrl: authorizeResp.authorization_url };
    },

    async handleCallback(callbackUrl, { baseUrl, redirectUri }) {
      const parsed = parseOidcCallback(callbackUrl);

      if (parsed.kind === 'error') {
        throw new MobileOidcError(
          'callback_error',
          `OIDC provider error: ${parsed.error}`,
        );
      }
      if (parsed.kind === 'invalid') {
        throw new MobileOidcError(parsed.reason, 'Invalid OIDC callback');
      }

      const pending = await readPending();
      if (!pending) {
        throw new MobileOidcError('no_pending', 'No pending OIDC login');
      }
      if (pending.state !== parsed.state) {
        throw new MobileOidcError('state_mismatch', 'OIDC state mismatch');
      }
      if (now() - pending.createdAt > OIDC_PENDING_EXPIRY_MS) {
        await clearPending();
        throw new MobileOidcError('expired', 'OIDC login expired');
      }

      const client = ports.createClient({ baseUrl });
      let exchangeResp;
      try {
        exchangeResp = await client.oidcCallback({
          code: parsed.code,
          state: parsed.state,
          code_verifier: pending.codeVerifier,
          device_type: DEVICE_TYPE,
          device_id: pending.deviceId,
          redirect_uri: redirectUri,
        });
      } catch (error) {
        await clearPending();
        throw new MobileOidcError(
          'exchange_failed',
          `Token exchange failed: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }

      const session = reduceHubSession(
        { status: 'missing' },
        {
          type: 'session.received',
          accessToken: exchangeResp.access_token,
          refreshToken: exchangeResp.refresh_token,
          userSub: exchangeResp.user?.id ?? '',
          expiresAt: new Date(now() + exchangeResp.expires_in * 1000).toISOString(),
        },
      );
      await hubSessionStorage.save(session);
      await clearPending();
      return session;
    },

    async logout(baseUrl) {
      const snap = await hubSessionStorage.load();
      const client = ports.createClient({
        baseUrl,
        ...(snap.accessToken ? { getAccessToken: async () => snap.accessToken ?? null } : {}),
      });
      try {
        await client.logout();
      } catch {
        // Best-effort: clear local session regardless of server outcome.
      }
      await hubSessionStorage.clear();
    },

    async getAccessToken() {
      return (await hubSessionStorage.load()).accessToken ?? null;
    },

    async getRefreshToken() {
      return (await hubSessionStorage.load()).refreshToken ?? null;
    },

    async getSession() {
      return hubSessionStorage.load();
    },
  };
}

export async function createExpoMobileAuthSession(
  baseUrl: string,
): Promise<{ authSession: MobileAuthSession; hubSessionStorage: HubSessionStorage; client: HubClient }> {
  const storageAdapter = await createExpoSecureStoreAdapter();
  const hubSessionStorage = createHubSessionStorage(storageAdapter);

  const authSession = createMobileAuthSession({
    storageAdapter,
    async openAuthUrl(url, redirectUri) {
      const webBrowser = await import('expo-web-browser');
      await webBrowser.openAuthSessionAsync(url, redirectUri);
    },
    createClient: (options) =>
      createHubClient({
        baseUrl: options.baseUrl,
        ...(options.getAccessToken ? { getAccessToken: options.getAccessToken } : {}),
        ...(options.onRefreshToken ? { onRefreshToken: options.onRefreshToken } : {}),
      }) as unknown as MobileAuthClient,
  });

  const client = createMobileHubClient({ baseUrl, sessionStorage: hubSessionStorage });

  return { authSession, hubSessionStorage, client };
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

function generateDeviceIdFallback(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `agenthub-mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
