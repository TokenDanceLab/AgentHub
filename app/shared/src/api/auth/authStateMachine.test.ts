import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AppError } from '../../errors';
import type { HubClient } from '../../hub/hubClient';
import { createHubAuthCore } from './authStateMachine';
import type { HubAuthPorts, HubClientFactory } from './ports';
import {
  base64UrlEncode,
  computeCodeChallenge,
  generateCodeVerifier,
  OidcError,
} from './index';
import type {
  BrowserOIDCPending,
  HubAuth,
  HubAuthState,
  HubTokenSource,
  OidcCallbackResult,
} from './index';

// ── Test doubles ───────────────────────────────────

interface MemoryBacking {
  access: string | null;
  refresh: string | null;
  source: HubTokenSource;
  pending: BrowserOIDCPending | null;
}

function createMemoryBacking(): MemoryBacking {
  return { access: null, refresh: null, source: null, pending: null };
}

function createFakePorts(overrides: Partial<HubAuthPorts> = {}) {
  const memory = createMemoryBacking();
  const sessionSync = {
    setAuthenticated: vi.fn(),
    clear: vi.fn(),
  };
  const ports: HubAuthPorts = {
    deviceIdentity: {
      getOrCreateDeviceId: () => 'device-1',
      deviceType: 'web',
    },
    tokenStorage: {
      loadAccessToken: async () => memory.access,
      saveAccessToken: async (token) => {
        memory.access = token;
      },
      clearAccessToken: async () => {
        memory.access = null;
      },
      loadRefreshToken: async () => memory.refresh,
      saveRefreshToken: async (token) => {
        memory.refresh = token;
      },
      clearRefreshToken: async () => {
        memory.refresh = null;
      },
      loadTokenSource: () => memory.source,
      saveTokenSource: (source) => {
        memory.source = source;
      },
    },
    pendingStorage: {
      save: (pending) => {
        memory.pending = pending;
      },
      load: () => memory.pending,
      clear: () => {
        memory.pending = null;
      },
    },
    callbackChannel: {
      start: async () => ({
        redirectUri: 'http://localhost:5173/auth/account/callback',
        callback: new Promise<OidcCallbackResult>(() => {}),
      }),
      readBrowserCallback: browserReadCallback,
      leaveCallbackRoute: vi.fn(),
    },
    redirectOpener: {
      open: vi.fn().mockResolvedValue(undefined),
    },
    sessionSync,
    ...overrides,
  };
  return { ports, memory, sessionSync };
}

const alice = { id: 'user-1', username: 'alice', nickname: 'Alice', avatar_url: '' };
const ACCOUNT_ISSUER = 'https://account.example';

function createFakeClient(overrides: Partial<HubClient> = {}) {
  return {
    me: vi.fn().mockResolvedValue(alice),
    refresh: vi.fn(),
    request: vi.fn().mockResolvedValue(undefined),
    oidcAuthorize: vi.fn(),
    oidcCallback: vi.fn(),
    ...overrides,
  } as unknown as HubClient;
}

function createAuth(
  ports: HubAuthPorts,
  client: HubClient,
  injectedClient?: HubClient,
): { auth: HubAuth; createClient: HubClientFactory } {
  const createClient = vi.fn(() => client) as unknown as HubClientFactory;
  const auth = createHubAuthCore(ports, { client: injectedClient, createClient });
  return { auth, createClient };
}

function pushBrowserCallback(code: string, state: string, iss = ACCOUNT_ISSUER) {
  window.history.pushState(
    {},
    '',
    `/auth/account/callback?code=${code}&state=${state}&iss=${encodeURIComponent(iss)}`,
  );
}

/** Mirrors the real platform ports: reads code/state from the current URL. */
function browserReadCallback(): OidcCallbackResult | null {
  const url = new URL(window.location.href);
  if (url.pathname !== '/auth/account/callback') return null;
  const code = url.searchParams.get('code')?.trim();
  const state = url.searchParams.get('state')?.trim();
  const iss = url.searchParams.get('iss')?.trim();
  if (!code || !state || !iss) return null;
  return { code, state, iss };
}

function makePending(state: string, createdAt = Date.now()): BrowserOIDCPending {
  return {
    state,
    codeVerifier: 'verifier-1',
    deviceId: 'device-1',
    redirectUri: 'http://localhost:5173/auth/account/callback',
    issuer: ACCOUNT_ISSUER,
    createdAt,
  };
}

// ── PKCE ──────────────────────────────────────────

describe('PKCE helpers', () => {
  it('generateCodeVerifier produces a 43-char base64url string, unique per call', () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toHaveLength(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(generateCodeVerifier()).not.toBe(verifier);
  });

  it('computeCodeChallenge produces a 43-char base64url string, deterministic per verifier', async () => {
    const challenge = await computeCodeChallenge('verifier');
    expect(challenge).toHaveLength(43);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await computeCodeChallenge('verifier')).toBe(challenge);
  });

  it('base64UrlEncode omits padding and uses URL-safe alphabet', () => {
    // [0xFB, 0xEF, 0xBF] encodes to base64 "+++/" → URL-safe "---_" (no padding).
    expect(base64UrlEncode(new Uint8Array([251, 239, 191]))).toBe('---_');
  });
});

// ── OidcError ─────────────────────────────────────

describe('OidcError', () => {
  it('carries an i18n code and optional detail', () => {
    const err = new OidcError('stateMismatch', 'fallback message', 'detail text');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('OidcError');
    expect(err.code).toBe('stateMismatch');
    expect(err.detail).toBe('detail text');
    expect(err.message).toBe('fallback message');
  });
});

// ── State machine ─────────────────────────────────

describe('createHubAuthCore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('publishes immutable snapshots and notifies subscribers, unsubscribe stops it', async () => {
    const { ports, memory } = createFakePorts();
    memory.access = 'access-1';
    const client = createFakeClient();
    const { auth } = createAuth(ports, client);

    const seen: boolean[] = [];
    const unsubscribe = auth.subscribe((s: HubAuthState) => seen.push(s.isAuthenticated));
    await expect(auth.tryAutoLogin()).resolves.toBe(true);
    unsubscribe();
    await auth.logout();

    expect(seen).toEqual([true]);
    expect(Object.isFrozen(auth.getState())).toBe(true);
    expect(auth.getState()).toMatchObject({
      token: null,
      isAuthenticated: false,
      tokenSource: null,
    });
  });

  it('returns false when no token is stored', async () => {
    const { ports } = createFakePorts();
    const { auth } = createAuth(ports, createFakeClient());
    await expect(auth.tryAutoLogin()).resolves.toBe(false);
    expect(auth.getState().isAuthenticated).toBe(false);
  });

  it('restores a stored token, validates the profile, and syncs the session store', async () => {
    const { ports, memory, sessionSync } = createFakePorts();
    memory.access = 'access-1';
    memory.source = 'hub';
    const { auth } = createAuth(ports, createFakeClient());

    await expect(auth.tryAutoLogin()).resolves.toBe(true);
    expect(auth.getState()).toMatchObject({
      token: 'access-1',
      isAuthenticated: true,
      tokenSource: 'hub',
      user: { username: 'alice' },
    });
    expect(sessionSync.setAuthenticated).toHaveBeenCalledWith('user-1', 'alice');
  });

  it('refreshes an expired access token and retries the profile request', async () => {
    const { ports, memory } = createFakePorts();
    memory.access = 'access-expired';
    memory.refresh = 'refresh-1';
    const client = createFakeClient({
      me: vi
        .fn()
        .mockRejectedValueOnce(new Error('expired'))
        .mockResolvedValueOnce({ id: 'user-2', username: 'bob', nickname: 'Bob', avatar_url: '' }),
      refresh: vi.fn().mockResolvedValue({
        access_token: 'access-2',
        refresh_token: 'refresh-2',
        expires_in: 3600,
      }),
    });
    const { auth } = createAuth(ports, client);

    await expect(auth.tryAutoLogin()).resolves.toBe(true);
    expect(client.refresh).toHaveBeenCalledWith('refresh-1');
    expect(auth.getState()).toMatchObject({
      token: 'access-2',
      refreshToken: 'refresh-2',
      isAuthenticated: true,
      user: { username: 'bob' },
    });
    expect(memory.access).toBe('access-2');
    expect(memory.refresh).toBe('refresh-2');
  });

  it('clears all credentials when profile and refresh both fail', async () => {
    const { ports, memory, sessionSync } = createFakePorts();
    memory.access = 'access-invalid';
    memory.refresh = 'refresh-invalid';
    memory.source = 'account';
    const client = createFakeClient({
      me: vi.fn().mockRejectedValue(new AppError({ error: { code: 'unauthorized', message: 'unauthorized' } }, 401)),
      refresh: vi.fn().mockRejectedValue(new AppError({ error: { code: 'auth_refresh_invalid', message: 'refresh rejected' } }, 401)),
    });
    const { auth } = createAuth(ports, client);

    await expect(auth.tryAutoLogin()).resolves.toBe(false);
    expect(auth.getState()).toMatchObject({
      token: null,
      refreshToken: null,
      user: null,
      isAuthenticated: false,
      tokenSource: null,
    });
    expect(memory.access).toBeNull();
    expect(memory.refresh).toBeNull();
    expect(sessionSync.clear).toHaveBeenCalled();
  });

  it('preserves stored credentials when profile refresh fails transiently', async () => {
    const { ports, memory, sessionSync } = createFakePorts();
    memory.access = 'access-stale';
    memory.refresh = 'refresh-valid';
    memory.source = 'account';
    const client = createFakeClient({
      me: vi.fn().mockRejectedValue(new AppError({ error: { code: 'unavailable', message: 'down' } }, 503)),
      refresh: vi.fn().mockRejectedValue(new AppError({ error: { code: 'unavailable', message: 'down' } }, 503)),
    });
    const { auth } = createAuth(ports, client);

    await expect(auth.tryAutoLogin()).resolves.toBe(false);
    expect(memory.access).toBe('access-stale');
    expect(memory.refresh).toBe('refresh-valid');
    expect(auth.getState().tokenSource).toBe('account');
    expect(auth.getState().isAuthenticated).toBe(false);
    expect(sessionSync.clear).not.toHaveBeenCalled();
  });

  it('logs out remotely when authenticated and clears all local state', async () => {
    const { ports, memory, sessionSync } = createFakePorts();
    memory.access = 'access-1';
    const client = createFakeClient();
    const { auth } = createAuth(ports, client);
    await auth.tryAutoLogin();

    await auth.logout();
    expect(client.request).toHaveBeenCalledWith('/client/auth/logout', { method: 'POST' });
    expect(auth.getState().isAuthenticated).toBe(false);
    expect(memory.access).toBeNull();
    expect(memory.refresh).toBeNull();
    expect(memory.source).toBeNull();
    expect(sessionSync.clear).toHaveBeenCalled();
  });

  it('logs out locally without a server call when signed out', async () => {
    const { ports } = createFakePorts();
    const client = createFakeClient();
    const { auth } = createAuth(ports, client);
    await auth.logout();
    expect(client.request).not.toHaveBeenCalled();
  });
});

// ── Browser callback path (Web / Desktop dev mode) ─

describe('browser OIDC callback handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('exchanges a valid callback, persists tokens, and leaves the callback route', async () => {
    const { ports, memory, sessionSync } = createFakePorts();
    memory.pending = makePending('state-1');
    pushBrowserCallback('code-1', 'state-1');

    const client = createFakeClient({
      oidcCallback: vi.fn().mockResolvedValue({
        access_token: 'access-oidc',
        refresh_token: 'refresh-oidc',
        expires_in: 3600,
        user: { id: 'user-oidc', username: 'oidc-user', nickname: 'OIDC', avatar_url: '' },
      }),
    });
    const { auth } = createAuth(ports, client);

    await expect(auth.tryAutoLogin()).resolves.toBe(true);
    expect(client.oidcCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'code-1',
        state: 'state-1',
        iss: ACCOUNT_ISSUER,
        code_verifier: 'verifier-1',
        device_type: 'web',
        device_id: 'device-1',
        redirect_uri: 'http://localhost:5173/auth/account/callback',
      }),
    );
    expect(auth.getState()).toMatchObject({
      token: 'access-oidc',
      refreshToken: 'refresh-oidc',
      tokenSource: 'account',
      isAuthenticated: true,
      user: { username: 'oidc-user' },
    });
    expect(memory.access).toBe('access-oidc');
    expect(memory.refresh).toBe('refresh-oidc');
    expect(memory.source).toBe('account');
    expect(memory.pending).toBeNull();
    expect(sessionSync.setAuthenticated).toHaveBeenCalledWith('user-oidc', 'oidc-user');
    expect(ports.callbackChannel.leaveCallbackRoute).toHaveBeenCalled();
  });

  it('returns false and cleans up when the callback has no pending state', async () => {
    const { ports } = createFakePorts();
    pushBrowserCallback('code-1', 'state-1');
    const { auth } = createAuth(ports, createFakeClient());

    await expect(auth.tryAutoLogin()).resolves.toBe(false);
    expect(ports.callbackChannel.leaveCallbackRoute).toHaveBeenCalled();
  });

  it('rejects a state mismatch as CSRF protection', async () => {
    const { ports } = createFakePorts();
    ports.pendingStorage.save(makePending('expected'));
    pushBrowserCallback('code-1', 'other');

    const client = createFakeClient();
    const { auth } = createAuth(ports, client);
    await expect(auth.tryAutoLogin()).rejects.toMatchObject({ code: 'stateMismatch' });
    expect(client.oidcCallback).not.toHaveBeenCalled();
    expect(ports.callbackChannel.leaveCallbackRoute).toHaveBeenCalled();
  });

  it('rejects a callback whose RFC 9207 issuer differs from the pinned issuer', async () => {
    const { ports } = createFakePorts();
    ports.pendingStorage.save(makePending('state-1'));
    pushBrowserCallback('code-1', 'state-1', 'https://other-account.example');

    const client = createFakeClient();
    const { auth } = createAuth(ports, client);
    await expect(auth.tryAutoLogin()).rejects.toMatchObject({ code: 'issuerInvalid' });
    expect(client.oidcCallback).not.toHaveBeenCalled();
    expect(ports.callbackChannel.leaveCallbackRoute).toHaveBeenCalled();
  });

  it('rejects an expired pending state', async () => {
    const { ports } = createFakePorts();
    ports.pendingStorage.save(makePending('old', Date.now() - 11 * 60 * 1000));
    pushBrowserCallback('code-1', 'old');

    const client = createFakeClient();
    const { auth } = createAuth(ports, client);
    await expect(auth.tryAutoLogin()).rejects.toMatchObject({ code: 'timeout' });
    expect(client.oidcCallback).not.toHaveBeenCalled();
  });

  it('wraps exchange failures as tokenExchangeFailed and still leaves the route', async () => {
    const { ports } = createFakePorts();
    ports.pendingStorage.save(makePending('state-1'));
    pushBrowserCallback('code-1', 'state-1');

    const client = createFakeClient({
      oidcCallback: vi.fn().mockRejectedValue(new Error('hub down')),
    });
    const { auth } = createAuth(ports, client);
    const err = await auth.tryAutoLogin().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OidcError);
    expect(err).toMatchObject({ code: 'tokenExchangeFailed', detail: 'hub down' });
    expect(ports.callbackChannel.leaveCallbackRoute).toHaveBeenCalled();
  });

  it('maps backend OIDC codes through the SSOT bridge table (#2123)', async () => {
    const { ports } = createFakePorts();
    ports.pendingStorage.save(makePending('state-1'));
    pushBrowserCallback('code-1', 'state-1');

    // Transport errors carry the Hub envelope code in AppError.code.
    const client = createFakeClient({
      oidcCallback: vi.fn().mockRejectedValue(
        Object.assign(new Error('state expired'), { code: 'oidc_invalid_state' }),
      ),
    });
    const { auth } = createAuth(ports, client);
    const err = await auth.tryAutoLogin().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OidcError);
    expect(err).toMatchObject({ code: 'stateMismatch' });

    const { ports: ports2 } = createFakePorts();
    ports2.pendingStorage.save(makePending('state-2'));
    pushBrowserCallback('code-2', 'state-2');
    const client2 = createFakeClient({
      oidcCallback: vi.fn().mockRejectedValue(
        Object.assign(new Error('no sub claim'), { code: 'oidc_sub_not_found' }),
      ),
    });
    const { auth: auth2 } = createAuth(ports2, client2);
    const err2 = await auth2.tryAutoLogin().catch((e: unknown) => e);
    expect(err2).toMatchObject({ code: 'tokenExchangeFailed', detail: 'no sub claim' });
  });
});

// ── loginWithAccount (local-callback-server mode) ─

describe('loginWithAccount', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function localServerPorts() {
    const { ports, memory, sessionSync } = createFakePorts();
    let resolveCallback: (result: OidcCallbackResult) => void = () => {};
    const callback = new Promise<OidcCallbackResult>((resolve) => {
      resolveCallback = resolve;
    });
    ports.callbackChannel = {
      start: async () => ({ redirectUri: 'http://127.0.0.1:53682/callback', callback }),
      readBrowserCallback: () => null,
      leaveCallbackRoute: vi.fn(),
    };
    return { ports, memory, sessionSync, resolveCallback };
  }

  it('completes the full OIDC flow: authorize → callback → exchange → login', async () => {
    const { ports, memory, sessionSync, resolveCallback } = localServerPorts();
    const client = createFakeClient({
      oidcAuthorize: vi.fn().mockResolvedValue({
        state: 'server-state',
        authorization_url: 'https://id.example/authorize?code_challenge=abc',
        issuer: ACCOUNT_ISSUER,
      }),
      oidcCallback: vi.fn().mockResolvedValue({
        access_token: 'access-oidc',
        refresh_token: 'refresh-oidc',
        expires_in: 3600,
        user: alice,
      }),
    });
    const { auth } = createAuth(ports, client);

    const loginPromise = auth.loginWithAccount();
    resolveCallback({ code: 'code-1', state: 'server-state', iss: ACCOUNT_ISSUER });
    await loginPromise;

    expect(client.oidcAuthorize).toHaveBeenCalledWith(
      expect.objectContaining({
        code_challenge_method: 'S256',
        device_type: 'web',
        device_id: 'device-1',
        redirect_uri: 'http://127.0.0.1:53682/callback',
      }),
    );
    expect(client.oidcCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'code-1',
        state: 'server-state',
        iss: ACCOUNT_ISSUER,
        redirect_uri: 'http://127.0.0.1:53682/callback',
      }),
    );
    expect(ports.redirectOpener.open).toHaveBeenCalledWith(
      'https://id.example/authorize?code_challenge=abc',
    );
    expect(ports.pendingStorage.load()).toBeNull();
    expect(auth.getState()).toMatchObject({
      token: 'access-oidc',
      isAuthenticated: true,
      tokenSource: 'account',
      user: { username: 'alice' },
    });
    expect(memory.access).toBe('access-oidc');
    expect(sessionSync.setAuthenticated).toHaveBeenCalledWith('user-1', 'alice');
  });

  it('wraps authorize failures as startFailed', async () => {
    const { ports, resolveCallback } = localServerPorts();
    const client = createFakeClient({
      oidcAuthorize: vi.fn().mockRejectedValue(new Error('hub unavailable')),
    });
    const { auth } = createAuth(ports, client);

    const err = await auth.loginWithAccount().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OidcError);
    expect(err).toMatchObject({ code: 'startFailed', detail: 'hub unavailable' });
    expect(ports.redirectOpener.open).not.toHaveBeenCalled();
  });

  it('rejects a callback with mismatched state', async () => {
    const { ports, resolveCallback } = localServerPorts();
    const client = createFakeClient({
      oidcAuthorize: vi.fn().mockResolvedValue({
        state: 'server-state',
        authorization_url: 'https://id.example/authorize',
        issuer: ACCOUNT_ISSUER,
      }),
    });
    const { auth } = createAuth(ports, client);

    const loginPromise = auth.loginWithAccount();
    resolveCallback({ code: 'code-1', state: 'attacker-state', iss: ACCOUNT_ISSUER });
    await expect(loginPromise).rejects.toMatchObject({ code: 'stateMismatch' });
    expect(client.oidcCallback).not.toHaveBeenCalled();
  });

  it('rejects a callback with mismatched issuer', async () => {
    const { ports, resolveCallback } = localServerPorts();
    const client = createFakeClient({
      oidcAuthorize: vi.fn().mockResolvedValue({
        state: 'server-state',
        authorization_url: 'https://id.example/authorize',
        issuer: ACCOUNT_ISSUER,
      }),
    });
    const { auth } = createAuth(ports, client);

    const loginPromise = auth.loginWithAccount();
    resolveCallback({
      code: 'code-1',
      state: 'server-state',
      iss: 'https://other-account.example',
    });
    await expect(loginPromise).rejects.toMatchObject({ code: 'issuerInvalid' });
    expect(client.oidcCallback).not.toHaveBeenCalled();
  });

  it('wraps exchange failures as tokenExchangeFailed', async () => {
    const { ports, resolveCallback } = localServerPorts();
    const client = createFakeClient({
      oidcAuthorize: vi.fn().mockResolvedValue({
        state: 'server-state',
        authorization_url: 'https://id.example/authorize',
        issuer: ACCOUNT_ISSUER,
      }),
      oidcCallback: vi.fn().mockRejectedValue(new Error('exchange rejected')),
    });
    const { auth } = createAuth(ports, client);
    const loginPromise = auth.loginWithAccount();
    resolveCallback({ code: 'code-1', state: 'server-state', iss: ACCOUNT_ISSUER });
    const err = await loginPromise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OidcError);
    expect(err).toMatchObject({ code: 'tokenExchangeFailed', detail: 'exchange rejected' });
  });
});
