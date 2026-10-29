import { describe, expect, it, vi } from 'vitest';
import { createBrowserSessionAuth, type BrowserSessionAuthPorts } from './browserSessionAuth';
import type { HubBrowserSession } from '../../hub/hubClient';

const session: HubBrowserSession = {
  user: { id: 'alice', username: 'alice', nickname: 'Alice' },
  expires_at: '2099-01-01T00:00:00Z', csrf_token: 'csrf-proof',
};
function setup() {
  const ports: BrowserSessionAuthPorts = {
    client: {
      browserAuthorize: vi.fn(async () => ({ authorization_url: 'https://account.example.test/authorize?state=state', state: 'state', issuer: 'https://account.example.test' })),
      browserSession: vi.fn(async () => session),
      browserCallback: vi.fn(async () => session),
      browserLogout: vi.fn(async () => undefined),
      browserLogoutAccount: vi.fn(async () => ({ logout_url: 'https://account.example.test/logout' })),
    },
    getDeviceId: () => 'web-device', readCallback: () => null, leaveCallback: vi.fn(),
    openUrl: vi.fn(async () => undefined), clearLegacyCredentials: vi.fn(async () => undefined),
    setCsrfToken: vi.fn(), syncSession: vi.fn(),
  };
  return { ports, auth: createBrowserSessionAuth(ports) };
}

describe('server-owned browser session lifecycle', () => {
  it('deduplicates bootstrap and publishes profile without access or refresh tokens', async () => {
    const { auth, ports } = setup();
    const snapshots: boolean[] = [];
    auth.subscribe((value) => snapshots.push(value.isAuthenticated));
    await Promise.all([auth.tryAutoLogin(), auth.tryAutoLogin()]);
    expect(ports.client.browserSession).toHaveBeenCalledTimes(1);
    expect(auth.getState()).toMatchObject({ token: null, refreshToken: null, user: session.user, isAuthenticated: true });
    expect(snapshots).toEqual([true]);
  });

  it('does not resurrect a revoked session when an earlier restore completes late', async () => {
    const { auth, ports } = setup();
    let resolve!: (value: HubBrowserSession) => void;
    vi.mocked(ports.client.browserSession).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const pending = auth.tryAutoLogin();
    await vi.waitFor(() => expect(ports.client.browserSession).toHaveBeenCalled());
    auth.invalidate();
    resolve(session);
    await expect(pending).resolves.toBe(false);
    expect(auth.getState().user).toBeNull();
  });

  it('retains authenticated state on dependency outages but clears an explicit 401', async () => {
    const { auth, ports } = setup();
    await auth.tryAutoLogin();
    vi.mocked(ports.client.browserSession).mockRejectedValueOnce({ status: 503 });
    await expect(auth.tryAutoLogin()).rejects.toMatchObject({ status: 503 });
    expect(auth.getState().isAuthenticated).toBe(true);
    vi.mocked(ports.client.browserSession).mockRejectedValueOnce({ status: 401 });
    await expect(auth.tryAutoLogin()).resolves.toBe(false);
    expect(auth.getState().isAuthenticated).toBe(false);
  });

  it('starts server PKCE flow with device ID only', async () => {
    const { auth, ports } = setup();
    await auth.loginWithAccount();
    expect(ports.client.browserAuthorize).toHaveBeenCalledWith('web-device');
    expect(ports.openUrl).toHaveBeenCalledWith('https://account.example.test/authorize?state=state');
  });

  it('exchanges only callback code/state/issuer and scrubs the URL', async () => {
    const { ports } = setup();
    const callback = { code: 'code', state: 'state', iss: 'https://account.example.test' };
    ports.readCallback = () => callback;
    const auth = createBrowserSessionAuth(ports);
    await auth.tryAutoLogin();
    expect(ports.client.browserCallback).toHaveBeenCalledWith(callback);
    expect(ports.leaveCallback).toHaveBeenCalledTimes(1);
  });

  it('keeps the session if logout fails and redirects only after Account logout starts', async () => {
    const { auth, ports } = setup();
    await auth.tryAutoLogin();
    vi.mocked(ports.client.browserLogout).mockRejectedValueOnce({ status: 503 });
    await expect(auth.logout()).rejects.toMatchObject({ status: 503 });
    expect(auth.getState().isAuthenticated).toBe(true);
    await auth.logoutAccount();
    expect(auth.getState().isAuthenticated).toBe(false);
    expect(ports.openUrl).toHaveBeenCalledWith('https://account.example.test/logout');
  });
});
