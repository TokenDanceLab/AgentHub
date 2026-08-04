// Desktop platform-port tests for the shared Hub auth state machine (#1537).
// These cover the Tauri-specific branches of desktopPorts.ts (local callback
// server, credential-store token flows, system-browser redirect) that the
// browser-dev fixtures in hubAuth.test.ts cannot reach.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesktopHubAuthPorts } from './desktopPorts';
import type { BrowserOIDCPending } from '@shared/api/auth';
import { OidcError } from '@shared/api/auth';

// ── Tauri module mocks (dynamic imports inside desktopPorts) ──

const { invokeMock, listenMock, shellOpenMock, windowOpenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
  shellOpenMock: vi.fn(),
  windowOpenMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

vi.mock('@tauri-apps/plugin-shell', () => ({
  open: (...args: unknown[]) => shellOpenMock(...args),
}));

// ── Helpers ───────────────────────────────────────

const PENDING_KEY = 'agenthub_oidc_pkce_pending';

const pending: BrowserOIDCPending = {
  state: 'server-state',
  codeVerifier: 'verifier-1',
  deviceId: 'device-1',
  redirectUri: 'http://127.0.0.1:49152/callback',
  createdAt: 1_700_000_000_000,
};

function enableTauriMode(): void {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    value: {},
  });
}

function disableTauriMode(): void {
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

/** Captures the `listen` handlers registered by startCallbackServer. */
function captureListeners(): Record<string, (event: { payload: unknown }) => void> {
  const captured: Record<string, (event: { payload: unknown }) => void> = {};
  listenMock.mockImplementation(
    (eventName: string, handler: (event: { payload: unknown }) => void) => {
      captured[eventName] = handler;
      return Promise.resolve(() => {});
    },
  );
  return captured;
}

describe('desktopPorts (Tauri mode)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    invokeMock.mockReset();
    listenMock.mockReset();
    shellOpenMock.mockReset();
    sessionStorage.clear();
    localStorage.clear();
    enableTauriMode();
    shellOpenMock.mockResolvedValue(undefined);
    windowOpenMock.mockImplementation(() => null);
    vi.spyOn(window, 'open').mockImplementation(windowOpenMock);
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    disableTauriMode();
  });

  it('keeps the PKCE verifier out of sessionStorage in Tauri mode', () => {
    const ports = createDesktopHubAuthPorts();
    ports.pendingStorage.save(pending);
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it('starts the local callback server and resolves the callback on oidc-callback', async () => {
    invokeMock.mockResolvedValueOnce(49152);
    const captured = captureListeners();

    const ports = createDesktopHubAuthPorts();
    const { redirectUri, callback } = await ports.callbackChannel.start();

    expect(invokeMock).toHaveBeenCalledWith('start_oidc_callback_server');
    expect(redirectUri).toBe('http://127.0.0.1:49152/callback');

    const resultPromise = callback.catch((err: unknown) => err);
    captured['oidc-callback']!({ payload: { code: 'code-1', state: 'server-state' } });
    await expect(resultPromise).resolves.toEqual({ code: 'code-1', state: 'server-state' });
  });

  it('rejects the callback with an OidcError on oidc-callback-error', async () => {
    invokeMock.mockResolvedValueOnce(49152);
    const captured = captureListeners();

    const ports = createDesktopHubAuthPorts();
    const { callback } = await ports.callbackChannel.start();

    const resultPromise = callback.catch((err: unknown) => err);
    captured['oidc-callback-error']!({
      payload: { error: 'access_denied', description: 'user declined' },
    });
    const err = await resultPromise;
    expect(err).toBeInstanceOf(OidcError);
    expect(err).toMatchObject({
      code: 'callbackError',
      detail: 'access_denied — user declined',
    });
  });

  it('times out the callback after 5 minutes', async () => {
    vi.useFakeTimers();
    try {
      invokeMock.mockResolvedValueOnce(49152);
      captureListeners();

      const ports = createDesktopHubAuthPorts();
      const { callback } = await ports.callbackChannel.start();

      const resultPromise = callback.catch((err: unknown) => err);
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
      const err = await resultPromise;
      expect(err).toMatchObject({ code: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('wraps callback-server startup failures as listenFailed', async () => {
    invokeMock.mockRejectedValueOnce(new Error('loopback refused'));

    const ports = createDesktopHubAuthPorts();
    const err = await ports.callbackChannel.start().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OidcError);
    expect(err).toMatchObject({ code: 'listenFailed', detail: 'loopback refused' });
  });

  it('opens the system browser in Tauri mode and falls back to window.open', async () => {
    const ports = createDesktopHubAuthPorts();
    await ports.redirectOpener.open('https://id.example/authorize');
    expect(shellOpenMock).toHaveBeenCalledWith('https://id.example/authorize');

    shellOpenMock.mockRejectedValueOnce(new Error('no shell'));
    await ports.redirectOpener.open('https://id.example/authorize?retry=1');
    expect(windowOpenMock).toHaveBeenCalledWith('https://id.example/authorize?retry=1', '_blank');
  });

  it('completes the full Tauri OIDC login flow via the shared state machine', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'start_oidc_callback_server') return 49152;
      if (command === 'read_hub_access_token' || command === 'read_hub_refresh_token') return null;
      return undefined;
    });
    const captured = captureListeners();
    shellOpenMock.mockResolvedValue(undefined);

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/client/auth/oidc/authorize')) {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          code_challenge_method: 'S256',
          device_type: 'desktop',
          redirect_uri: 'http://127.0.0.1:49152/callback',
        });
        expect(body.device_id).toEqual(expect.any(String));
        return new Response(
          JSON.stringify({
            state: 'server-state',
            authorization_url: 'https://id.example/authorize?state=server-state',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.endsWith('/client/auth/oidc/callback')) {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          code: 'code-1',
          state: 'server-state',
          device_type: 'desktop',
          redirect_uri: 'http://127.0.0.1:49152/callback',
        });
        expect(body.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
        return new Response(
          JSON.stringify({
            access_token: 'access-tauri',
            refresh_token: 'refresh-tauri',
            expires_in: 3600,
            user: {
              id: 'user-1',
              username: 'tauri-user',
              nickname: 'Tauri User',
              avatar_url: '',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.endsWith('/client/auth/me')) {
        return new Response(
          JSON.stringify({
            id: 'user-1',
            username: 'tauri-user',
            nickname: 'Tauri User',
            avatar_url: '',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { createHubAuth } = await import('../hubAuth');
    const auth = createHubAuth();

    const loginPromise = auth.loginWithTokenDance();
    await vi.waitFor(() => expect(captured['oidc-callback']).toBeDefined());
    captured['oidc-callback']!({ payload: { code: 'code-1', state: 'server-state' } });
    await expect(loginPromise).resolves.toBeUndefined();

    expect(auth.getState()).toMatchObject({
      token: 'access-tauri',
      refreshToken: 'refresh-tauri',
      isAuthenticated: true,
      tokenSource: 'tokendance',
      user: { username: 'tauri-user' },
    });
    // Tauri mode persists tokens via the OS credential store, never
    // sessionStorage, and the PKCE verifier never touches storage.
    expect(sessionStorage.getItem('agenthub_hub_token')).toBeNull();
    expect(sessionStorage.getItem('agenthub_hub_refresh_token')).toBeNull();
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
    expect(invokeMock).toHaveBeenCalledWith('store_hub_access_token', { token: 'access-tauri' });
    expect(invokeMock).toHaveBeenCalledWith('store_hub_refresh_token', { token: 'refresh-tauri' });
    expect(shellOpenMock).toHaveBeenCalledWith('https://id.example/authorize?state=server-state');
  });

  it('restores a Tauri credential-store session on tryAutoLogin', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'read_hub_access_token') return 'access-stored';
      if (command === 'read_hub_refresh_token') return null;
      return undefined;
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/client/auth/me')) {
        return new Response(
          JSON.stringify({
            id: 'user-1',
            username: 'stored-user',
            nickname: 'Stored User',
            avatar_url: '',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { createHubAuth } = await import('../hubAuth');
    const auth = createHubAuth();

    await expect(auth.tryAutoLogin()).resolves.toBe(true);
    expect(auth.getState()).toMatchObject({
      token: 'access-stored',
      isAuthenticated: true,
      user: { username: 'stored-user' },
    });
  });
});
